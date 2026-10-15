import {
  buildIdentify,
  normalizeVoicePayload,
} from "../../companionLink/identify";
import {
  isFatalGatewayClose,
  nextReconnectDelayMs,
} from "../../voiceSession/reconnect";
import type {
  GatewayHandlers,
  GatewaySocket,
  GatewaySocketFactory,
  Scheduler,
  VoiceAdapterLibrary,
} from "./runtime";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

export interface GatewayControls {
  deafened: boolean;
  muted: boolean;
}

export interface GatewayEvents {
  onFatal: (message: string) => void;
  onReconnecting: () => void;
}

interface VoiceBinding {
  guildId: string;
  library: VoiceAdapterLibrary;
  onState: (data: Record<string, unknown>) => void;
  userId: string;
}

export class GatewaySession {
  private socket: GatewaySocket | null = null;
  private generation = 0;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private userId: string | null = null;
  private guildId: string | null = null;
  private channelId: string | null = null;
  private binding: VoiceBinding | null = null;
  private stopHeartbeat: (() => void) | null = null;
  private waitingAck = false;
  private reconnectAttempt = 0;
  private identifyAttempts = 0;
  private shouldResume = false;
  private closed = false;
  private reconnecting = false;
  private settled = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ready: Promise<{ userId: string }>;
  private resolveReady: (value: { userId: string }) => void = () => undefined;
  private rejectReady: (error: Error) => void = () => undefined;
  private readonly token: string;
  private readonly sockets: GatewaySocketFactory;
  private readonly scheduler: Scheduler;
  private readonly events: GatewayEvents;
  private controls: GatewayControls;

  constructor(
    token: string,
    sockets: GatewaySocketFactory,
    scheduler: Scheduler,
    events: GatewayEvents,
    controls: GatewayControls
  ) {
    this.token = token;
    this.sockets = sockets;
    this.scheduler = scheduler;
    this.events = events;
    this.controls = controls;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => undefined);
  }

  start(): Promise<{ userId: string }> {
    this.openSocket();
    this.readyTimer = setTimeout(() => {
      if (!this.settled) {
        this.fail("voice session stopped");
      }
    }, 15_000);
    this.readyTimer.unref?.();
    return this.ready;
  }

  createAdapter(
    guildId: string,
    userId: string,
    onState: (data: Record<string, unknown>) => void
  ) {
    return (library: VoiceAdapterLibrary) => {
      this.binding = { guildId, library, onState, userId };
      this.guildId = guildId;
      return {
        destroy: () => {
          if (this.binding?.library === library) {
            this.binding = null;
          }
        },
        sendPayload: (payload: { op: number; d?: Record<string, unknown> }) =>
          this.sendPayload(payload),
      };
    };
  }

  leave(): void {
    if (this.closed || !this.guildId) {
      return;
    }
    this.sendPayload({
      d: {
        channel_id: null,
        guild_id: this.guildId,
        self_deaf: this.controls.deafened,
        self_mute: this.controls.muted,
        self_video: false,
      },
      op: 4,
    });
  }

  updateControls(controls: GatewayControls): boolean {
    this.controls = controls;
    if (!(this.guildId && this.channelId)) {
      return false;
    }
    return this.sendPayload({
      d: {
        channel_id: this.channelId,
        guild_id: this.guildId,
        self_deaf: controls.deafened,
        self_mute: controls.muted,
        self_video: false,
      },
      op: 4,
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearReadyTimer();
    this.generation += 1;
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    this.binding?.library.destroy();
    this.binding = null;
    this.socket?.close();
    this.socket = null;
    if (!this.settled) {
      this.settled = true;
      this.rejectReady(new Error("voice session stopped"));
    }
  }

  private openSocket(): void {
    this.generation += 1;
    const { generation } = this;
    const handlers: GatewayHandlers = {
      close: (code) => {
        if (generation === this.generation && !this.closed) {
          this.reconnect(code);
        }
      },
      error: () => {
        if (generation === this.generation && !this.closed) {
          this.reconnect(1006);
        }
      },
      message: (data) => {
        if (generation === this.generation) {
          this.onMessage(data);
        }
      },
      open: () => undefined,
    };
    this.socket = this.sockets.connect(GATEWAY_URL, handlers);
  }

  private onMessage(data: string): void {
    let message: { op?: unknown; d?: unknown; s?: unknown; t?: unknown };
    try {
      message = JSON.parse(data) as {
        op?: unknown;
        d?: unknown;
        s?: unknown;
        t?: unknown;
      };
    } catch {
      return;
    }
    if (message.op === 10) {
      const hello = asRecord(message.d);
      const interval = hello?.heartbeat_interval;
      if (typeof interval !== "number" || interval < 1000) {
        this.fail("voice session stopped");
        return;
      }
      this.startHeartbeat(interval);
      if (this.shouldResume && this.sessionId) {
        this.sendResume();
      } else {
        this.sendIdentify();
      }
      return;
    }
    if (message.op === 11) {
      this.waitingAck = false;
      this.reconnectAttempt = 0;
      return;
    }
    if (message.op === 9) {
      this.shouldResume = message.d === true;
      if (!this.shouldResume) {
        this.sessionId = null;
      }
      this.reconnect(4009);
      return;
    }
    if (message.op === 7) {
      this.shouldResume = true;
      this.reconnect(4000);
      return;
    }
    if (message.op !== 0) {
      return;
    }
    if (typeof message.s === "number") {
      this.sequence = message.s;
    }
    this.onDispatch(message.t, message.d);
  }

  private onDispatch(name: unknown, data: unknown): void {
    if (name === "READY") {
      this.handleReady(data);
      return;
    }
    if (name === "RESUMED") {
      return;
    }
    if (name === "VOICE_STATE_UPDATE") {
      this.handleVoiceState(data);
      return;
    }
    if (name === "VOICE_SERVER_UPDATE") {
      this.handleVoiceServer(data);
    }
  }

  private handleReady(data: unknown): void {
    const ready = asRecord(data);
    const user = asRecord(ready?.user);
    const userId = user?.id;
    const sessionId = ready?.session_id;
    if (typeof userId !== "string" || typeof sessionId !== "string") {
      this.fail("gateway session was incomplete");
      return;
    }
    this.userId = userId;
    this.sessionId = sessionId;
    this.shouldResume = true;
    if (!this.settled) {
      this.settled = true;
      this.clearReadyTimer();
      this.resolveReady({ userId });
    }
  }

  private handleVoiceState(data: unknown): void {
    const state = asRecord(data);
    if (!(state && this.binding) || state.guild_id !== this.binding.guildId) {
      return;
    }
    if (state.user_id !== this.userId || state.session_id !== this.sessionId) {
      return;
    }
    this.binding.onState(state);
    this.binding.library.onVoiceStateUpdate(state);
  }

  private handleVoiceServer(data: unknown): void {
    const server = asRecord(data);
    if (!(server && this.binding) || server.guild_id !== this.binding.guildId) {
      return;
    }
    if (server.endpoint === null) {
      this.fail("voice server did not provide an endpoint");
      return;
    }
    this.binding.library.onVoiceServerUpdate(server);
  }

  private sendIdentify(): void {
    this.identifyAttempts += 1;
    if (this.identifyAttempts > 2) {
      this.fail("authentication failed");
      return;
    }
    this.socket?.send(JSON.stringify(buildIdentify(this.token)));
  }

  private sendResume(): void {
    this.socket?.send(
      JSON.stringify({
        d: {
          seq: this.sequence,
          session_id: this.sessionId,
          token: this.token,
        },
        op: 6,
      })
    );
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat?.();
    const beat = () => {
      if (this.closed) {
        return;
      }
      if (this.waitingAck) {
        this.reconnect(1006);
        return;
      }
      this.waitingAck = true;
      this.socket?.send(JSON.stringify({ d: this.sequence, op: 1 }));
    };
    this.stopHeartbeat = this.scheduler.setInterval(beat, intervalMs);
  }

  private sendPayload(payload: {
    op: number;
    d?: Record<string, unknown>;
  }): boolean {
    if (!this.socket || this.closed) {
      return false;
    }
    const normalized = normalizeVoicePayload(payload, this.controls);
    if (normalized.op === 4 && normalized.d) {
      if (typeof normalized.d.guild_id === "string") {
        this.guildId = normalized.d.guild_id;
      }
      if (typeof normalized.d.channel_id === "string") {
        this.channelId = normalized.d.channel_id;
      }
      if (normalized.d.channel_id === null) {
        this.channelId = null;
      }
    }
    try {
      this.socket.send(JSON.stringify(normalized));
      return true;
    } catch {
      return false;
    }
  }

  private reconnect(closeCode: number): void {
    if (this.closed || this.reconnecting) {
      return;
    }
    const delay = nextReconnectDelayMs(this.reconnectAttempt, closeCode);
    this.reconnectAttempt += 1;
    this.reconnecting = true;
    this.waitingAck = false;
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    this.generation += 1;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    if (delay === null) {
      this.fail(
        isFatalGatewayClose(closeCode)
          ? "authentication failed"
          : "voice session stopped"
      );
      return;
    }
    this.events.onReconnecting();
    this.scheduler.setTimeout(() => {
      this.reconnecting = false;
      if (!this.closed) {
        this.openSocket();
      }
    }, delay);
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) {
      return;
    }
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private fail(message: string): void {
    if (!this.settled) {
      this.settled = true;
      this.clearReadyTimer();
      this.rejectReady(new Error(message));
    }
    this.events.onFatal(message);
    this.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
