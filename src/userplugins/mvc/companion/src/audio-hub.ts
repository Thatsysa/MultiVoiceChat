import { createServer, type Server, type Socket } from "node:net";
import {
  AUDIO_DOWN,
  AUDIO_UP,
  type AudioFrame,
  AudioFrameDecoder,
  encodeAudioFrame,
} from "../../playback/audio-frames";

export class AudioHub {
  private server: Server | null = null;
  private client: Socket | null = null;
  private readonly decoder = new AudioFrameDecoder();
  private microphone: (guildId: string, pcm: Uint8Array) => void = () =>
    undefined;

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket));
      this.server = server;
      server.once("error", () => reject(new Error("voice companion stopped")));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("voice companion stopped"));
          return;
        }
        resolve(address.port);
      });
    });
  }

  onMicrophone(listener: (guildId: string, pcm: Uint8Array) => void): void {
    this.microphone = listener;
  }

  send(frame: Pick<AudioFrame, "guildId" | "pcm">): void {
    if (!this.client || this.client.destroyed) {
      return;
    }
    this.client.write(
      encodeAudioFrame({
        guildId: frame.guildId,
        kind: AUDIO_DOWN,
        pcm: frame.pcm,
      })
    );
  }

  close(): void {
    this.client?.destroy();
    this.client = null;
    this.server?.close();
    this.server = null;
  }

  private accept(socket: Socket): void {
    const remote = socket.remoteAddress;
    if (
      remote !== "127.0.0.1" &&
      remote !== "::ffff:127.0.0.1" &&
      remote !== "::1"
    ) {
      socket.destroy();
      return;
    }
    if (this.client) {
      socket.destroy();
      return;
    }
    this.client = socket;
    socket.on("data", (chunk) => {
      try {
        const frames = this.decoder.push(chunk);
        for (const frame of frames) {
          if (frame.kind === AUDIO_UP) {
            this.microphone(frame.guildId, frame.pcm);
          }
        }
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      if (this.client === socket) {
        this.client = null;
      }
    });
    socket.on("error", () => socket.destroy());
  }
}
