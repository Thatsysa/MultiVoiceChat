import { STEREO_FRAME_SAMPLES } from "./audio-frames";

interface SpeakerBuffer {
  lastWriteMs: number;
  samples: number[];
}

export class AudioMixer {
  private readonly speakers = new Map<string, SpeakerBuffer>();

  write(speakerKey: string, pcm: Uint8Array, now: number): void {
    if (speakerKey.length === 0 || pcm.byteLength < 2) {
      return;
    }
    const view = new DataView(
      pcm.buffer,
      pcm.byteOffset,
      pcm.byteLength - (pcm.byteLength % 2)
    );
    const speaker = this.speakers.get(speakerKey) ?? {
      lastWriteMs: now,
      samples: [],
    };
    for (let offset = 0; offset < view.byteLength; offset += 2) {
      speaker.samples.push(view.getInt16(offset, true));
    }
    speaker.lastWriteMs = now;
    this.speakers.set(speakerKey, speaker);
  }

  mix(
    now: number,
    staleMs = 100,
    frameSamples = STEREO_FRAME_SAMPLES
  ): Int16Array | null {
    let available = 0;
    for (const [key, speaker] of this.speakers) {
      if (speaker.samples.length === 0 && now - speaker.lastWriteMs > staleMs) {
        this.speakers.delete(key);
      }
      available = Math.max(
        available,
        Math.min(frameSamples, speaker.samples.length)
      );
    }
    if (available < 2) {
      return null;
    }
    const frame = new Int16Array(available);
    for (const speaker of this.speakers.values()) {
      const count = Math.min(available, speaker.samples.length);
      for (let index = 0; index < count; index += 1) {
        const mixed = frame[index] + speaker.samples[index];
        frame[index] = Math.max(-32_768, Math.min(32_767, mixed));
      }
      speaker.samples.splice(0, count);
    }
    return frame;
  }
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index], true);
  }
  return bytes;
}
