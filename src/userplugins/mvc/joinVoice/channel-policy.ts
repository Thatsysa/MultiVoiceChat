import type {
  ChannelFacts,
  JoinRefusal,
} from "../voiceSession/connection-record";

export function evaluateJoin(
  facts: ChannelFacts
): { ok: true } | { ok: false; reason: JoinRefusal } {
  if (!facts.guildId) {
    return { ok: false, reason: "guild-only" };
  }
  if (facts.isStage || facts.channelType === 13) {
    return { ok: false, reason: "stage-unsupported" };
  }
  if (!facts.isVoice && facts.channelType !== 2) {
    return { ok: false, reason: "not-voice" };
  }
  if (facts.primaryChannelId) {
    return { ok: false, reason: "primary-occupies-guild" };
  }
  if (facts.canConnect === false) {
    return { ok: false, reason: "missing-connect-permission" };
  }
  if (facts.userLimit > 0 && facts.connectedCount >= facts.userLimit) {
    return { ok: false, reason: "channel-full" };
  }
  return { ok: true };
}
