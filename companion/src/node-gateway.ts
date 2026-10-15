import {
  type GatewaySocket,
  type GatewaySocketFactory,
  realScheduler as scheduler,
} from "./runtime";

export const realScheduler = scheduler;

export const nodeGatewaySockets: GatewaySocketFactory = {
  connect(url, handlers): GatewaySocket {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => handlers.open());
    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data.length > 0) {
        handlers.message(data);
      }
    });
    socket.addEventListener("close", (event) => handlers.close(event.code));
    socket.addEventListener("error", () => handlers.error());
    return {
      close: () => socket.close(),
      send: (data) => socket.send(data),
    };
  },
};
