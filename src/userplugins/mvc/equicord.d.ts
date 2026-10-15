// Equicord provides these modules when the plugin is built. This file lets the
// editor resolve them from the standalone project.

declare const VencordNative: {
  pluginHelpers: Record<string, unknown>;
};

// biome-ignore lint/style/noNamespace: TypeScript's JSX checker requires this namespace
declare namespace JSX {
  interface Element {
    readonly props: unknown;
  }
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements {
    [element: string]: unknown;
  }
}

declare module "*.css";

declare module "@components/ErrorBoundary" {
  export default function ErrorBoundary(props: {
    children?: unknown;
  }): JSX.Element;
}

declare module "@utils/types" {
  export enum OptionType {
    STRING,
    NUMBER,
    BIGINT,
    BOOLEAN,
    SELECT,
    SLIDER,
    COMPONENT,
    CUSTOM,
  }

  type NativeHandler = (event: unknown, ...args: unknown[]) => unknown;

  export type PluginNative<
    PluginExports extends Record<string, NativeHandler>,
  > = {
    [Key in keyof PluginExports]: PluginExports[Key] extends (
      event: unknown,
      ...args: infer Args
    ) => infer Return
      ? (
          ...args: Args
        ) => Return extends Promise<unknown> ? Return : Promise<Return>
      : never;
  };

  export default function definePlugin<T extends { name: string }>(
    plugin: T
  ): T;
}

declare module "@api/Settings" {
  interface SettingDefinition {
    default?: unknown;
    description: string;
    type: import("@utils/types").OptionType;
  }

  type SettingValues<Def extends Record<string, SettingDefinition>> = {
    [Key in keyof Def]: Def[Key] extends { default: infer Value }
      ? Value
      : unknown;
  };

  export function definePluginSettings<
    Def extends Record<string, SettingDefinition>,
  >(
    definition: Def
  ): {
    plain: SettingValues<Def>;
    store: SettingValues<Def>;
  };
}

declare module "@utils/modal" {
  interface ModalProps {
    onClose: () => void;
  }

  export function openModal(render: (props: ModalProps) => JSX.Element): void;

  export function ModalRoot(props: {
    children?: unknown;
    onClose?: () => void;
  }): JSX.Element;

  export function ModalHeader(props: { children?: unknown }): JSX.Element;

  export function ModalContent(props: {
    children?: unknown;
    className?: string;
  }): JSX.Element;

  export function ModalFooter(props: { children?: unknown }): JSX.Element;
}

declare module "@webpack" {
  export function findByPropsLazy(...props: string[]): {
    [key: string]: unknown;
    can?: (permission: bigint, channel: unknown) => unknown;
    getToken?: () => unknown;
  };
}

declare module "@webpack/common" {
  interface MenuItemProps {
    action?: () => void;
    children?: unknown;
    id: string;
    label: string;
  }

  export const ReactDOM: {
    createPortal: (
      children: JSX.Element,
      container: HTMLElement
    ) => JSX.Element;
  };

  export const createRoot: (container: HTMLElement) => {
    render: (node: JSX.Element) => void;
    unmount: () => void;
  };

  export const Menu: {
    MenuItem: (props: MenuItemProps) => JSX.Element;
  };

  export const Toasts: {
    Type: { FAILURE: number };
    show: (toast: { id: string; message: string; type: number }) => void;
  };

  interface DiscordChannel {
    guild_id?: unknown;
    guildId?: unknown;
    isGuildStageVoice?: () => boolean;
    isGuildVoice?: () => boolean;
    name?: unknown;
    type?: unknown;
    user_limit?: unknown;
    userLimit?: unknown;
  }

  export const ChannelStore: {
    getChannel?: (channelId: string) => DiscordChannel | null;
  };

  export const GuildStore: {
    getGuild?: (guildId: string) => { name?: unknown } | null;
  };

  export const VoiceStateStore: {
    getCurrentClientVoiceChannelId?: (guildId: string) => unknown;
    getVoiceStatesForChannel?: (channelId: string) => unknown;
  };

  export function Text(props: {
    children?: unknown;
    className?: string;
    variant?: string;
  }): JSX.Element;

  export function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps: readonly unknown[]
  ): T;

  export function useEffect(
    effect: () => void,
    deps?: readonly unknown[]
  ): void;

  export function useLayoutEffect(
    effect: () => void,
    deps?: readonly unknown[]
  ): void;

  export function useRef<T>(initial: T): { current: T };

  export function useState<T>(
    initial: T | (() => T)
  ): [T, (value: T | ((previous: T) => T)) => void];
}
