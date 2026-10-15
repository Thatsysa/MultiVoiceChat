export interface GatewaySocket {
  close: () => void;
  send: (data: string) => void;
}

export interface GatewayHandlers {
  close: (code: number) => void;
  error: () => void;
  message: (data: string) => void;
  open: () => void;
}

export interface GatewaySocketFactory {
  connect: (url: string, handlers: GatewayHandlers) => GatewaySocket;
}

export interface Scheduler {
  setInterval: (fn: () => void, ms: number) => () => void;
  setTimeout: (fn: () => void, ms: number) => () => void;
}

export const realScheduler: Scheduler = {
  setInterval(fn, ms) {
    let stopped = false;
    let next = Date.now() + ms;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (stopped) {
        return;
      }
      fn();
      const now = Date.now();
      next += ms;
      if (next < now) {
        next = now + ms;
      }
      timer = setTimeout(tick, Math.max(0, next - now));
    };
    timer = setTimeout(tick, ms);
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  },
  setTimeout(_fn, _ms) {
    const timer = setTimeout(_fn, _ms);
    return () => clearTimeout(timer);
  },
};

export interface VoiceAdapterLibrary {
  destroy: () => void;
  onVoiceServerUpdate: (data: Record<string, unknown>) => void;
  onVoiceStateUpdate: (data: Record<string, unknown>) => void;
}

interface VoiceAdapter {
  destroy: () => void;
  sendPayload: (payload: {
    op: number;
    d?: Record<string, unknown>;
  }) => boolean;
}

export type VoiceAdapterCreator = (
  library: VoiceAdapterLibrary
) => VoiceAdapter;
