export interface VoiceLibraryJoinOptions {
  channelId: string;
  daveEncryption: true;
  debug: false;
  group: "mvc";
  guildId: string;
  selfDeaf: boolean;
  selfMute: boolean;
}

export function buildVoiceJoinOptions(input: {
  channelId: string;
  guildId: string;
  muted: boolean;
  deafened: boolean;
}): VoiceLibraryJoinOptions {
  return {
    channelId: input.channelId,
    daveEncryption: true,
    debug: false,
    group: "mvc",
    guildId: input.guildId,
    selfDeaf: input.deafened,
    selfMute: input.muted,
  };
}
