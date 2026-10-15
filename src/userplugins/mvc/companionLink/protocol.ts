import type { RemoteConnectionStatus } from "../voiceSession/connection-record";
import type { FeasibilityMilestones } from "../voiceSession/milestones";
import { redact } from "../voiceSession/redaction";
import {
  isBoolean,
  isSnowflake,
  isUserToken,
} from "../voiceSession/validation";

export type CompanionCommand =
  | { type: "unlock"; token: string }
  | {
      type: "connect";
      guildId: string;
      channelId: string;
      muted: boolean;
      deafened: boolean;
      transmitting: boolean;
      replace: boolean;
    }
  | {
      type: "update";
      guildId: string;
      muted: boolean;
      deafened: boolean;
      transmitting: boolean;
    }
  | { type: "disconnect"; guildId: string }
  | { type: "playback"; guildId: string }
  | { type: "probe"; kind: "transport" | "opus" }
  | { type: "shutdown" };

export type CompanionEvent =
  | { type: "ready"; protocol: 1; audioPort: number }
  | { type: "unlocked" }
  | { type: "status"; connection: RemoteConnectionStatus }
  | { type: "closed"; guildId: string; feasibility: FeasibilityMilestones }
  | { type: "error"; message: string }
  | {
      type: "probe";
      kind: "transport" | "opus";
      receivedFrames: number;
      outputFrames: number;
      queuedMs: number;
      underruns: number;
      droppedMs: number;
      gapMinMs: number;
      gapMaxMs: number;
      toneOk: boolean;
    };

const PHASES = new Set([
  "connecting",
  "ready",
  "reconnecting",
  "failed",
  "disconnecting",
]);

export function parseCompanionCommand(value: unknown): CompanionCommand | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  switch (record.type) {
    case "unlock":
      return isUserToken(record.token)
        ? { token: record.token, type: "unlock" }
        : null;
    case "shutdown":
      return { type: "shutdown" };
    case "disconnect":
      return isSnowflake(record.guildId)
        ? { guildId: record.guildId, type: "disconnect" }
        : null;
    case "playback":
      return isSnowflake(record.guildId)
        ? { guildId: record.guildId, type: "playback" }
        : null;
    case "probe":
      return parseProbeCommand(record);
    case "update":
      return parseUpdateCommand(record);
    case "connect":
      return parseConnectCommand(record);
    default:
      return null;
  }
}

function parseProbeCommand(
  record: Record<string, unknown>
): CompanionCommand | null {
  if (record.kind !== "transport" && record.kind !== "opus") {
    return null;
  }
  return { kind: record.kind, type: "probe" };
}

function parseUpdateCommand(
  record: Record<string, unknown>
): CompanionCommand | null {
  if (
    !(
      isSnowflake(record.guildId) &&
      isBoolean(record.muted) &&
      isBoolean(record.deafened) &&
      isBoolean(record.transmitting)
    )
  ) {
    return null;
  }
  return {
    deafened: record.deafened,
    guildId: record.guildId,
    muted: record.muted,
    transmitting: record.transmitting,
    type: "update",
  };
}

function parseConnectCommand(
  record: Record<string, unknown>
): CompanionCommand | null {
  if (!(isSnowflake(record.guildId) && isSnowflake(record.channelId))) {
    return null;
  }
  if (
    !(
      isBoolean(record.muted) &&
      isBoolean(record.deafened) &&
      isBoolean(record.transmitting) &&
      isBoolean(record.replace)
    )
  ) {
    return null;
  }
  return {
    channelId: record.channelId,
    deafened: record.deafened,
    guildId: record.guildId,
    muted: record.muted,
    replace: record.replace,
    transmitting: record.transmitting,
    type: "connect",
  };
}

export function parseCompanionEvent(
  value: unknown,
  secrets: readonly string[] = []
): CompanionEvent | null {
  const serialized = JSON.stringify(value);
  if (
    secrets.some((secret) => secret.length >= 8 && serialized.includes(secret))
  ) {
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (record.type === "unlocked") {
    return { type: "unlocked" };
  }
  if (record.type === "ready") {
    const { audioPort } = record;
    if (
      record.protocol !== 1 ||
      typeof audioPort !== "number" ||
      !Number.isInteger(audioPort) ||
      audioPort < 1 ||
      audioPort > 65_535
    ) {
      return null;
    }
    return { audioPort, protocol: 1, type: "ready" };
  }
  if (record.type === "error") {
    if (typeof record.message !== "string") {
      return null;
    }
    return {
      message: redact(record.message, secrets).slice(0, 200),
      type: "error",
    };
  }
  if (record.type === "closed") {
    const feasibility = parseMilestones(record.feasibility);
    if (!(isSnowflake(record.guildId) && feasibility)) {
      return null;
    }
    return { feasibility, guildId: record.guildId, type: "closed" };
  }
  if (record.type === "status") {
    const connection = parseStatus(record.connection, secrets);
    return connection ? { connection, type: "status" } : null;
  }
  if (record.type === "probe") {
    return parseProbe(record);
  }
  return null;
}

function parseProbe(record: Record<string, unknown>): CompanionEvent | null {
  if (record.kind !== "transport" && record.kind !== "opus") {
    return null;
  }
  const numbers = [
    "receivedFrames",
    "outputFrames",
    "queuedMs",
    "underruns",
    "droppedMs",
    "gapMinMs",
    "gapMaxMs",
  ] as const;
  const parsed = {} as Record<(typeof numbers)[number], number>;
  for (const name of numbers) {
    if (typeof record[name] !== "number" || !Number.isFinite(record[name])) {
      return null;
    }
    parsed[name] = record[name];
  }
  if (!isBoolean(record.toneOk)) {
    return null;
  }
  return { kind: record.kind, toneOk: record.toneOk, type: "probe", ...parsed };
}

function parseStatus(
  value: unknown,
  secrets: readonly string[]
): RemoteConnectionStatus | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (!(isSnowflake(record.guildId) && isSnowflake(record.channelId))) {
    return null;
  }
  if (typeof record.phase !== "string" || !PHASES.has(record.phase)) {
    return null;
  }
  if (
    !(
      isBoolean(record.muted) &&
      isBoolean(record.deafened) &&
      isBoolean(record.transmitting)
    )
  ) {
    return null;
  }
  if (!(isBoolean(record.serverMuted) && isBoolean(record.serverDeafened))) {
    return null;
  }
  if (record.error !== null && typeof record.error !== "string") {
    return null;
  }
  const feasibility = parseMilestones(record.feasibility);
  if (!feasibility) {
    return null;
  }
  return {
    channelId: record.channelId,
    deafened: record.deafened,
    error:
      record.error === null
        ? null
        : redact(record.error, secrets).slice(0, 200),
    feasibility,
    guildId: record.guildId,
    muted: record.muted,
    phase: record.phase as RemoteConnectionStatus["phase"],
    serverDeafened: record.serverDeafened,
    serverMuted: record.serverMuted,
    transmitting: record.transmitting,
  };
}

function parseMilestones(value: unknown): FeasibilityMilestones | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const names = [
    "secondaryPresence",
    "encryptedReceive",
    "audiblePlayback",
    "microphoneTransmit",
    "independentControls",
    "teardown",
  ] as const;
  const milestones = {} as FeasibilityMilestones;
  for (const name of names) {
    if (!isBoolean(record[name])) {
      return null;
    }
    milestones[name] = record[name];
  }
  return milestones;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
