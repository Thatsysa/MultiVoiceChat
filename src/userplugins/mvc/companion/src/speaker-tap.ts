export interface TapStream {
  destroy: () => void;
  on?: (event: "error", listener: () => void) => void;
  pipe: (destination: TapDecoder) => void;
  unpipe?: (destination?: TapDecoder) => void;
}

export interface TapDecoder {
  destroy: () => void;
  on: {
    (event: "data", listener: (chunk: Uint8Array) => void): void;
    (event: "error", listener: () => void): void;
  };
  removeAllListeners: () => void;
}

export class SpeakerTaps {
  private readonly open = new Set<string>();
  private readonly closers: Array<() => void> = [];

  start(
    userId: string,
    subscribe: () => TapStream,
    createDecoder: () => TapDecoder,
    onPcm: (userId: string, pcm: Uint8Array) => void
  ): boolean {
    if (userId.length === 0 || this.open.has(userId)) {
      return false;
    }
    const stream = subscribe();
    const decoder = createDecoder();
    this.open.add(userId);
    stream.pipe(decoder);
    stream.on?.("error", () => undefined);
    decoder.on("data", (chunk) => onPcm(userId, chunk));
    decoder.on("error", () => undefined);
    this.closers.push(() => this.stop(stream, decoder));
    return true;
  }

  close(): void {
    const closers = this.closers.splice(0);
    this.open.clear();
    for (const close of closers) {
      close();
    }
  }

  private stop(stream: TapStream, decoder: TapDecoder): void {
    try {
      stream.unpipe?.(decoder);
    } catch {
      /* already closed */
    }
    try {
      decoder.removeAllListeners();
    } catch {
      /* already closed */
    }
    try {
      stream.destroy();
    } catch {
      /* already closed */
    }
    try {
      decoder.destroy();
    } catch {
      /* already closed */
    }
  }
}
