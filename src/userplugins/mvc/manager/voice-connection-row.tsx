import { useCallback } from "@webpack/common";
import type {
  ConnectionRecord,
  VoiceControls,
} from "../voiceSession/connection-record";

export function VoiceConnectionRow({
  connection,
  onControls,
  onDisconnect,
  onRetry,
}: {
  connection: ConnectionRecord;
  onControls: (patch: Partial<VoiceControls>) => void;
  onDisconnect: () => void;
  onRetry: () => void;
}) {
  const { controls } = connection;
  const changeMuted = useCallback(
    (event: { target: { checked: boolean } }) => {
      onControls({ muted: event.target.checked });
    },
    [onControls]
  );
  const changeDeafened = useCallback(
    (event: { target: { checked: boolean } }) => {
      onControls({ deafened: event.target.checked });
    },
    [onControls]
  );
  const changeVolume = useCallback(
    (event: { target: { value: string } }) => {
      onControls({ volume: Number(event.target.value) / 100 });
    },
    [onControls]
  );
  return (
    <section className="mvc-row">
      <div>
        <strong>{connection.guildName}</strong>
        <div>{connection.channelName}</div>
        <div className="mvc-phase">
          {connection.phase}
          {connection.error ? ` — ${connection.error}` : ""}
        </div>
        {(connection.serverMuted || connection.serverDeafened) && (
          <div className="mvc-phase">
            Server {connection.serverMuted ? "muted " : ""}
            {connection.serverDeafened ? "deafened" : ""}
          </div>
        )}
      </div>
      <label>
        <input
          checked={controls.muted}
          onChange={changeMuted}
          type="checkbox"
        />{" "}
        Mute
      </label>
      <label>
        <input
          checked={controls.deafened}
          onChange={changeDeafened}
          type="checkbox"
        />{" "}
        Deafen
      </label>
      <label>
        Volume
        <input
          max={100}
          min={0}
          onChange={changeVolume}
          type="range"
          value={Math.round(controls.volume * 100)}
        />
      </label>
      <button className="mvc-button" onClick={onRetry} type="button">
        Retry
      </button>
      <button className="mvc-button" onClick={onDisconnect} type="button">
        Disconnect
      </button>
    </section>
  );
}
