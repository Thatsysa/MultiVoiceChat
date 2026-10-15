import type { FeasibilityMilestones } from "./milestones";

export const MAX_SECONDARY_CONNECTIONS = 8;

export type ConnectionPhase =
  | "connecting"
  | "ready"
  | "reconnecting"
  | "failed"
  | "disconnecting";

export interface VoiceControls {
  deafened: boolean;
  muted: boolean;
  transmitting: boolean;
  volume: number;
}

export interface ConnectionRecord {
  channelId: string;
  channelName: string;
  controls: VoiceControls;
  error: string | null;
  feasibility: FeasibilityMilestones;
  guildId: string;
  guildName: string;
  phase: ConnectionPhase;
  serverDeafened: boolean;
  serverMuted: boolean;
}

export type JoinRefusal =
  | "guild-only"
  | "not-voice"
  | "stage-unsupported"
  | "primary-occupies-guild"
  | "channel-full"
  | "missing-connect-permission"
  | "invalid-channel";

export type ConnectFailure =
  | "risk-not-accepted"
  | "companion-entry"
  | "token-unavailable"
  | "replace-required"
  | "limit"
  | "native"
  | "missing-connection"
  | JoinRefusal;

export interface ChannelFacts {
  canConnect: boolean | null;
  channelName: string;
  channelType: number | null;
  connectedCount: number;
  guildId: string | null;
  guildName: string;
  isStage: boolean;
  isVoice: boolean;
  primaryChannelId: string | null;
  userLimit: number;
}

export interface RemoteConnectionStatus {
  channelId: string;
  deafened: boolean;
  error: string | null;
  feasibility: FeasibilityMilestones;
  guildId: string;
  muted: boolean;
  phase: ConnectionPhase;
  serverDeafened: boolean;
  serverMuted: boolean;
  transmitting: boolean;
}

export function defaultControls(): VoiceControls {
  return {
    deafened: false,
    muted: true,
    transmitting: false,
    volume: 1,
  };
}

export function cloneRecord(record: ConnectionRecord): ConnectionRecord {
  return {
    ...record,
    controls: { ...record.controls },
    feasibility: { ...record.feasibility },
  };
}
