import { buildVoiceJoinOptions } from "../../companionLink/voice-options";
import type { VoiceAdapterCreator } from "./runtime";
import type { VoiceBridge, VoiceHandle, VoiceJoin } from "./session-manager";
import { SpeakerTaps, type TapDecoder, type TapStream } from "./speaker-tap";

interface VoiceModule {
  createAudioPlayer: () => AudioPlayerLike;
  createAudioResource: (
    stream: NodeJS.ReadableStream,
    options: { inputType: string }
  ) => unknown;
  EndBehaviorType: { Manual: string };
  entersState: (
    connection: VoiceConnectionLike,
    status: string,
    timeout: number
  ) => Promise<unknown>;
  joinVoiceChannel: (
    options: ReturnType<typeof buildVoiceJoinOptions> & {
      adapterCreator: VoiceAdapterCreator;
    }
  ) => VoiceConnectionLike;
  StreamType: { Raw: string };
  VoiceConnectionStatus: { Ready: string; Destroyed: string };
}

interface VoiceConnectionLike {
  destroy: () => void;
  receiver: {
    speaking: {
      on: (event: "start", listener: (userId: string) => void) => void;
    };
    subscribe: (
      userId: string,
      options: { end: { behavior: string } }
    ) => NodeJS.ReadableStream;
  };
  subscribe: (player: AudioPlayerLike) => unknown;
}

interface AudioPlayerLike {
  pause: (interpolateSilence?: boolean) => void;
  play: (resource: unknown) => void;
  subscribe?: (connection: VoiceConnectionLike) => unknown;
  unpause: () => void;
}

export class DiscordVoiceBridge implements VoiceBridge {
  join(request: VoiceJoin): VoiceHandle {
    let settled = false;
    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => undefined);
    const handle = new DiscordVoiceHandle(
      ready,
      () => settled,
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectReady(error);
      },
      () => {
        if (settled) {
          return;
        }
        settled = true;
        resolveReady();
      }
    );
    this.open(request, handle).catch((error) => {
      handle.fail(
        error instanceof Error ? error : new Error("voice session stopped")
      );
    });
    return handle;
  }

  private async open(
    request: VoiceJoin,
    handle: DiscordVoiceHandle
  ): Promise<void> {
    const voice = (await import("@discordjs/voice")) as unknown as VoiceModule;
    const imported = (await import("prism-media")) as {
      opus?: {
        Decoder: new (options: {
          channels: number;
          rate: number;
          frameSize: number;
        }) => NodeJS.ReadWriteStream;
      };
      default?: {
        opus: {
          Decoder: new (options: {
            channels: number;
            rate: number;
            frameSize: number;
          }) => NodeJS.ReadWriteStream;
        };
      };
    };
    const prism = imported.opus ? imported : imported.default;
    if (!prism?.opus) {
      throw new Error("audio decoder is unavailable");
    }
    const { PassThrough } = await import("node:stream");
    const connection = voice.joinVoiceChannel({
      ...buildVoiceJoinOptions(request),
      adapterCreator: request.adapterCreator,
    });
    const player = voice.createAudioPlayer();
    const microphone = new PassThrough();
    const resource = voice.createAudioResource(microphone, {
      inputType: voice.StreamType.Raw,
    });
    player.play(resource);
    connection.subscribe(player);
    handle.attach(connection, player, microphone, prism.opus, voice);
    await voice.entersState(
      connection,
      voice.VoiceConnectionStatus.Ready,
      20_000
    );
    handle.markReady();
  }
}

class DiscordVoiceHandle implements VoiceHandle {
  private connection: VoiceConnectionLike | null = null;
  private player: AudioPlayerLike | null = null;
  private microphone: {
    write: (chunk: Uint8Array) => void;
    writableLength?: number;
    destroy: () => void;
  } | null = null;
  private remote: (speakerKey: string, pcm: Uint8Array) => void = () =>
    undefined;
  private readonly taps = new SpeakerTaps();
  private destroyed = false;
  private readonly ready: Promise<void>;
  private readonly isSettled: () => boolean;
  readonly fail: (error: Error) => void;
  private readonly resolve: () => void;

  constructor(
    ready: Promise<void>,
    isSettled: () => boolean,
    fail: (error: Error) => void,
    resolve: () => void
  ) {
    this.ready = ready;
    this.isSettled = isSettled;
    this.fail = fail;
    this.resolve = resolve;
  }

  attach(
    connection: VoiceConnectionLike,
    player: AudioPlayerLike,
    microphone: {
      write: (chunk: Uint8Array) => void;
      writableLength?: number;
      destroy: () => void;
    },
    opus: {
      Decoder: new (options: {
        channels: number;
        rate: number;
        frameSize: number;
      }) => NodeJS.ReadWriteStream;
    },
    voice: VoiceModule
  ): void {
    this.connection = connection;
    this.player = player;
    this.microphone = microphone;
    connection.receiver.speaking.on("start", (userId) => {
      if (this.destroyed) {
        return;
      }
      this.taps.start(
        userId,
        () =>
          connection.receiver.subscribe(userId, {
            end: { behavior: voice.EndBehaviorType.Manual },
          }) as unknown as TapStream,
        () =>
          new opus.Decoder({
            channels: 2,
            frameSize: 960,
            rate: 48_000,
          }) as unknown as TapDecoder,
        (speakerKey, pcm) => this.remote(speakerKey, new Uint8Array(pcm))
      );
    });
  }

  markReady(): void {
    this.resolve();
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  setSpeakingAllowed(allowed: boolean): void {
    if (allowed) {
      this.player?.unpause();
    } else {
      this.player?.pause(true);
    }
  }

  writeMicrophone(pcm: Uint8Array): void {
    if (!this.microphone || (this.microphone.writableLength ?? 0) > 1_000_000) {
      return;
    }
    this.microphone.write(pcm);
  }

  onRemotePcm(listener: (speakerKey: string, pcm: Uint8Array) => void): void {
    this.remote = listener;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.taps.close();
    this.microphone?.destroy();
    this.connection?.destroy();
    if (!this.isSettled()) {
      this.fail(new Error("voice session stopped"));
    }
  }
}
