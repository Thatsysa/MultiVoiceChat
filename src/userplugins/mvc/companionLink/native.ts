import { failureMessage } from "../voiceSession/messages";
import {
  asPcmBytes,
  isBoolean,
  isSafeCompanionEntry,
  isSnowflake,
  isUserToken,
} from "../voiceSession/validation";
import {
  CompanionSupervisor,
  connectLoopbackAudio,
  spawnCompanionProcess,
} from "./supervisor";

const supervisor = new CompanionSupervisor(
  spawnCompanionProcess,
  connectLoopbackAudio,
  {
    error(message) {
      console.error(`[MVC] ${message}`);
    },
  }
);

export async function connect(
  _event: unknown,
  request: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const command = parseConnect(request);
  if (!command) {
    return { error: failureMessage("invalid-channel"), ok: false };
  }
  return await supervisor.connect(command);
}

export async function update(
  _event: unknown,
  request: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const command = parseUpdate(request);
  if (!command) {
    return { error: failureMessage("invalid-channel"), ok: false };
  }
  return await supervisor.update(command);
}

export async function disconnect(
  _event: unknown,
  guildId: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSnowflake(guildId)) {
    return { error: failureMessage("invalid-channel"), ok: false };
  }
  return await supervisor.disconnect(guildId);
}

export async function shutdown(_event: unknown): Promise<{ ok: true }> {
  await supervisor.shutdown();
  return { ok: true };
}

export async function probe(
  _event: unknown,
  request: unknown
): Promise<
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
> {
  const record = asRecord(request);
  if (
    !(record && isSafeCompanionEntry(record.companionEntry)) ||
    (record.kind !== "transport" && record.kind !== "opus")
  ) {
    return { error: failureMessage("companion-entry"), ok: false };
  }
  try {
    const result = await supervisor.probe(record.companionEntry, record.kind);
    return { ok: true, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "voice companion stopped";
    return { error: message, ok: false };
  }
}

export async function pullEvents(
  _event: unknown
): Promise<ReturnType<CompanionSupervisor["pullEvents"]>> {
  return await supervisor.pullEvents();
}

export async function pullAudio(
  _event: unknown
): Promise<Array<{ guildId: string; pcm: Uint8Array }>> {
  return await supervisor.pullAudio();
}

export async function pushAudio(
  _event: unknown,
  guildId: unknown,
  pcm: unknown
): Promise<{ ok: boolean; error?: string }> {
  const bytes = asPcmBytes(pcm);
  if (!(isSnowflake(guildId) && bytes)) {
    return { error: failureMessage("invalid-channel"), ok: false };
  }
  return await supervisor.pushAudio(guildId, bytes);
}

export async function playbackAck(
  _event: unknown,
  guildId: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!isSnowflake(guildId)) {
    return { error: failureMessage("invalid-channel"), ok: false };
  }
  return await supervisor.playbackAck(guildId);
}

function parseConnect(value: unknown): {
  companionEntry: string;
  token: string;
  guildId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  transmitting: boolean;
  replace: boolean;
} | null {
  const record = asRecord(value);
  if (
    !(
      record &&
      isSafeCompanionEntry(record.companionEntry) &&
      isUserToken(record.token)
    )
  ) {
    return null;
  }
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
    companionEntry: record.companionEntry,
    deafened: record.deafened,
    guildId: record.guildId,
    muted: record.muted,
    replace: record.replace,
    token: record.token,
    transmitting: record.transmitting,
  };
}

function parseUpdate(value: unknown): {
  guildId: string;
  muted: boolean;
  deafened: boolean;
  transmitting: boolean;
} | null {
  const record = asRecord(value);
  if (!(record && isSnowflake(record.guildId))) {
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
  return {
    deafened: record.deafened,
    guildId: record.guildId,
    muted: record.muted,
    transmitting: record.transmitting,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
