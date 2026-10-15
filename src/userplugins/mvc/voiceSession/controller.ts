import { concatPcm } from "../playback/playback-buffer";
import {
  type AudioDiagnostics,
  analyzeTone,
  emptyDiagnostics,
  PROBE_GUILD_ID,
  synthesizeTone,
} from "../playback/probe-tone";
import type {
  ChannelFacts,
  ConnectFailure,
  RemoteConnectionStatus,
  VoiceControls,
} from "./connection-record";
import type { ConnectionRegistry } from "./connection-registry";
import { failureMessage } from "./messages";
import {
  emptyMilestones,
  type FeasibilityMilestones,
  mergeMilestones,
} from "./milestones";
import { redact } from "./redaction";
import { isSafeCompanionEntry, isUserToken } from "./validation";

export interface DiscordPort {
  describeChannel: (channelId: string) => ChannelFacts | null;
  getToken: () => string | null;
}

interface NativeResult {
  error?: string;
  ok: boolean;
}

interface NativeConnectRequest {
  channelId: string;
  companionEntry: string;
  deafened: boolean;
  guildId: string;
  muted: boolean;
  replace: boolean;
  token: string;
  transmitting: boolean;
}

export interface NativePort {
  connect: (request: NativeConnectRequest) => Promise<NativeResult>;
  disconnect: (guildId: string) => Promise<NativeResult>;
  playbackAck: (guildId: string) => Promise<NativeResult>;
  probe: (request: {
    companionEntry: string;
    kind: "transport" | "opus";
  }) => Promise<
    | {
        ok: true;
        pcm: Uint8Array;
        receivedFrames: number;
        outputFrames: number;
        queuedMs: number;
        underruns: number;
        droppedMs: number;
        gapMinMs: number;
        gapMaxMs: number;
        toneOk: boolean;
      }
    | { ok: false; error: string }
  >;
  pullAudio: () => Promise<Array<{ guildId: string; pcm: Uint8Array }>>;
  pullEvents: () => Promise<CompanionUiEvent[]>;
  pushAudio: (guildId: string, pcm: Uint8Array) => Promise<NativeResult>;
  shutdown: () => Promise<void>;
  update: (request: {
    guildId: string;
    muted: boolean;
    deafened: boolean;
    transmitting: boolean;
  }) => Promise<NativeResult>;
}

export type CompanionUiEvent =
  | { type: "status"; connection: RemoteConnectionStatus }
  | { type: "closed"; guildId: string; feasibility: FeasibilityMilestones }
  | { type: "error"; message: string };

export interface PlaybackPort {
  play: (guildId: string, pcm: Uint8Array, volume: number) => void;
  reset: (guildId: string) => void;
  stats: (
    guildId: string
  ) => { queuedMs: number; underruns: number; droppedMs: number } | null;
  stop: (guildId: string) => void;
  stopAll: () => void;
}

export interface MicrophonePort {
  start: (onFrame: (pcm: Uint8Array) => void) => Promise<void>;
  stop: () => void;
}

export interface VoiceController {
  connect: (
    channelId: string,
    confirmReplace?: boolean
  ) => Promise<ConnectFailure | null>;
  readonly diagnostics: AudioDiagnostics;
  disconnect: (guildId: string) => Promise<ConnectFailure | null>;
  readonly lastError: string | null;
  readonly lastReport: FeasibilityMilestones;
  poll: () => Promise<void>;
  runProbe: (kind: "renderer" | "transport" | "opus") => Promise<void>;
  setControls: (
    guildId: string,
    patch: Partial<VoiceControls>
  ) => Promise<ConnectFailure | null>;
  shutdown: () => Promise<void>;
}

export function createVoiceController(deps: {
  discord: DiscordPort;
  native: NativePort;
  registry: ConnectionRegistry;
  companionEntry: () => string;
  playback: PlaybackPort;
  microphone: MicrophonePort;
  interval: (fn: () => void, ms: number) => () => void;
}): VoiceController {
  let lastError: string | null = null;
  let lastReport = emptyMilestones();
  let diagnostics = emptyDiagnostics();
  let micStarted = false;
  const micQueue: Uint8Array[] = [];
  let polling = false;
  const stopInterval = deps.interval(() => {
    poll();
  }, 20);

  async function connect(
    channelId: string,
    confirmReplace = false
  ): Promise<ConnectFailure | null> {
    const entry = deps.companionEntry();
    if (!isSafeCompanionEntry(entry)) {
      return fail("companion-entry");
    }
    const facts = deps.discord.describeChannel(channelId);
    if (!facts) {
      return fail("invalid-channel");
    }
    const decision = deps.registry.requestConnect({
      channelId,
      confirmReplace,
      facts,
    });
    if (!decision.ok) {
      return fail(decision.reason);
    }
    const token = deps.discord.getToken();
    if (!isUserToken(token)) {
      deps.registry.markPhase(
        decision.record.guildId,
        "failed",
        failureMessage("token-unavailable")
      );
      return fail("token-unavailable");
    }
    let result: NativeResult;
    try {
      result = await deps.native.connect({
        channelId: decision.record.channelId,
        companionEntry: entry,
        deafened: decision.record.controls.deafened,
        guildId: decision.record.guildId,
        muted: decision.record.controls.muted,
        replace: decision.replaced,
        token,
        transmitting: decision.record.controls.transmitting,
      });
    } catch (error) {
      const message = redact(
        error instanceof Error ? error.message : failureMessage("native")
      );
      deps.registry.markPhase(decision.record.guildId, "failed", message);
      lastError = message;
      return "native";
    }
    if (!result.ok) {
      const message = redact(result.error ?? failureMessage("native"));
      deps.registry.markPhase(decision.record.guildId, "failed", message);
      lastError = message;
      return "native";
    }
    lastError = null;
    return null;
  }

  async function setControls(
    guildId: string,
    patch: Partial<VoiceControls>
  ): Promise<ConnectFailure | null> {
    const updated = deps.registry.updateControls(guildId, patch);
    if (!updated.ok) {
      return fail(updated.reason);
    }
    if (!updated.remoteChanged) {
      return null;
    }
    const result = await deps.native.update({
      deafened: updated.record.controls.deafened,
      guildId,
      muted: updated.record.controls.muted,
      transmitting: updated.record.controls.transmitting,
    });
    if (!result.ok) {
      lastError = redact(result.error ?? failureMessage("native"));
      return "native";
    }
    lastReport = mergeMilestones(lastReport, updated.record.feasibility);
    return null;
  }

  async function disconnect(guildId: string): Promise<ConnectFailure | null> {
    if (!deps.registry.get(guildId)) {
      return fail("missing-connection");
    }
    deps.registry.markPhase(guildId, "disconnecting");
    const result = await deps.native.disconnect(guildId);
    if (!result.ok) {
      const message = redact(result.error ?? failureMessage("native"));
      deps.registry.markPhase(guildId, "failed", message);
      lastError = message;
      return "native";
    }
    const report = deps.registry.remove(guildId);
    if (report) {
      lastReport = mergeMilestones(lastReport, report);
    }
    deps.playback.stop(guildId);
    lastError = null;
    return null;
  }

  async function applyEvents(): Promise<void> {
    const events = await deps.native.pullEvents();
    for (const event of events) {
      if (event.type === "status") {
        deps.registry.applyRemoteStatus(event.connection);
        lastReport = mergeMilestones(lastReport, event.connection.feasibility);
      } else if (event.type === "closed") {
        const report = deps.registry.remove(event.guildId);
        lastReport = mergeMilestones(
          lastReport,
          mergeMilestones(event.feasibility, report ?? emptyMilestones())
        );
        deps.playback.stop(event.guildId);
      } else {
        lastError = redact(event.message);
      }
    }
  }

  async function playFrames(): Promise<void> {
    const frames = await deps.native.pullAudio();
    const grouped = new Map<string, Uint8Array[]>();
    for (const frame of frames) {
      const chunks = grouped.get(frame.guildId) ?? [];
      chunks.push(frame.pcm);
      grouped.set(frame.guildId, chunks);
    }
    for (const [guildId, chunks] of grouped) {
      const connection = deps.registry.get(guildId);
      if (
        connection?.phase !== "ready" ||
        connection.controls.deafened ||
        connection.controls.volume <= 0
      ) {
        deps.playback.reset(guildId);
        continue;
      }
      deps.playback.play(
        guildId,
        concatPcm(chunks),
        connection.controls.volume
      );
      // biome-ignore lint/performance/noAwaitInLoops: each guild ack must finish before the next
      const ack = await deps.native.playbackAck(guildId);
      if (ack.ok) {
        lastReport = { ...lastReport, audiblePlayback: true };
      }
    }
  }

  async function transmit(): Promise<void> {
    const transmitters = deps.registry
      .list()
      .filter(
        (connection) =>
          connection.phase === "ready" &&
          connection.controls.transmitting &&
          !connection.controls.muted &&
          !connection.serverMuted
      );
    if (transmitters.length === 0) {
      if (micStarted) {
        deps.microphone.stop();
      }
      micStarted = false;
      micQueue.length = 0;
      return;
    }
    if (!micStarted) {
      micStarted = true;
      try {
        await deps.microphone.start((microphoneFrame) => {
          if (micQueue.length < 8) {
            micQueue.push(microphoneFrame);
          }
        });
      } catch {
        micStarted = false;
        lastError = "Microphone permission was denied.";
        return;
      }
    }
    const frame = micQueue.shift();
    if (!frame) {
      return;
    }
    for (const connection of transmitters) {
      // biome-ignore lint/performance/noAwaitInLoops: microphone frames must be sent in order
      await deps.native.pushAudio(connection.guildId, frame);
    }
  }

  async function poll(): Promise<void> {
    if (polling) {
      return;
    }
    polling = true;
    try {
      await applyEvents();
      await playFrames();
      await transmit();
    } finally {
      polling = false;
    }
  }

  async function runProbe(
    kind: "renderer" | "transport" | "opus"
  ): Promise<void> {
    if (kind === "renderer") {
      const pcm = synthesizeTone(1000);
      deps.playback.play(PROBE_GUILD_ID, pcm, 0.25);
      diagnostics = {
        ...emptyDiagnostics(),
        gapMaxMs: 20,
        gapMinMs: 20,
        outputFrames: 50,
        receivedFrames: 50,
        toneOk: analyzeTone(pcm),
      };
      return;
    }
    const result = await deps.native.probe({
      companionEntry: deps.companionEntry(),
      kind,
    });
    if (!result.ok) {
      lastError = result.error;
      diagnostics = { ...emptyDiagnostics(), toneOk: false };
      return;
    }
    deps.playback.play(PROBE_GUILD_ID, result.pcm, 0.25);
    diagnostics = {
      droppedMs: result.droppedMs,
      gapMaxMs: result.gapMaxMs,
      gapMinMs: result.gapMinMs,
      outputFrames: result.outputFrames,
      queuedMs: result.queuedMs,
      receivedFrames: result.receivedFrames,
      toneOk: result.toneOk && analyzeTone(result.pcm),
      underruns: result.underruns,
    };
  }

  async function shutdown(): Promise<void> {
    stopInterval();
    if (micStarted) {
      deps.microphone.stop();
    }
    deps.playback.stopAll();
    for (const connection of deps.registry.list()) {
      deps.registry.remove(connection.guildId);
    }
    await deps.native.shutdown();
  }

  function fail(reason: ConnectFailure): ConnectFailure {
    lastError = failureMessage(reason);
    return reason;
  }

  return {
    connect,
    get diagnostics() {
      return diagnostics;
    },
    disconnect,
    get lastError() {
      return lastError;
    },
    get lastReport() {
      return lastReport;
    },
    poll,
    runProbe,
    setControls,
    shutdown,
  };
}
