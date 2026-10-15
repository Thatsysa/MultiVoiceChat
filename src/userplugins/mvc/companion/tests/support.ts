import type { ChannelFacts } from "../../voiceSession/connection-record";
import type { GatewayHandlers, Scheduler } from "../src/runtime";

export const GUILD = "12345678901234567";
export const CHANNEL = "12345678901234568";
export const TOKEN = `${"a".repeat(24)}.${"b".repeat(6)}.${"c".repeat(27)}`;

export function facts(overrides: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    canConnect: true,
    channelName: "General",
    channelType: 2,
    connectedCount: 0,
    guildId: GUILD,
    guildName: "Alpha",
    isStage: false,
    isVoice: true,
    primaryChannelId: null,
    userLimit: 0,
    ...overrides,
  };
}

export function tone(samples = 32, amplitude = 16_000): Uint8Array {
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples; index += 1) {
    view.setInt16(index * 2, index % 2 === 0 ? amplitude : -amplitude, true);
  }
  return bytes;
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class ManualScheduler implements Scheduler {
  private intervals: Array<() => void> = [];
  private timeouts: Array<() => void> = [];

  setInterval(fn: () => void): () => void {
    this.intervals.push(fn);
    return () => {
      this.intervals = this.intervals.filter((item) => item !== fn);
    };
  }

  setTimeout(fn: () => void): () => void {
    this.timeouts.push(fn);
    return () => {
      this.timeouts = this.timeouts.filter((item) => item !== fn);
    };
  }

  fireIntervals(): void {
    for (const fn of [...this.intervals]) {
      fn();
    }
  }

  fireTimeouts(): void {
    for (const fn of this.timeouts.splice(0)) {
      fn();
    }
  }
}

export class FakeSocket {
  readonly sent: string[] = [];
  private readonly handlers: GatewayHandlers;

  constructor(handlers: GatewayHandlers) {
    this.handlers = handlers;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.handlers.close(1000);
  }

  remoteClose(code: number): void {
    this.handlers.close(code);
  }

  message(data: string): void {
    this.handlers.message(data);
  }
}

export class FakeSockets {
  readonly sockets: FakeSocket[] = [];

  connect(_url: string, handlers: GatewayHandlers): FakeSocket {
    const socket = new FakeSocket(handlers);
    this.sockets.push(socket);
    return socket;
  }
}

export function hello(socket: FakeSocket): void {
  socket.message(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
}

export function ready(
  socket: FakeSocket,
  sessionId = "session-a",
  userId = "99"
): void {
  socket.message(
    JSON.stringify({
      d: { session_id: sessionId, user: { id: userId } },
      op: 0,
      s: 1,
      t: "READY",
    })
  );
}
