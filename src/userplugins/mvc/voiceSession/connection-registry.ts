import { evaluateJoin } from "../joinVoice/channel-policy";
import {
  type ChannelFacts,
  type ConnectFailure,
  type ConnectionPhase,
  type ConnectionRecord,
  cloneRecord,
  defaultControls,
  MAX_SECONDARY_CONNECTIONS,
  type RemoteConnectionStatus,
  type VoiceControls,
} from "./connection-record";
import { FeasibilityTracker } from "./feasibility";
import { type FeasibilityMilestones, mergeMilestones } from "./milestones";
import { isSnowflake, normalizeVolume } from "./validation";

export interface ConnectRequest {
  channelId: string;
  confirmReplace?: boolean;
  facts: ChannelFacts;
}

export type ConnectDecision =
  | { ok: true; record: ConnectionRecord; replaced: boolean }
  | { ok: false; reason: ConnectFailure };

interface InternalConnection extends ConnectionRecord {
  tracker: FeasibilityTracker;
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, InternalConnection>();
  private readonly listeners = new Set<() => void>();
  private readonly maxConnections: number;

  constructor(maxConnections = MAX_SECONDARY_CONNECTIONS) {
    this.maxConnections = maxConnections;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): ConnectionRecord[] {
    return [...this.connections.values()]
      .map((connection) => cloneRecord(connection))
      .sort(
        (left, right) =>
          left.guildName.localeCompare(right.guildName) ||
          left.channelName.localeCompare(right.channelName)
      );
  }

  get(guildId: string): ConnectionRecord | undefined {
    const connection = this.connections.get(guildId);
    return connection ? cloneRecord(connection) : undefined;
  }

  requestConnect(request: ConnectRequest): ConnectDecision {
    const { guildId } = request.facts;
    if (!(isSnowflake(request.channelId) && isSnowflake(guildId))) {
      return { ok: false, reason: "invalid-channel" };
    }
    const policy = evaluateJoin(request.facts);
    if (!policy.ok) {
      return policy;
    }
    const existing = this.connections.get(guildId);
    if (existing && !request.confirmReplace) {
      return { ok: false, reason: "replace-required" };
    }
    if (!existing && this.connections.size >= this.maxConnections) {
      return { ok: false, reason: "limit" };
    }
    const record = this.create(
      guildId,
      request.channelId,
      request.facts.guildName,
      request.facts.channelName
    );
    this.connections.set(guildId, record);
    this.emit();
    return {
      ok: true,
      record: cloneRecord(record),
      replaced: Boolean(existing),
    };
  }

  updateControls(
    guildId: string,
    patch: Partial<VoiceControls>
  ):
    | { ok: true; record: ConnectionRecord; remoteChanged: boolean }
    | { ok: false; reason: "missing-connection" | "invalid-channel" } {
    const connection = this.connections.get(guildId);
    if (!connection) {
      return { ok: false, reason: "missing-connection" };
    }
    const next: VoiceControls = { ...connection.controls };
    let remoteChanged = false;
    if (patch.muted !== undefined) {
      if (typeof patch.muted !== "boolean") {
        return { ok: false, reason: "invalid-channel" };
      }
      const transmitting = !patch.muted;
      remoteChanged ||=
        next.muted !== patch.muted || next.transmitting !== transmitting;
      next.muted = patch.muted;
      next.transmitting = transmitting;
    }
    if (patch.deafened !== undefined) {
      if (typeof patch.deafened !== "boolean") {
        return { ok: false, reason: "invalid-channel" };
      }
      remoteChanged ||= next.deafened !== patch.deafened;
      next.deafened = patch.deafened;
    }
    if (patch.volume !== undefined) {
      const volume = normalizeVolume(patch.volume);
      if (volume === null) {
        return { ok: false, reason: "invalid-channel" };
      }
      next.volume = volume;
    }
    connection.tracker.noteControls(connection.controls, next);
    connection.controls = next;
    connection.feasibility = connection.tracker.snapshot();
    this.emit();
    return { ok: true, record: cloneRecord(connection), remoteChanged };
  }

  markPhase(
    guildId: string,
    phase: ConnectionPhase,
    error: string | null = null
  ): void {
    const connection = this.connections.get(guildId);
    if (!connection) {
      return;
    }
    connection.phase = phase;
    connection.error = error;
    this.emit();
  }

  applyRemoteStatus(status: RemoteConnectionStatus): void {
    const connection = this.connections.get(status.guildId);
    if (!connection || connection.channelId !== status.channelId) {
      return;
    }
    const nextControls: VoiceControls = {
      ...connection.controls,
      deafened: status.deafened,
      muted: status.muted,
      transmitting: status.transmitting,
    };
    connection.tracker.noteControls(connection.controls, nextControls);
    connection.phase = status.phase;
    connection.controls = nextControls;
    connection.serverMuted = status.serverMuted;
    connection.serverDeafened = status.serverDeafened;
    connection.error = status.error;
    connection.feasibility = mergeMilestones(
      connection.tracker.snapshot(),
      status.feasibility
    );
    this.emit();
  }

  remove(guildId: string): FeasibilityMilestones | null {
    const connection = this.connections.get(guildId);
    if (!connection) {
      return null;
    }
    connection.tracker.noteTeardown();
    const feasibility = mergeMilestones(
      connection.tracker.snapshot(),
      connection.feasibility
    );
    this.connections.delete(guildId);
    this.emit();
    return feasibility;
  }

  private create(
    guildId: string,
    channelId: string,
    guildName: string,
    channelName: string
  ): InternalConnection {
    const tracker = new FeasibilityTracker();
    return {
      channelId,
      channelName: channelName || "Voice channel",
      controls: defaultControls(),
      error: null,
      feasibility: tracker.snapshot(),
      guildId,
      guildName: guildName || "Server",
      phase: "connecting",
      serverDeafened: false,
      serverMuted: false,
      tracker,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
