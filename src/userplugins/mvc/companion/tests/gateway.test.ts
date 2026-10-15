import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GatewaySession } from "../src/gateway-session";
import {
  CHANNEL,
  FakeSockets,
  GUILD,
  hello,
  ManualScheduler,
  ready,
  TOKEN,
} from "./support";

describe("gateway session", () => {
  it("identifies once and routes only this session's voice events", async () => {
    const sockets = new FakeSockets();
    const fatal: string[] = [];
    const states: unknown[] = [];
    const servers: unknown[] = [];
    const session = new GatewaySession(
      TOKEN,
      sockets,
      new ManualScheduler(),
      {
        onFatal(message) {
          fatal.push(message);
        },
        onReconnecting() {
          /* unused */
        },
      },
      { deafened: false, muted: true }
    );
    const pending = session.start();
    const [socket] = sockets.sockets;
    hello(socket);
    ready(socket);
    await pending;
    const identify = socket.sent
      .map((line) => JSON.parse(line))
      .find((payload) => payload.op === 2);
    assert.equal(identify.d.token, TOKEN);
    const adapter = session.createAdapter(GUILD, "99", (state) =>
      states.push(state)
    );
    const library = {
      destroy() {
        /* unused */
      },
      onVoiceServerUpdate: (data: Record<string, unknown>) =>
        servers.push(data),
      onVoiceStateUpdate: (data: Record<string, unknown>) => states.push(data),
    };
    const implementer = adapter(library);
    assert.equal(
      implementer.sendPayload({
        d: {
          channel_id: CHANNEL,
          guild_id: GUILD,
          self_deaf: true,
          self_mute: false,
        },
        op: 4,
      }),
      true
    );
    const voicePayload = JSON.parse(socket.sent.at(-1) ?? "{}");
    assert.equal(voicePayload.d.self_mute, true);
    assert.equal(voicePayload.d.self_video, false);
    socket.message(
      JSON.stringify({
        d: {
          channel_id: CHANNEL,
          guild_id: GUILD,
          session_id: "other-session",
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
          guild_id: "22345678901234567",
          token: "voice-token",
        },
        op: 0,
        s: 3,
        t: "VOICE_SERVER_UPDATE",
      })
    );
    assert.equal(states.length, 0);
    assert.equal(servers.length, 0);
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
        s: 4,
        t: "VOICE_STATE_UPDATE",
      })
    );
    socket.message(
      JSON.stringify({
        d: { endpoint: "voice.example", guild_id: GUILD, token: "voice-token" },
        op: 0,
        s: 5,
        t: "VOICE_SERVER_UPDATE",
      })
    );
    assert.equal(states.length, 2);
    assert.equal(servers.length, 1);
    assert.equal(JSON.stringify(fatal).includes(TOKEN), false);
    session.close();
  });

  it("does not open another socket after authentication failure", async () => {
    const sockets = new FakeSockets();
    const fatal: string[] = [];
    const session = new GatewaySession(
      TOKEN,
      sockets,
      new ManualScheduler(),
      {
        onFatal(message) {
          fatal.push(message);
        },
        onReconnecting() {
          /* unused */
        },
      },
      { deafened: false, muted: true }
    );
    const pending = session.start();
    hello(sockets.sockets[0]);
    sockets.sockets[0].remoteClose(4004);
    await assert.rejects(pending);
    assert.equal(sockets.sockets.length, 1);
    assert.equal(fatal.includes("authentication failed"), true);
    assert.equal(fatal.join(" ").includes(TOKEN), false);
  });

  it("reconnects a stalled heartbeat through the scheduler", async () => {
    const sockets = new FakeSockets();
    const scheduler = new ManualScheduler();
    const session = new GatewaySession(
      TOKEN,
      sockets,
      scheduler,
      {
        onFatal() {
          /* unused */
        },
        onReconnecting() {
          /* unused */
        },
      },
      { deafened: false, muted: false }
    );
    const pending = session.start();
    hello(sockets.sockets[0]);
    ready(sockets.sockets[0]);
    await pending;
    scheduler.fireIntervals();
    scheduler.fireIntervals();
    scheduler.fireTimeouts();
    assert.equal(sockets.sockets.length, 2);
    session.close();
  });
});
