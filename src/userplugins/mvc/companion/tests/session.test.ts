import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemoteConnectionStatus } from "../../voiceSession/connection-record";
import type { FeasibilityMilestones } from "../../voiceSession/milestones";
import { MILESTONE_ORDER } from "../../voiceSession/milestones";
import {
  SessionManager,
  type VoiceBridge,
  type VoiceHandle,
  type VoiceJoin,
} from "../src/session-manager";
import {
  CHANNEL,
  FakeSockets,
  GUILD,
  hello,
  ManualScheduler,
  ready,
  TOKEN,
  tick,
  tone,
} from "./support";

class FakeVoiceHandle implements VoiceHandle {
  speaking = true;
  readonly microphone: Uint8Array[] = [];
  private listener: (speakerKey: string, pcm: Uint8Array) => void = () =>
    undefined;
  private resolveReady: () => void = () => undefined;
  private readonly ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  markReady(): void {
    this.resolveReady();
  }

  setSpeakingAllowed(allowed: boolean): void {
    this.speaking = allowed;
  }

  writeMicrophone(pcm: Uint8Array): void {
    this.microphone.push(pcm);
  }

  onRemotePcm(listener: (speakerKey: string, pcm: Uint8Array) => void): void {
    this.listener = listener;
  }

  emitRemote(pcm: Uint8Array): void {
    this.listener("speaker", pcm);
  }

  destroy(): void {
    this.resolveReady();
  }
}

class FakeVoices implements VoiceBridge {
  readonly handles: FakeVoiceHandle[] = [];

  join(request: VoiceJoin): VoiceHandle {
    const handle = new FakeVoiceHandle();
    this.handles.push(handle);
    const adapter = request.adapterCreator({
      destroy() {
        /* unused */
      },
      onVoiceServerUpdate() {
        /* unused */
      },
      onVoiceStateUpdate() {
        /* unused */
      },
    });
    adapter.sendPayload({
      d: {
        channel_id: request.channelId,
        guild_id: request.guildId,
        self_deaf: request.deafened,
        self_mute: request.muted,
      },
      op: 4,
    });
    return handle;
  }
}

describe("secondary session feasibility", () => {
  it("records presence, receive, playback, transmit, controls, and teardown in order", async () => {
    const sockets = new FakeSockets();
    const voices = new FakeVoices();
    const playback: Uint8Array[] = [];
    const statuses: RemoteConnectionStatus[] = [];
    let closed: FeasibilityMilestones | null = null;
    const scheduler = new ManualScheduler();
    const manager = new SessionManager(
      sockets,
      voices,
      scheduler,
      {
        closed: (_guildId, feasibility) => {
          closed = feasibility;
        },
        error() {
          /* unused */
        },
        status: (status) => statuses.push(status),
      },
      { send: (frame) => playback.push(frame.pcm) }
    );
    manager.unlock(TOKEN);
    const pending = manager.connect({
      channelId: CHANNEL,
      deafened: false,
      guildId: GUILD,
      muted: true,
      replace: false,
      transmitting: false,
    });
    const [socket] = sockets.sockets;
    hello(socket);
    ready(socket);
    await tick();
    assert.equal(voices.handles.length, 1);
    socket.message(
      JSON.stringify({
        d: {
          channel_id: CHANNEL,
          deaf: false,
          guild_id: GUILD,
          mute: false,
          self_deaf: false,
          self_mute: true,
          session_id: "session-a",
          user_id: "99",
        },
        op: 0,
        s: 2,
        t: "VOICE_STATE_UPDATE",
      })
    );
    socket.message(
      JSON.stringify({
        d: {
          endpoint: "voice.example",
          guild_id: GUILD,
          token: "voice-server-secret",
        },
        op: 0,
        s: 3,
        t: "VOICE_SERVER_UPDATE",
      })
    );
    voices.handles[0].markReady();
    await pending;
    voices.handles[0].emitRemote(tone(1920));
    voices.handles[0].emitRemote(tone(1920));
    voices.handles[0].emitRemote(tone(1920));
    scheduler.fireIntervals();
    manager.notePlayback(GUILD);
    manager.update({
      deafened: false,
      guildId: GUILD,
      muted: false,
      transmitting: true,
    });
    assert.equal(voices.handles[0].speaking, true);
    manager.writeMicrophone(GUILD, tone());
    manager.update({
      deafened: true,
      guildId: GUILD,
      muted: false,
      transmitting: true,
    });
    await manager.disconnect(GUILD);
    const observed = milestoneOrder(statuses, closed);
    assert.deepEqual(observed, [...MILESTONE_ORDER]);
    assert.ok(playback.length > 0);
    assert.equal(voices.handles[0].microphone.length, 1);
    const serialized = JSON.stringify({
      closed,
      playbackLength: playback.length,
      statuses,
    });
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes("voice-server-secret"), false);
  });

  it("uses a separate gateway socket for a second server", async () => {
    const sockets = new FakeSockets();
    const voices = new FakeVoices();
    const manager = new SessionManager(
      sockets,
      voices,
      { setInterval: () => () => undefined, setTimeout: () => () => undefined },
      {
        closed() {
          /* unused */
        },
        error() {
          /* unused */
        },
        status() {
          /* unused */
        },
      },
      {
        send() {
          /* unused */
        },
      }
    );
    manager.unlock(TOKEN);
    const first = connect(
      manager,
      sockets,
      voices,
      GUILD,
      CHANNEL,
      "session-a",
      0
    );
    await first;
    const secondGuild = "22345678901234567";
    const second = connect(
      manager,
      sockets,
      voices,
      secondGuild,
      CHANNEL,
      "session-b",
      1
    );
    await second;
    assert.equal(sockets.sockets.length, 2);
    await assert.rejects(() =>
      manager.connect({
        channelId: CHANNEL,
        deafened: false,
        guildId: GUILD,
        muted: true,
        replace: false,
        transmitting: false,
      })
    );
    await manager.shutdown();
    assert.equal(sockets.sockets.length >= 2, true);
  });
});

async function connect(
  manager: SessionManager,
  sockets: FakeSockets,
  voices: FakeVoices,
  guildId: string,
  channelId: string,
  sessionId: string,
  handleIndex: number
): Promise<void> {
  const before = sockets.sockets.length;
  const pending = manager.connect({
    channelId,
    deafened: false,
    guildId,
    muted: true,
    replace: false,
    transmitting: false,
  });
  const socket = sockets.sockets[before];
  hello(socket);
  ready(socket, sessionId);
  await tick();
  voices.handles[handleIndex].markReady();
  await pending;
}

function milestoneOrder(
  statuses: RemoteConnectionStatus[],
  closed: FeasibilityMilestones | null
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const note = (milestones: FeasibilityMilestones) => {
    for (const name of MILESTONE_ORDER) {
      if (milestones[name] && !seen.has(name)) {
        seen.add(name);
        order.push(name);
      }
    }
  };
  for (const status of statuses) {
    note(status.feasibility);
  }
  if (closed) {
    note(closed);
  }
  return order;
}
