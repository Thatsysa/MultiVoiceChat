import { PassThrough } from "node:stream";
import {
  type AudioDiagnostics,
  analyzeTone,
  synthesizeTone,
} from "../../playback/probe-tone";

export async function roundTripOpus(pcm: Uint8Array): Promise<Uint8Array> {
  const imported = (await import("prism-media")) as {
    opus?: OpusModule;
    default?: { opus?: OpusModule };
  };
  const opus = imported.opus ?? imported.default?.opus;
  if (!opus) {
    throw new Error("audio decoder is unavailable");
  }
  const encoder = new opus.Encoder({
    channels: 2,
    frameSize: 960,
    rate: 48_000,
  });
  const decoder = new opus.Decoder({
    channels: 2,
    frameSize: 960,
    rate: 48_000,
  });
  const input = new PassThrough();
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    input.pipe(encoder).pipe(decoder);
    decoder.on("data", (chunk: Buffer) => chunks.push(chunk));
    decoder.on("end", () => resolve(Buffer.concat(chunks)));
    decoder.on("error", reject);
    encoder.on("error", reject);
    input.end(Buffer.from(pcm));
  });
}

export async function opusProbeDiagnostics(
  durationMs = 1000
): Promise<{ pcm: Uint8Array; diagnostics: AudioDiagnostics }> {
  const source = synthesizeTone(durationMs);
  const decoded = await roundTripOpus(source);
  return {
    diagnostics: {
      droppedMs: 0,
      gapMaxMs: 20,
      gapMinMs: 20,
      outputFrames: Math.floor(decoded.byteLength / 3840),
      queuedMs: 0,
      receivedFrames: Math.floor(source.byteLength / 3840),
      toneOk: analyzeTone(decoded),
      underruns: 0,
    },
    pcm: decoded,
  };
}

interface OpusModule {
  Decoder: new (options: {
    rate: number;
    channels: number;
    frameSize: number;
  }) => NodeJS.ReadWriteStream;
  Encoder: new (options: {
    rate: number;
    channels: number;
    frameSize: number;
  }) => NodeJS.ReadWriteStream;
}
