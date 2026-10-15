import { useCallback, useEffect, useState } from "@webpack/common";
import type {
  ConnectionPhase,
  ConnectionRecord,
  VoiceControls,
} from "../voiceSession/connection-record";
import type { ConnectionRegistry } from "../voiceSession/connection-registry";
import type { VoiceController } from "../voiceSession/controller";

export function SecondaryVoicePanel({
  controller,
  registry,
}: {
  controller: VoiceController;
  registry: ConnectionRegistry;
}) {
  const [version, setVersion] = useState(0);
  useEffect(
    () => registry.subscribe(() => setVersion((value) => value + 1)),
    [registry]
  );
  const connections = registry.list();
  if (connections.length === 0) {
    return null;
  }
  return (
    <div className="mvc-voice-stack" data-refresh={version}>
      {connections.map((connection) => (
        <SecondaryVoiceCard
          connection={connection}
          controller={controller}
          key={connection.guildId}
        />
      ))}
    </div>
  );
}

function SecondaryVoiceCard({
  connection,
  controller,
}: {
  connection: ConnectionRecord;
  controller: VoiceController;
}) {
  const { controls } = connection;
  const changeControls = useCallback(
    (patch: Partial<VoiceControls>) => {
      controller.setControls(connection.guildId, patch);
    },
    [connection.guildId, controller]
  );
  const toggleMuted = useCallback(() => {
    changeControls({ muted: !controls.muted });
  }, [changeControls, controls.muted]);
  const toggleDeafened = useCallback(() => {
    changeControls({ deafened: !controls.deafened });
  }, [changeControls, controls.deafened]);
  const changeVolume = useCallback(
    (event: { target: { value: string } }) => {
      changeControls({ volume: Number(event.target.value) / 100 });
    },
    [changeControls]
  );
  const disconnect = useCallback(() => {
    controller.disconnect(connection.guildId);
  }, [connection.guildId, controller]);
  const muted = controls.muted || connection.serverMuted;
  const deafened = controls.deafened || connection.serverDeafened;
  return (
    <section className="mvc-voice-card">
      <div className="mvc-voice-head">
        <span className={markClass(connection.phase)}>
          <SignalIcon />
        </span>
        <div className="mvc-voice-titles">
          <div className={statusClass(connection.phase)}>
            {statusLabel(connection.phase)}
            {connection.error ? ` — ${connection.error}` : ""}
          </div>
          <div className="mvc-voice-subtitle">
            {connection.channelName} / {connection.guildName}
          </div>
        </div>
        <button
          aria-label="Disconnect"
          className="mvc-voice-hangup"
          onClick={disconnect}
          type="button"
        >
          <PhoneIcon />
        </button>
      </div>
      <div className="mvc-voice-actions">
        <button
          aria-label={connection.serverMuted ? "Mute, server muted" : "Mute"}
          aria-pressed={muted}
          className={muted ? "mvc-voice-action is-danger" : "mvc-voice-action"}
          onClick={toggleMuted}
          type="button"
        >
          <MicIcon crossed={muted} />
        </button>
        <button
          aria-label={
            connection.serverDeafened ? "Deafen, server deafened" : "Deafen"
          }
          aria-pressed={deafened}
          className={
            deafened ? "mvc-voice-action is-danger" : "mvc-voice-action"
          }
          onClick={toggleDeafened}
          type="button"
        >
          <HeadphonesIcon crossed={deafened} />
        </button>
      </div>
      <input
        aria-label="Volume"
        className="mvc-voice-volume"
        max={100}
        min={0}
        onChange={changeVolume}
        type="range"
        value={Math.round(controls.volume * 100)}
      />
    </section>
  );
}

function statusLabel(phase: ConnectionPhase): string {
  switch (phase) {
    case "ready":
      return "Secondary";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "failed":
      return "Failed";
    case "disconnecting":
      return "Disconnecting";
    default:
      return phase;
  }
}

function statusClass(phase: ConnectionPhase): string {
  if (phase === "ready") {
    return "mvc-voice-status";
  }
  if (phase === "failed") {
    return "mvc-voice-status is-failed";
  }
  return "mvc-voice-status is-busy";
}

function markClass(phase: ConnectionPhase): string {
  if (phase === "ready") {
    return "mvc-voice-mark";
  }
  if (phase === "failed") {
    return "mvc-voice-mark is-failed";
  }
  return "mvc-voice-mark is-busy";
}

function SignalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 8a5 5 0 0 1 4.3 2.5 1 1 0 0 0 1.7-1A7 7 0 0 0 5 10.5a1 1 0 0 0 1.7 1A5 5 0 0 1 12 8z"
        fill="currentColor"
      />
      <path
        d="M12 12.2a2.2 2.2 0 0 1 1.9 1.1 1 1 0 1 0 1.7-1 4.2 4.2 0 0 0-7.2 0 1 1 0 1 0 1.7 1 2.2 2.2 0 0 1 1.9-1.1z"
        fill="currentColor"
      />
      <circle cx="12" cy="17" fill="currentColor" r="1.6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M8.2 4.6a1.4 1.4 0 0 1 1.5.8l1.2 2.6a1.4 1.4 0 0 1-.3 1.6L9.2 11a12 12 0 0 0 3.8 3.8l1.4-1.4a1.4 1.4 0 0 1 1.6-.3l2.6 1.2a1.4 1.4 0 0 1 .8 1.5l-.4 2.4a1.4 1.4 0 0 1-1.4 1.2A15.2 15.2 0 0 1 3.6 6.4a1.4 1.4 0 0 1 1.2-1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function MicIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 14.2a3 3 0 0 0 3-3V6.5a3 3 0 0 0-6 0v4.7a3 3 0 0 0 3 3z"
        fill="currentColor"
      />
      <path
        d="M17.2 11.2a1 1 0 0 0-2 0 3.2 3.2 0 0 1-6.4 0 1 1 0 0 0-2 0 5.2 5.2 0 0 0 4.2 5.1v1.5H9.2a1 1 0 0 0 0 2h5.6a1 1 0 0 0 0-2h-1.8v-1.5a5.2 5.2 0 0 0 4.2-5.1z"
        fill="currentColor"
      />
      {crossed ? <Slash /> : null}
    </svg>
  );
}

function HeadphonesIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 4.5a7.5 7.5 0 0 0-7.5 7.5v1.2a2.3 2.3 0 0 0 2.3 2.3h1.2V12H6.8v-.2a5.2 5.2 0 0 1 10.4 0V12h-1.2v3.5h1.2a2.3 2.3 0 0 0 2.3-2.3v-1.2A7.5 7.5 0 0 0 12 4.5z"
        fill="currentColor"
      />
      {crossed ? <Slash /> : null}
    </svg>
  );
}

function Slash() {
  return (
    <path
      d="M5 6.4 17.6 19"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  );
}
