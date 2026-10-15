import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConnectionRegistry } from "../../src/userplugins/mvc/voiceSession/connection-registry";
import {
  type CompanionUiEvent,
  createVoiceController,
  type MicrophonePort,
  type NativePort,
  type PlaybackPort,
} from "../../src/userplugins/mvc/voiceSession/controller";
import { emptyMilestones } from "../../src/userplugins/mvc/voiceSession/milestones";
import { CHANNEL, facts, GUILD, TOKEN, tone } from "./support";

const REDACTED = /\[redacted\]/;

describe("voice controller", () => {
  it("does not read the session before the risk acknowledgement", async () => {
    const native = fakeNative();
    const discord = fakeDiscord();
    const controller = createController(native, discord, () => false);
    assert.equal(await controller.connect(CHANNEL), "risk-not-accepted");
    assert.equal(discord.tokenReads, 0);
    assert.equal(native.tokens.length, 0);
  });

  it("refuses a server already occupied by the main voice connection", async () => {
    const native = fakeNative();
    const discord = fakeDiscord({ primaryChannelId: CHANNEL });
    const controller = createController(native, discord, () => true);
    assert.equal(await controller.connect(CHANNEL), "primary-occupies-guild");
    assert.equal(discord.tokenReads, 0);
  });

  it("keeps the session secret out of stored connection state and plays received audio", async () => {
    const native = fakeNative();
    const playback = fakePlayback();
    const registry = new ConnectionRegistry();
    const controller = createController(
      native,
      fakeDiscord(),
      () => true,
      registry,
      playback
    );
    assert.equal(await controller.connect(CHANNEL), null);
    assert.equal(native.tokens[0], TOKEN);
    assert.equal(JSON.stringify(registry.list()).includes(TOKEN), false);
    native.events.push({
      connection: {
        channelId: CHANNEL,
        deafened: false,
        error: null,
        feasibility: { ...emptyMilestones(), secondaryPresence: true },
        guildId: GUILD,
        muted: false,
        phase: "ready",
        serverDeafened: false,
        serverMuted: false,
        transmitting: true,
      },
      type: "status",
    });
    native.audio.push({ guildId: GUILD, pcm: tone() });
    await controller.poll();
    assert.equal(playback.played.length, 1);
    assert.equal(controller.lastReport.audiblePlayback, true);
  });

  it("redacts a companion failure before storing it", async () => {
    const native = fakeNative();
    native.failNext = `join failed ${TOKEN}`;
    const registry = new ConnectionRegistry();
    const controller = createController(
      native,
      {
        describeChannel() {
          return facts({ guildId: "22345678901234567", guildName: "Beta" });
        },
        getToken() {
          this.tokenReads += 1;
          return TOKEN;
        },
        tokenReads: 0,
      },
      () => true,
      registry
    );
    assert.equal(await controller.connect(CHANNEL), "native");
    assert.equal(JSON.stringify(registry.list()).includes(TOKEN), false);
    assert.match(registry.get("22345678901234567")?.error ?? "", REDACTED);
  });

  it("requires confirmation before replacing a server and transmits only when that control is on", async () => {
    const native = fakeNative();
    const microphone = fakeMicrophone();
    const registry = new ConnectionRegistry();
    const controller = createController(
      native,
      fakeDiscord(),
      () => true,
      registry,
      fakePlayback(),
      microphone
    );
    assert.equal(await controller.connect(CHANNEL), null);
    assert.equal(await controller.connect(CHANNEL), "replace-required");
    assert.equal(native.connects, 1);
    native.events.push({
      connection: {
        channelId: CHANNEL,
        deafened: false,
        error: null,
        feasibility: emptyMilestones(),
        guildId: GUILD,
        muted: true,
        phase: "ready",
        serverDeafened: false,
        serverMuted: false,
        transmitting: false,
      },
      type: "status",
    });
    await controller.poll();
    assert.equal(
      await controller.setControls(GUILD, { transmitting: true }),
      null
    );
    assert.equal(await controller.setControls(GUILD, { muted: false }), null);
    await controller.poll();
    microphone.push(tone());
    await controller.poll();
    assert.equal(native.microphoneFrames, 1);
    const report = registry.remove(GUILD);
    assert.equal(report?.teardown, true);
  });

  it("plays one batch per guild and ignores an overlapping poll", async () => {
    const native = fakeNative();
    const playback = fakePlayback();
    const registry = new ConnectionRegistry();
    const controller = createController(
      native,
      fakeDiscord(),
      () => true,
      registry,
      playback
    );
    assert.equal(await controller.connect(CHANNEL), null);
    native.events.push({
      connection: {
        channelId: CHANNEL,
        deafened: false,
        error: null,
        feasibility: emptyMilestones(),
        guildId: GUILD,
        muted: true,
        phase: "ready",
        serverDeafened: false,
        serverMuted: false,
        transmitting: false,
      },
      type: "status",
    });
    native.audio.push(
      { guildId: GUILD, pcm: Uint8Array.of(1, 0, 2, 0) },
      { guildId: GUILD, pcm: Uint8Array.of(3, 0, 4, 0) },
      { guildId: GUILD, pcm: Uint8Array.of(5, 0, 6, 0) }
    );
    let releasePull: () => void = () => undefined;
    const entered: number[] = [];
    const originalPull = native.pullAudio.bind(native);
    native.pullAudio = async () => {
      entered.push(entered.length + 1);
      if (entered.length === 1) {
        await new Promise<void>((resolve) => {
          releasePull = resolve;
        });
      }
      return originalPull();
    };
    const first = controller.poll();
    const second = controller.poll();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered.length, 1);
    releasePull();
    await first;
    await second;
    assert.equal(entered.length, 1);
    assert.equal(playback.played.length, 1);
    assert.equal(playback.played[0]?.byteLength, 12);
    assert.equal(native.acks, 1);
  });
});

function createController(
  native: NativePort,
  discord: ReturnType<typeof fakeDiscord>,
  riskAccepted: () => boolean,
  registry = new ConnectionRegistry(),
  playback = fakePlayback(),
  microphone = fakeMicrophone()
) {
  return createVoiceController({
    companionEntry: () => "C:\\voice\\start.cjs",
    discord,
    interval: () => () => undefined,
    microphone,
    native,
    playback,
    registry,
    riskAccepted,
  });
}

function fakeDiscord(overrides: Parameters<typeof facts>[0] = {}) {
  return {
    describeChannel() {
      return facts(overrides);
    },
    getToken() {
      this.tokenReads += 1;
      return TOKEN;
    },
    tokenReads: 0,
  };
}

function fakeNative(): NativePort & {
  tokens: string[];
  connects: number;
  events: CompanionUiEvent[];
  audio: Array<{ guildId: string; pcm: Uint8Array }>;
  microphoneFrames: number;
  acks: number;
  failNext: string | null;
} {
  const native = {
    acks: 0,
    audio: [] as Array<{ guildId: string; pcm: Uint8Array }>,
    connect(request: { token: string }) {
      native.connects += 1;
      native.tokens.push(request.token);
      if (native.failNext) {
        const error = native.failNext;
        native.failNext = null;
        return Promise.resolve({ error, ok: false as const });
      }
      return Promise.resolve({ ok: true as const });
    },
    connects: 0,
    disconnect() {
      return Promise.resolve({ ok: true as const });
    },
    events: [] as CompanionUiEvent[],
    failNext: null as string | null,
    microphoneFrames: 0,
    playbackAck() {
      native.acks += 1;
      return Promise.resolve({ ok: true as const });
    },
    probe() {
      return Promise.resolve({
        droppedMs: 0,
        gapMaxMs: 20,
        gapMinMs: 20,
        ok: true as const,
        outputFrames: 1,
        pcm: Uint8Array.of(1, 0, 1, 0),
        queuedMs: 0,
        receivedFrames: 1,
        toneOk: false,
        underruns: 0,
      });
    },
    pullAudio() {
      return Promise.resolve(native.audio.splice(0));
    },
    pullEvents() {
      return Promise.resolve(native.events.splice(0));
    },
    pushAudio() {
      native.microphoneFrames += 1;
      return Promise.resolve({ ok: true as const });
    },
    shutdown() {
      return Promise.resolve();
    },
    tokens: [] as string[],
    update() {
      return Promise.resolve({ ok: true as const });
    },
  };
  return native;
}

function fakePlayback(): PlaybackPort & { played: Uint8Array[] } {
  const played: Uint8Array[] = [];
  return {
    play(_guildId, pcm) {
      played.push(pcm);
    },
    played,
    reset() {
      /* unused */
    },
    stats() {
      return null;
    },
    stop() {
      /* unused */
    },
    stopAll() {
      /* unused */
    },
  };
}

function fakeMicrophone(): MicrophonePort & {
  push: (frame: Uint8Array) => void;
} {
  let callback: ((frame: Uint8Array) => void) | null = null;
  return {
    push(frame) {
      callback?.(frame);
    },
    start(onFrame) {
      callback = onFrame;
      return Promise.resolve();
    },
    stop() {
      callback = null;
    },
  };
}
