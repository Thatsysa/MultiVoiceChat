import type { AudioFrame } from "../../playback/audio-frames";
import { PlayoutClock } from "../../playback/playout-clock";
import {
  type ConnectionPhase,
  MAX_SECONDARY_CONNECTIONS,
  type RemoteConnectionStatus,
} from "../../voiceSession/connection-record";
import { FeasibilityTracker } from "../../voiceSession/feasibility";
import type { FeasibilityMilestones } from "../../voiceSession/milestones";
import { redact } from "../../voiceSession/redaction";
import { isSnowflake, isUserToken } from "../../voiceSession/validation";
import { GatewaySession } from "./gateway-session";
import type {
  GatewaySocketFactory,
  Scheduler,
  VoiceAdapterCreator,
} from "./runtime";

export interface VoiceHandle {
  destroy: () => void;
  onRemotePcm: (
    listener: (speakerKey: string, pcm: Uint8Array) => void
  ) => void;
  setSpeakingAllowed: (allowed: boolean) => void;
  waitUntilReady: () => Promise<void>;
  writeMicrophone: (pcm: Uint8Array) => void;
}

export interface VoiceJoin {
  adapterCreator: VoiceAdapterCreator;
  channelId: string;
  deafened: boolean;
  guildId: string;
  muted: boolean;
}

export interface VoiceBridge {
  join: (request: VoiceJoin) => VoiceHandle;
}

export interface AudioEndpoint {
  send: (frame: Pick<AudioFrame, "guildId" | "pcm">) => void;
}

export interface SessionListener {
  closed: (guildId: string, feasibility: FeasibilityMilestones) => void;
  error: (message: string) => void;
  status: (status: RemoteConnectionStatus) => void;
}

interface Controls {
  deafened: boolean;
  muted: boolean;
  transmitting: boolean;
}

interface GuildRuntime {
  channelId: string;
  controls: Controls;
  error: string | null;
  gateway: GatewaySession;
  guildId: string;
  phase: ConnectionPhase;
  playout: PlayoutClock;
  serverDeafened: boolean;
  serverMuted: boolean;
  stopClock: () => void;
  tracker: FeasibilityTracker;
  voice: VoiceHandle | null;
}

export interface SessionConnect {
  channelId: string;
  deafened: boolean;
  guildId: string;
  muted: boolean;
  replace: boolean;
  transmitting: boolean;
}

export class SessionManager {
  private token = "";
  private readonly sessions = new Map<string, GuildRuntime>();
  private readonly sockets: GatewaySocketFactory;
  private readonly voices: VoiceBridge;
  private readonly scheduler: Scheduler;
  private readonly listener: SessionListener;
  private readonly audio: AudioEndpoint;
  private readonly now: () => number;

  constructor(
    sockets: GatewaySocketFactory,
    voices: VoiceBridge,
    scheduler: Scheduler,
    listener: SessionListener,
    audio: AudioEndpoint,
    now: () => number = () => Date.now()
  ) {
    this.sockets = sockets;
    this.voices = voices;
    this.scheduler = scheduler;
    this.listener = listener;
    this.audio = audio;
    this.now = now;
  }

  unlock(token: string): void {
    if (!isUserToken(token)) {
      throw new Error("session rejected");
    }
    this.token = token;
  }

  async connect(input: SessionConnect): Promise<void> {
    if (!isUserToken(this.token)) {
      throw new Error("session rejected");
    }
    if (!(isSnowflake(input.guildId) && isSnowflake(input.channelId))) {
      throw new Error("invalid channel");
    }
    const existing = this.sessions.get(input.guildId);
    if (existing && !input.replace) {
      throw new Error("replace-required");
    }
    if (existing) {
      this.disconnect(input.guildId);
    }
    if (this.sessions.size >= MAX_SECONDARY_CONNECTIONS) {
      throw new Error("limit");
    }
    const tracker = new FeasibilityTracker();
    const playout = new PlayoutClock();
    const controls = {
      deafened: input.deafened,
      muted: input.muted,
      transmitting: input.transmitting,
    };
    const gateway = new GatewaySession(
      this.token,
      this.sockets,
      this.scheduler,
      {
        onFatal: (message) => this.fail(input.guildId, message),
        onReconnecting: () => this.mark(input.guildId, "reconnecting", null),
      },
      controls
    );
    const runtime: GuildRuntime = {
      channelId: input.channelId,
      controls,
      error: null,
      gateway,
      guildId: input.guildId,
      phase: "connecting",
      playout,
      serverDeafened: false,
      serverMuted: false,
      stopClock: this.scheduler.setInterval(
        () => this.drain(input.guildId),
        20
      ),
      tracker,
      voice: null,
    };
    this.sessions.set(input.guildId, runtime);
    this.emit(runtime);
    try {
      const ready = await gateway.start();
      if (this.failed(input.guildId)) {
        return;
      }
      const voice = this.voices.join({
        adapterCreator: gateway.createAdapter(
          input.guildId,
          ready.userId,
          (state) => this.applyVoiceState(input.guildId, state)
        ),
        channelId: input.channelId,
        deafened: runtime.controls.deafened,
        guildId: input.guildId,
        muted: runtime.controls.muted,
      });
      runtime.voice = voice;
      voice.onRemotePcm((speaker, pcm) =>
        this.onRemotePcm(input.guildId, speaker, pcm)
      );
      await voice.waitUntilReady();
      if (this.failed(input.guildId)) {
        return;
      }
      runtime.phase = "ready";
      runtime.tracker.notePresence();
      this.syncSpeaking(runtime);
      this.emit(runtime);
    } catch (error) {
      this.fail(
        input.guildId,
        error instanceof Error ? error.message : "voice session stopped"
      );
    }
  }

  update(input: {
    guildId: string;
    muted: boolean;
    deafened: boolean;
    transmitting: boolean;
  }): void {
    const runtime = this.sessions.get(input.guildId);
    if (!runtime) {
      throw new Error("missing-connection");
    }
    const previous = { ...runtime.controls, volume: 1 };
    runtime.controls = {
      deafened: input.deafened,
      muted: input.muted,
      transmitting: !input.muted,
    };
    runtime.tracker.noteControls(previous, { ...runtime.controls, volume: 1 });
    runtime.gateway.updateControls({
      deafened: input.deafened,
      muted: input.muted,
    });
    this.syncSpeaking(runtime);
    this.emit(runtime);
  }

  writeMicrophone(guildId: string, pcm: Uint8Array): void {
    const runtime = this.sessions.get(guildId);
    if (runtime?.phase !== "ready") {
      return;
    }
    if (
      !runtime.controls.transmitting ||
      runtime.controls.muted ||
      runtime.serverMuted
    ) {
      return;
    }
    const before = runtime.tracker.snapshot().microphoneTransmit;
    runtime.voice?.writeMicrophone(pcm);
    runtime.tracker.noteTransmit(pcm);
    if (!before && runtime.tracker.snapshot().microphoneTransmit) {
      this.emit(runtime);
    }
  }

  notePlayback(guildId: string): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime) {
      return;
    }
    const before = runtime.tracker.snapshot().audiblePlayback;
    runtime.tracker.notePlayback();
    if (!before) {
      this.emit(runtime);
    }
  }

  disconnect(guildId: string): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime) {
      return;
    }
    runtime.phase = "disconnecting";
    runtime.stopClock();
    runtime.playout.reset();
    runtime.voice?.destroy();
    runtime.gateway.leave();
    runtime.gateway.close();
    runtime.tracker.noteTeardown();
    const feasibility = runtime.tracker.snapshot();
    this.sessions.delete(guildId);
    this.listener.closed(guildId, feasibility);
  }

  shutdown(): Promise<void> {
    for (const guildId of [...this.sessions.keys()]) {
      this.disconnect(guildId);
    }
    this.token = "";
    return Promise.resolve();
  }

  private applyVoiceState(
    guildId: string,
    state: Record<string, unknown>
  ): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime) {
      return;
    }
    if (typeof state.mute === "boolean") {
      runtime.serverMuted = state.mute;
    }
    if (typeof state.deaf === "boolean") {
      runtime.serverDeafened = state.deaf;
    }
    if (typeof state.self_mute === "boolean") {
      runtime.controls.muted = state.self_mute;
      runtime.controls.transmitting = !state.self_mute;
    }
    if (typeof state.self_deaf === "boolean") {
      runtime.controls.deafened = state.self_deaf;
    }
    this.syncSpeaking(runtime);
    this.emit(runtime);
  }

  private onRemotePcm(
    guildId: string,
    speakerKey: string,
    pcm: Uint8Array
  ): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime || speakerKey.length === 0) {
      return;
    }
    const before = runtime.tracker.snapshot().encryptedReceive;
    runtime.playout.push(speakerKey, pcm, this.now());
    runtime.tracker.noteDecoded(pcm);
    if (!before && runtime.tracker.snapshot().encryptedReceive) {
      this.emit(runtime);
    }
  }

  private drain(guildId: string): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime || runtime.controls.deafened || runtime.serverDeafened) {
      return;
    }
    const frame = runtime.playout.tick();
    if (!frame || runtime.controls.deafened || runtime.serverDeafened) {
      return;
    }
    this.audio.send({ guildId, pcm: frame });
  }

  private syncSpeaking(runtime: GuildRuntime): void {
    runtime.voice?.setSpeakingAllowed(
      runtime.controls.transmitting &&
        !runtime.controls.muted &&
        !runtime.serverMuted
    );
  }

  private mark(
    guildId: string,
    phase: ConnectionPhase,
    error: string | null
  ): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime || runtime.phase === "failed") {
      return;
    }
    runtime.phase = phase;
    runtime.error = error;
    this.emit(runtime);
  }

  private failed(guildId: string): boolean {
    return this.sessions.get(guildId)?.phase === "failed";
  }

  private fail(guildId: string, message: string): void {
    const runtime = this.sessions.get(guildId);
    if (!runtime || runtime.phase === "failed") {
      return;
    }
    runtime.phase = "failed";
    runtime.error = redact(message, [this.token]);
    runtime.stopClock();
    runtime.playout.reset();
    runtime.voice?.destroy();
    runtime.gateway.close();
    this.emit(runtime);
  }

  private emit(runtime: GuildRuntime): void {
    this.listener.status({
      channelId: runtime.channelId,
      deafened: runtime.controls.deafened,
      error: runtime.error,
      feasibility: runtime.tracker.snapshot(),
      guildId: runtime.guildId,
      muted: runtime.controls.muted,
      phase: runtime.phase,
      serverDeafened: runtime.serverDeafened,
      serverMuted: runtime.serverMuted,
      transmitting: runtime.controls.transmitting,
    });
  }
}
