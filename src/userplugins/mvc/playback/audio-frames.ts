import { asPcmBytes, isSnowflake } from "../voiceSession/validation";

const MAX_PCM_BYTES = 16_384;
export const STEREO_FRAME_SAMPLES = 1920;

const AUDIO_FRAME_VERSION = 1;
export const AUDIO_DOWN = 1;
export const AUDIO_UP = 2;

export interface AudioFrame {
  guildId: string;
  kind: typeof AUDIO_DOWN | typeof AUDIO_UP;
  pcm: Uint8Array;
}

export function encodeAudioFrame(frame: AudioFrame): Uint8Array {
  if (!isSnowflake(frame.guildId)) {
    throw new Error("invalid guild");
  }
  const pcm = asPcmBytes(frame.pcm);
  if (!pcm || (frame.kind !== AUDIO_DOWN && frame.kind !== AUDIO_UP)) {
    throw new Error("invalid audio frame");
  }
  const guildBytes = new TextEncoder().encode(frame.guildId);
  const encoded = new Uint8Array(3 + guildBytes.length + 4 + pcm.byteLength);
  const view = new DataView(encoded.buffer);
  encoded[0] = AUDIO_FRAME_VERSION;
  encoded[1] = frame.kind;
  encoded[2] = guildBytes.length;
  encoded.set(guildBytes, 3);
  view.setUint32(3 + guildBytes.length, pcm.byteLength, true);
  encoded.set(pcm, 3 + guildBytes.length + 4);
  return encoded;
}

export class AudioFrameDecoder {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): AudioFrame[] {
    if (chunk.byteLength === 0) {
      return [];
    }
    const combined = new Uint8Array(this.pending.length + chunk.byteLength);
    combined.set(this.pending, 0);
    combined.set(chunk, this.pending.length);
    const frames: AudioFrame[] = [];
    let offset = 0;
    while (combined.length - offset >= 7) {
      const version = combined[offset];
      const kind = combined[offset + 1];
      const guildLength = combined[offset + 2];
      if (
        version !== AUDIO_FRAME_VERSION ||
        (kind !== AUDIO_DOWN && kind !== AUDIO_UP) ||
        guildLength < 5 ||
        guildLength > 25
      ) {
        throw new Error("invalid audio frame");
      }
      if (combined.length - offset < 3 + guildLength + 4) {
        break;
      }
      const guildId = new TextDecoder().decode(
        combined.subarray(offset + 3, offset + 3 + guildLength)
      );
      const pcmLength = new DataView(
        combined.buffer,
        combined.byteOffset + offset + 3 + guildLength,
        4
      ).getUint32(0, true);
      if (
        !isSnowflake(guildId) ||
        pcmLength === 0 ||
        pcmLength > MAX_PCM_BYTES ||
        pcmLength % 2 !== 0
      ) {
        throw new Error("invalid audio frame");
      }
      const frameLength = 3 + guildLength + 4 + pcmLength;
      if (combined.length - offset < frameLength) {
        break;
      }
      const pcm = combined.slice(
        offset + 3 + guildLength + 4,
        offset + frameLength
      );
      frames.push({ guildId, kind, pcm });
      offset += frameLength;
    }
    this.pending = combined.slice(offset);
    if (this.pending.length > 32_768) {
      throw new Error("invalid audio frame");
    }
    return frames;
  }
}
