import type { ConnectFailure } from "./connection-record";

export const FAILURE_MESSAGES: Record<ConnectFailure, string> = {
  "channel-full": "That voice channel is full.",
  "companion-entry":
    "Set the absolute path to the built companion start.cjs before connecting.",
  "guild-only": "Secondary voice is limited to one channel in a server.",
  "invalid-channel":
    "That channel could not be used for a secondary voice connection.",
  limit:
    "The secondary connection limit has been reached. Disconnect one server first.",
  "missing-connect-permission":
    "You do not have permission to connect to that voice channel.",
  "missing-connection":
    "That server does not have a secondary voice connection.",
  native: "The voice companion could not complete that request.",
  "not-voice": "Choose a server voice channel.",
  "primary-occupies-guild":
    "This server already uses the main Discord voice connection.",
  "replace-required":
    "This server already has a secondary voice connection. Confirm before replacing it.",
  "stage-unsupported": "Stage channels are not supported.",
  "token-unavailable":
    "The current Discord session could not be read. Reconnect Discord and try again.",
};

export function failureMessage(failure: ConnectFailure): string {
  return FAILURE_MESSAGES[failure];
}
