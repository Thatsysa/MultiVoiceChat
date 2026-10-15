import {
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalRoot,
  openModal,
} from "@utils/modal";
import { Text, useCallback, useEffect, useState } from "@webpack/common";
import type {
  ConnectionRecord,
  VoiceControls,
} from "../voiceSession/connection-record";
import type { ConnectionRegistry } from "../voiceSession/connection-registry";
import type { VoiceController } from "../voiceSession/controller";
import { MILESTONE_ORDER } from "../voiceSession/milestones";
import { VoiceConnectionRow } from "./voice-connection-row";

export function openManager(
  controller: VoiceController,
  registry: ConnectionRegistry
): void {
  openModal((modalProps) => (
    <ModalRoot {...modalProps}>
      <Manager
        controller={controller}
        onClose={modalProps.onClose}
        registry={registry}
      />
    </ModalRoot>
  ));
}

function Manager({
  controller,
  registry,
  onClose,
}: {
  controller: VoiceController;
  registry: ConnectionRegistry;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0);
  useEffect(
    () => registry.subscribe(() => setVersion((value) => value + 1)),
    [registry]
  );
  useEffect(() => {
    const timer = setInterval(() => setVersion((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const connections = registry.list();
  const probeRenderer = useCallback(() => {
    controller.runProbe("renderer");
  }, [controller]);
  const probeTransport = useCallback(() => {
    controller.runProbe("transport");
  }, [controller]);
  const probeOpus = useCallback(() => {
    controller.runProbe("opus");
  }, [controller]);
  return (
    <>
      <ModalHeader>
        <Text variant="heading-lg/semibold">Secondary voice</Text>
      </ModalHeader>
      <ModalContent className="mvc-content">
        <Text>
          One secondary channel per server. The normal Discord voice connection
          is left alone, and a server that already uses it cannot also use a
          secondary session.
        </Text>
        {controller.lastError && (
          <Text className="mvc-error">{controller.lastError}</Text>
        )}
        <div className="mvc-milestones" data-refresh={version}>
          {MILESTONE_ORDER.map((name) => (
            <span
              className={controller.lastReport[name] ? "mvc-met" : "mvc-unmet"}
              key={name}
            >
              {label(name)}
            </span>
          ))}
        </div>
        <div className="mvc-milestones">
          <button className="mvc-button" onClick={probeRenderer} type="button">
            Renderer tone
          </button>
          <button className="mvc-button" onClick={probeTransport} type="button">
            Transport tone
          </button>
          <button className="mvc-button" onClick={probeOpus} type="button">
            Opus tone
          </button>
        </div>
        <Text>
          {`Frames ${controller.diagnostics.receivedFrames}/${controller.diagnostics.outputFrames}, queue ${Math.round(controller.diagnostics.queuedMs)} ms, underruns ${controller.diagnostics.underruns}, dropped ${Math.round(controller.diagnostics.droppedMs)} ms, gaps ${Math.round(controller.diagnostics.gapMinMs)}-${Math.round(controller.diagnostics.gapMaxMs)} ms, tone ${controller.diagnostics.toneOk ? "ok" : "not checked"}`}
        </Text>
        {connections.length === 0 && (
          <Text>No secondary voice connections.</Text>
        )}
        {connections.map((connection) => (
          <ConnectionControls
            connection={connection}
            controller={controller}
            key={connection.guildId}
          />
        ))}
      </ModalContent>
      <ModalFooter>
        <Text>
          Live audio still has to be confirmed by you in two test servers.
          Milestones above only record what this session has observed.
        </Text>
        <button className="mvc-button" onClick={onClose} type="button">
          Close
        </button>
      </ModalFooter>
    </>
  );
}

function ConnectionControls({
  connection,
  controller,
}: {
  connection: ConnectionRecord;
  controller: VoiceController;
}) {
  const changeControls = useCallback(
    (patch: Partial<VoiceControls>) => {
      controller.setControls(connection.guildId, patch);
    },
    [connection.guildId, controller]
  );
  const disconnect = useCallback(() => {
    controller.disconnect(connection.guildId);
  }, [connection.guildId, controller]);
  const retry = useCallback(() => {
    controller.connect(connection.channelId, true);
  }, [connection.channelId, controller]);
  return (
    <VoiceConnectionRow
      connection={connection}
      onControls={changeControls}
      onDisconnect={disconnect}
      onRetry={retry}
    />
  );
}

function label(name: string): string {
  switch (name) {
    case "secondaryPresence":
      return "Presence";
    case "encryptedReceive":
      return "Receive";
    case "audiblePlayback":
      return "Playback";
    case "microphoneTransmit":
      return "Transmit";
    case "independentControls":
      return "Controls";
    case "teardown":
      return "Teardown";
    default:
      return name;
  }
}
