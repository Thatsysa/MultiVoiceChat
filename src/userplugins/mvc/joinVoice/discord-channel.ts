import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildStore, VoiceStateStore } from "@webpack/common";
import type { ChannelFacts } from "../voiceSession/connection-record";
import { isUserToken } from "../voiceSession/validation";

const Authentication = findByPropsLazy("getToken");
const Permissions = findByPropsLazy("can");
const CONNECT = 1_048_576n;

export function getToken(): string | null {
  try {
    const token = Authentication.getToken?.();
    return isUserToken(token) ? token : null;
  } catch {
    return null;
  }
}

export function describeChannel(channelId: string): ChannelFacts | null {
  try {
    const channel = ChannelStore.getChannel?.(channelId);
    if (!channel) {
      return null;
    }
    const guildId = stringOrNull(channel.guild_id ?? channel.guildId);
    const guild = guildId ? GuildStore.getGuild?.(guildId) : null;
    const channelType = typeof channel.type === "number" ? channel.type : null;
    const isStage =
      channelType === 13 || channel.isGuildStageVoice?.() === true;
    const isVoice = channelType === 2 || channel.isGuildVoice?.() === true;
    const userLimit = positiveInteger(channel.userLimit ?? channel.user_limit);
    const states = VoiceStateStore.getVoiceStatesForChannel?.(channelId);
    const connectedCount =
      states && typeof states === "object" ? Object.keys(states).length : 0;
    const primary = guildId
      ? VoiceStateStore.getCurrentClientVoiceChannelId?.(guildId)
      : null;
    return {
      canConnect: canConnect(channel),
      channelName:
        typeof channel.name === "string" ? channel.name : "Voice channel",
      channelType,
      connectedCount,
      guildId,
      guildName: typeof guild?.name === "string" ? guild.name : "Server",
      isStage,
      isVoice,
      primaryChannelId: stringOrNull(primary),
      userLimit,
    };
  } catch {
    return null;
  }
}

function canConnect(channel: unknown): boolean | null {
  try {
    const { can } = Permissions;
    if (typeof can !== "function") {
      return null;
    }
    const result = can(CONNECT, channel);
    return typeof result === "boolean" ? result : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}
