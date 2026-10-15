import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LineBuffer } from "../../companionLink/line-buffer";
import {
  parseCompanionCommand,
  parseCompanionEvent,
} from "../../companionLink/protocol";
import { buildVoiceJoinOptions } from "../../companionLink/voice-options";
import { evaluateJoin } from "../../joinVoice/channel-policy";
import {
  AUDIO_UP,
  AudioFrameDecoder,
  encodeAudioFrame,
} from "../../playback/audio-frames";
import { AudioMixer } from "../../playback/audio-mixer";
import type { ConnectFailure } from "../../voiceSession/connection-record";
import { ConnectionRegistry } from "../../voiceSession/connection-registry";
import { FeasibilityTracker, pcmRms } from "../../voiceSession/feasibility";
import { FAILURE_MESSAGES } from "../../voiceSession/messages";
import { nextReconnectDelayMs } from "../../voiceSession/reconnect";
import { redact } from "../../voiceSession/redaction";
import {
  isSafeCompanionEntry,
  isSnowflake,
  isUserToken,
} from "../../voiceSession/validation";
import { CHANNEL, facts, GUILD, TOKEN, tone } from "./support";

const REDACTED = /\[redacted\]/;

describe("validation and redaction", () => {
  it("accepts snowflakes, session tokens, and absolute companion paths", () => {
    assert.equal(isSnowflake(GUILD), true);
    assert.equal(isSnowflake("12"), false);
    assert.equal(isUserToken(TOKEN), true);
    assert.equal(isUserToken("not a token"), false);
    assert.equal(isSafeCompanionEntry("C:\\voice\\start.cjs"), true);
    assert.equal(isSafeCompanionEntry("/opt/voice/cli.js"), true);
    assert.equal(isSafeCompanionEntry("C:\\voice\\..\\start.cjs"), false);
    assert.equal(isSafeCompanionEntry("start.cjs"), false);
    assert.equal(isSafeCompanionEntry("C:\\voice\\start.cjs.txt"), false);
  });

  it("removes session secrets from text", () => {
    const secret = `failed ${TOKEN} afterwards`;
    assert.equal(redact(secret).includes(TOKEN), false);
    assert.match(redact(secret), REDACTED);
  });
});

describe("reconnect policy", () => {
  it("does not retry authentication or policy failures", () => {
    assert.equal(nextReconnectDelayMs(0, 4004), null);
    assert.equal(nextReconnectDelayMs(0, 4014), null);
    assert.equal(nextReconnectDelayMs(0, 1006), 500);
    assert.equal(nextReconnectDelayMs(4, 1006), 8000);
    assert.equal(nextReconnectDelayMs(5, 1006), null);
  });
});

describe("channel policy", () => {
  it("allows one normal voice channel when the main client is not using that server", () => {
    assert.deepEqual(evaluateJoin(facts()), { ok: true });
  });

  it("refuses stage channels, occupied servers, full channels, and missing permission", () => {
    assert.equal(
      evaluateJoin(facts({ channelType: 13, isStage: true })).ok,
      false
    );
    assert.equal(evaluateJoin(facts({ guildId: null })).ok, false);
    assert.equal(
      evaluateJoin(facts({ channelType: 0, isVoice: false })).ok,
      false
    );
    assert.equal(evaluateJoin(facts({ primaryChannelId: CHANNEL })).ok, false);
    assert.equal(
      evaluateJoin(facts({ connectedCount: 2, userLimit: 2 })).ok,
      false
    );
    assert.equal(evaluateJoin(facts({ canConnect: false })).ok, false);
  });
});

describe("connection registry", () => {
  it("keeps one channel per server until replacement is confirmed", () => {
    const registry = new ConnectionRegistry();
    const first = registry.requestConnect({
      channelId: CHANNEL,
      facts: facts(),
    });
    assert.equal(first.ok, true);
    const second = registry.requestConnect({
      channelId: "12345678901234569",
      facts: facts(),
    });
    assert.deepEqual(second, { ok: false, reason: "replace-required" });
    const replaced = registry.requestConnect({
      channelId: "12345678901234569",
      confirmReplace: true,
      facts: facts(),
    });
    assert.equal(replaced.ok, true);
    if (replaced.ok) {
      assert.equal(replaced.replaced, true);
    }
    assert.equal(registry.get(GUILD)?.channelId, "12345678901234569");
  });

  it("enforces the connection limit and independent controls", () => {
    const registry = new ConnectionRegistry(1);
    assert.equal(
      registry.requestConnect({ channelId: CHANNEL, facts: facts() }).ok,
      true
    );
    const other = facts({ guildId: "22345678901234567", guildName: "Beta" });
    assert.equal(
      registry.requestConnect({ channelId: CHANNEL, facts: other }).ok,
      false
    );
    const updated = registry.updateControls(GUILD, { deafened: true });
    assert.equal(updated.ok, true);
    if (updated.ok) {
      assert.equal(updated.record.controls.muted, true);
      assert.equal(updated.record.controls.transmitting, false);
      assert.equal(updated.record.feasibility.independentControls, true);
      assert.equal(updated.remoteChanged, true);
    }
    const volume = registry.updateControls(GUILD, { volume: 0.4 });
    assert.equal(volume.ok, true);
    if (volume.ok) {
      assert.equal(volume.remoteChanged, false);
    }
  });

  it("merges remote milestones without dropping local control changes", () => {
    const registry = new ConnectionRegistry();
    registry.requestConnect({ channelId: CHANNEL, facts: facts() });
    registry.updateControls(GUILD, { deafened: true });
    registry.applyRemoteStatus({
      channelId: CHANNEL,
      deafened: false,
      error: null,
      feasibility: {
        audiblePlayback: false,
        encryptedReceive: false,
        independentControls: false,
        microphoneTransmit: false,
        secondaryPresence: true,
        teardown: false,
      },
      guildId: GUILD,
      muted: true,
      phase: "ready",
      serverDeafened: false,
      serverMuted: false,
      transmitting: true,
    });
    assert.equal(registry.get(GUILD)?.feasibility.secondaryPresence, true);
    assert.equal(registry.get(GUILD)?.feasibility.independentControls, true);
    assert.equal(JSON.stringify(registry.list()).includes(TOKEN), false);
  });
});

describe("audio and protocol", () => {
  it("mixes speaker audio and detects decoded energy", () => {
    assert.ok(pcmRms(tone(32)) > 0.01);
    const mixer = new AudioMixer();
    mixer.write("a", tone(4, 30_000), 0);
    mixer.write("b", tone(4, 30_000), 0);
    const mixed = mixer.mix(0);
    assert.ok(mixed);
    assert.equal(mixed?.[0], 32_767);
  });

  it("frames audio across partial reads", () => {
    const encoded = encodeAudioFrame({
      guildId: GUILD,
      kind: AUDIO_UP,
      pcm: tone(8),
    });
    const decoder = new AudioFrameDecoder();
    assert.deepEqual(decoder.push(encoded.subarray(0, 5)), []);
    const frames = decoder.push(encoded.subarray(5));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].guildId, GUILD);
    assert.deepEqual(frames[0].pcm, tone(8));
  });

  it("rejects control text that carries a session secret", () => {
    const lines = new LineBuffer();
    assert.deepEqual(lines.push('{"type":"shutdown"}\n{"type":'), [
      '{"type":"shutdown"}',
    ]);
    assert.equal(
      parseCompanionCommand({ guildId: "nope", type: "connect" }),
      null
    );
    const event = parseCompanionEvent({ message: TOKEN, type: "error" }, [
      TOKEN,
    ]);
    assert.equal(event, null);
  });

  it("asks the voice library for DAVE and disables payload debug logs", () => {
    const options = buildVoiceJoinOptions({
      channelId: CHANNEL,
      deafened: false,
      guildId: GUILD,
      muted: true,
    });
    assert.equal(options.daveEncryption, true);
    assert.equal(options.debug, false);
    assert.equal(options.group, "mvc");
  });
});

describe("failure copy", () => {
  it("has user-facing text for every failure", () => {
    for (const [reason, message] of Object.entries(FAILURE_MESSAGES) as [
      ConnectFailure,
      string,
    ][]) {
      assert.equal(message.length > 0, true, reason);
    }
  });
});

describe("feasibility tracker", () => {
  it("records a single control change and ignores silence", () => {
    const tracker = new FeasibilityTracker();
    tracker.noteDecoded(new Uint8Array(8));
    assert.equal(tracker.snapshot().encryptedReceive, false);
    tracker.noteControls(
      { deafened: false, muted: true, transmitting: false, volume: 1 },
      { deafened: true, muted: true, transmitting: false, volume: 1 }
    );
    assert.equal(tracker.snapshot().independentControls, true);
  });
});
