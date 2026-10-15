import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AudioSocket,
  type CompanionChild,
  CompanionSupervisor,
} from "../../src/userplugins/mvc/companionLink/supervisor";
import {
  AUDIO_DOWN,
  type AudioFrame,
  AudioFrameDecoder,
  encodeAudioFrame,
} from "../../src/userplugins/mvc/playback/audio-frames";
import { CHANNEL, GUILD, TOKEN, tick, tone } from "./support";

const REDACTED = /\[redacted\]/;

describe("companion supervisor", () => {
  it("redacts secrets from companion output and forwards audio", async () => {
    const logs: string[] = [];
    const spawned: { child?: FakeChild } = {};
    const audio = new FakeAudio();
    const supervisor = new CompanionSupervisor(
      () => {
        const created = new FakeChild();
        spawned.child = created;
        return created;
      },
      async () => audio,
      { error: (message) => logs.push(message) },
      500
    );
    const pending = supervisor.connect({
      channelId: CHANNEL,
      companionEntry: "C:\\voice\\start.cjs",
      deafened: false,
      guildId: GUILD,
      muted: true,
      replace: false,
      token: TOKEN,
      transmitting: false,
    });
    await tick();
    const { child } = spawned;
    assert.ok(child);
    child.emit(
      `${JSON.stringify({ audioPort: 7, protocol: 1, type: "ready" })}\n`
    );
    await pending;
    child.emitStderr(`${TOKEN}\n`);
    child.emit(`${JSON.stringify({ message: TOKEN, type: "error" })}\n`);
    audio.emit(
      encodeAudioFrame({ guildId: GUILD, kind: AUDIO_DOWN, pcm: tone(8) })
    );
    assert.equal(
      logs.some((line) => line.includes(TOKEN)),
      false
    );
    assert.match(logs.join("\n"), REDACTED);
    assert.equal(
      supervisor
        .pullEvents()
        .some((event) => JSON.stringify(event).includes(TOKEN)),
      false
    );
    assert.equal(supervisor.pullAudio()[0]?.guildId, GUILD);
    const written = child.writes.join("\n");
    assert.equal(written.includes('"type":"unlock"'), true);
    await supervisor.shutdown();
  });

  it("drops the oldest playback frames when the native queue is under pressure", async () => {
    const spawned: { child?: FakeChild } = {};
    const audio = new FakeAudio();
    const supervisor = new CompanionSupervisor(
      () => {
        const created = new FakeChild();
        spawned.child = created;
        return created;
      },
      async () => audio,
      {
        error() {
          /* unused */
        },
      },
      500
    );
    const pending = supervisor.connect({
      channelId: CHANNEL,
      companionEntry: "C:\\voice\\start.cjs",
      deafened: false,
      guildId: GUILD,
      muted: true,
      replace: false,
      token: TOKEN,
      transmitting: false,
    });
    await tick();
    const { child } = spawned;
    assert.ok(child);
    child.emit(
      `${JSON.stringify({ audioPort: 7, protocol: 1, type: "ready" })}\n`
    );
    await pending;
    audio.emit(
      encodeAudioFrame({ guildId: GUILD, kind: AUDIO_DOWN, pcm: tone(4, 1) })
    );
    for (let index = 0; index < 40; index += 1) {
      audio.emit(
        encodeAudioFrame({
          guildId: GUILD,
          kind: AUDIO_DOWN,
          pcm: tone(4, index + 2),
        })
      );
    }
    const queued = supervisor.pullAudio();
    assert.equal(queued.length, 32);
    assert.notEqual(queued[0]?.pcm[0], tone(4, 1)[0]);
    await supervisor.shutdown();
  });
});

class FakeChild implements CompanionChild {
  readonly writes: string[] = [];
  private stdout: (chunk: string) => void = () => undefined;
  private stderr: (chunk: string) => void = () => undefined;
  private exit: (code: number | null) => void = () => undefined;

  write(data: string): void {
    this.writes.push(data);
    const command = JSON.parse(data) as { type?: string };
    if (command.type === "unlock") {
      this.emit(`${JSON.stringify({ type: "unlocked" })}\n`);
    }
  }

  emit(chunk: string): void {
    this.stdout(chunk);
  }

  emitStderr(chunk: string): void {
    this.stderr(chunk);
  }

  onStdout(listener: (chunk: string) => void): void {
    this.stdout = listener;
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderr = listener;
  }

  onExit(listener: (code: number | null) => void): void {
    this.exit = listener;
  }

  kill(): void {
    this.exit(0);
  }
}

class FakeAudio implements AudioSocket {
  private listener: (frame: AudioFrame) => void = () => undefined;
  private readonly decoder = new AudioFrameDecoder();

  send(): void {
    /* unused */
  }

  onFrame(listener: (frame: AudioFrame) => void): void {
    this.listener = listener;
  }

  close(): void {
    /* unused */
  }

  emit(bytes: Uint8Array): void {
    for (const frame of this.decoder.push(bytes)) {
      this.listener(frame);
    }
  }
}
