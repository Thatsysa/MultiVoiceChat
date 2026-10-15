export function buildIdentify(token: string): {
  op: 2;
  d: Record<string, unknown>;
} {
  return {
    d: {
      capabilities: 1_734_653,
      client_state: {
        api_code_version: 0,
        guild_versions: {},
      },
      compress: false,
      presence: {
        activities: [],
        afk: false,
        since: 0,
        status: "unknown",
      },
      properties: {
        browser: "Discord Client",
        device: "",
        os: "Windows",
      },
      token,
    },
    op: 2,
  };
}

export function normalizeVoicePayload(
  payload: { op: number; d?: Record<string, unknown> },
  controls: { muted: boolean; deafened: boolean }
): { op: number; d?: Record<string, unknown> } {
  if (payload.op !== 4 || !payload.d) {
    return payload;
  }
  return {
    d: {
      ...payload.d,
      self_deaf: controls.deafened,
      self_mute: controls.muted,
      self_video: false,
    },
    op: 4,
  };
}
