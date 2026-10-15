import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { type PluginNative } from "@utils/types";
import { Menu, Toasts } from "@webpack/common";
import { describeChannel, getToken } from "./joinVoice/discord-channel";
import { confirmReplacement, confirmRisk } from "./joinVoice/risk-prompt";
import { openManager } from "./manager/mvc-modal";
import { createBrowserPlayback } from "./playback/browser-playback";
import { settings } from "./settings";
import { createBrowserMicrophone } from "./speak/browser-microphone";
import { SecondaryVoicePanel } from "./voiceBar/secondary-voice-panel";
import type { ConnectFailure } from "./voiceSession/connection-record";
import { ConnectionRegistry } from "./voiceSession/connection-registry";
import {
  createVoiceController,
  type NativePort,
} from "./voiceSession/controller";
import { failureMessage } from "./voiceSession/messages";
import "./styles.css";

const Native = VencordNative.pluginHelpers.MVC as PluginNative<
  typeof import("./companionLink/native")
>;
// Kept out of a regex literal so formatting cannot strip Vencord's \i escape.
const IDENTIFIER = "\\i";
const registry = new ConnectionRegistry();
const controller = createVoiceController({
  companionEntry: () => settings.store.companionEntry,
  discord: { describeChannel, getToken },
  interval: (fn, ms) => {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
  microphone: createBrowserMicrophone(),
  native: nativePort(),
  playback: createBrowserPlayback(),
  registry,
  riskAccepted: () => settings.store.riskAccepted,
});

export default definePlugin({
  name: "MVC",
  authors: [{ id: 412724203306090507n, name: "YSA" }],
  contextMenus: {
    "channel-context"(children, props) {
      const channel = props?.channel;
      if (!channel) {
        return;
      }
      if (!channel.guild_id || (channel.type !== 2 && channel.type !== 13)) {
        return;
      }
      const join = () => {
        joinChannel(channel.id);
      };
      children.push(
        <Menu.MenuItem
          action={join}
          id="mvc-connect"
          key="mvc-connect"
          label="Join as secondary voice"
        />
      );
    },
  },
  description:
    "MultiVoiceChat. Join one extra voice channel per server, with separate mute, deafen, and transmit controls.",
  patches: [
    {
      find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
      replacement: {
        match: accountPanelMatch(),
        replace: "$self.PanelWrapper,{VencordOriginal:$1,",
      },
    },
  ],
  PanelWrapper({
    VencordOriginal,
    ...props
  }: {
    VencordOriginal: (props: Record<string, unknown>) => JSX.Element;
  }) {
    return (
      <>
        <ErrorBoundary>
          <SecondaryVoicePanel controller={controller} registry={registry} />
        </ErrorBoundary>
        <VencordOriginal {...props} />
      </>
    );
  },
  settings,
  stop() {
    controller.shutdown();
  },
});

async function joinChannel(channelId: string): Promise<void> {
  if (!settings.store.riskAccepted) {
    const accepted = await confirmRisk();
    if (!accepted) {
      return;
    }
  }
  const failure = await controller.connect(channelId);
  if (failure === "replace-required") {
    const replace = await confirmReplace();
    if (!replace) {
      return;
    }
    notify(await controller.connect(channelId, true));
    return;
  }
  notify(failure);
}

function confirmReplace(): Promise<boolean> {
  openManager(controller, registry);
  return confirmReplacement();
}

function notify(failure: ConnectFailure | null): void {
  if (!failure) {
    return;
  }
  const message = controller.lastError ?? failureMessage(failure);
  try {
    Toasts.show({ id: "mvc", message, type: Toasts.Type.FAILURE });
  } catch {
    // The manager banner still shows the same error.
  }
}

function accountPanelMatch(): RegExp {
  return new RegExp(
    `(?<=${IDENTIFIER}\\.jsxs?\\)\\()(${IDENTIFIER}),{(?=[^}]*?userTag:${IDENTIFIER},occluded:)`
  );
}

function nativePort(): NativePort {
  return {
    connect: (request) => Native.connect(request),
    disconnect: (guildId) => Native.disconnect(guildId),
    playbackAck: (guildId) => Native.playbackAck(guildId),
    probe: (request) => Native.probe(request),
    pullAudio: () => Native.pullAudio(),
    pullEvents: () => Native.pullEvents(),
    pushAudio: (guildId, pcm) => Native.pushAudio(guildId, pcm),
    shutdown: async () => {
      await Native.shutdown();
    },
    update: (request) => Native.update(request),
  };
}
