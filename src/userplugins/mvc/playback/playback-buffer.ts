export interface PlaybackStats {
  droppedMs: number;
  queuedMs: number;
  underruns: number;
}

export interface PlaybackBufferOptions {
  channels?: number;
  maxBatchMs?: number;
  maxLatencyMs?: number;
  minBatchMs?: number;
  prebufferMs?: number;
  sampleRate?: number;
  silenceResetMs?: number;
}

const DEFAULTS = {
  channels: 2,
  maxBatchMs: 20,
  maxLatencyMs: 80,
  minBatchMs: 20,
  prebufferMs: 20,
  sampleRate: 48_000,
  silenceResetMs: 200,
};

export class PlaybackBuffer {
  private readonly samplesPerMs: number;
  private prebufferSamples: number;
  private readonly minBatchSamples: number;
  private readonly maxBatchSamples: number;
  private maxSamples: number;
  private readonly silenceResetMs: number;
  private chunks: Int16Array[] = [];
  private head = 0;
  private queuedSamples = 0;
  private primed = false;
  private lastPushAt: number | null = null;
  private underruns = 0;
  private droppedSamples = 0;

  constructor(options: PlaybackBufferOptions = {}) {
    const sampleRate = options.sampleRate ?? DEFAULTS.sampleRate;
    const channels = options.channels ?? DEFAULTS.channels;
    this.samplesPerMs = (sampleRate * channels) / 1000;
    this.prebufferSamples = Math.round(
      (options.prebufferMs ?? DEFAULTS.prebufferMs) * this.samplesPerMs
    );
    this.minBatchSamples = Math.round(
      (options.minBatchMs ?? DEFAULTS.minBatchMs) * this.samplesPerMs
    );
    this.maxBatchSamples = Math.round(
      (options.maxBatchMs ?? DEFAULTS.maxBatchMs) * this.samplesPerMs
    );
    this.maxSamples = Math.round(
      (options.maxLatencyMs ?? DEFAULTS.maxLatencyMs) * this.samplesPerMs
    );
    this.silenceResetMs = options.silenceResetMs ?? DEFAULTS.silenceResetMs;
  }

  armLive(frameCount: number): void {
    const cushionFrames = frameCount + 1920;
    const cushionSamples = cushionFrames * 2;
    if (cushionSamples > this.prebufferSamples) {
      this.prebufferSamples = cushionSamples;
    }
    const capSamples = cushionSamples + 1920 * 2;
    if (capSamples > this.maxSamples) {
      this.maxSamples = capSamples;
    }
  }

  push(pcm: Uint8Array, nowMs: number): void {
    this.resetIfSilent(nowMs);
    const samples = decodeStereoPcm(pcm);
    if (!samples) {
      return;
    }
    this.chunks.push(samples);
    this.queuedSamples += samples.length;
    this.lastPushAt = nowMs;
    this.dropOldest();
  }

  pull(nowMs: number): Uint8Array | null {
    this.resetIfSilent(nowMs);
    if (!this.primed) {
      if (this.queuedSamples < this.prebufferSamples) {
        return null;
      }
      this.primed = true;
    }
    if (this.queuedSamples === 0) {
      this.underruns += 1;
      this.primed = false;
      return null;
    }
    if (this.queuedSamples < this.minBatchSamples) {
      return null;
    }
    const count = Math.min(this.maxBatchSamples, this.queuedSamples);
    return this.take(count - (count % 2));
  }

  readLive(frameCount: number, nowMs: number): Int16Array | null {
    if (frameCount <= 0) {
      return null;
    }
    this.resetIfSilent(nowMs);
    const needed = frameCount * 2;
    if (!this.primed) {
      if (this.queuedSamples < this.prebufferSamples) {
        return null;
      }
      this.primed = true;
    }
    const samples = new Int16Array(needed);
    const available = Math.min(
      needed,
      this.queuedSamples - (this.queuedSamples % 2)
    );
    if (available < needed) {
      this.underruns += 1;
    }
    if (available > 0) {
      samples.set(this.takeSamples(available), 0);
    }
    return samples;
  }

  pullRemainder(nowMs: number, minimumMs = 20): Uint8Array | null {
    this.resetIfSilent(nowMs);
    if (!this.primed) {
      return null;
    }
    const minimumSamples = Math.round(minimumMs * this.samplesPerMs);
    if (
      this.queuedSamples < minimumSamples ||
      this.queuedSamples >= this.minBatchSamples
    ) {
      return null;
    }
    const count = this.queuedSamples - (this.queuedSamples % 2);
    return count > 0 ? this.take(count) : null;
  }

  reset(): void {
    this.chunks = [];
    this.head = 0;
    this.queuedSamples = 0;
    this.primed = false;
    this.lastPushAt = null;
  }

  get stats(): PlaybackStats {
    return {
      droppedMs: this.droppedSamples / this.samplesPerMs,
      queuedMs: this.queuedSamples / this.samplesPerMs,
      underruns: this.underruns,
    };
  }

  private resetIfSilent(nowMs: number): void {
    if (
      this.lastPushAt === null ||
      nowMs - this.lastPushAt <= this.silenceResetMs
    ) {
      return;
    }
    this.droppedSamples += this.queuedSamples;
    this.chunks = [];
    this.head = 0;
    this.queuedSamples = 0;
    this.primed = false;
    this.lastPushAt = null;
  }

  private dropOldest(): void {
    while (this.queuedSamples > this.maxSamples && this.chunks.length > 0) {
      const extra = this.queuedSamples - this.maxSamples;
      const available = this.chunks[0].length - this.head;
      const drop = Math.min(extra, available);
      this.head += drop;
      this.queuedSamples -= drop;
      this.droppedSamples += drop;
      if (this.head >= this.chunks[0].length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
  }

  private take(sampleCount: number): Uint8Array {
    const samples = this.takeSamples(sampleCount);
    const bytes = new Uint8Array(sampleCount * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < sampleCount; index += 1) {
      view.setInt16(index * 2, samples[index], true);
    }
    return bytes;
  }

  private takeSamples(sampleCount: number): Int16Array {
    const samples = new Int16Array(sampleCount);
    let filled = 0;
    while (filled < sampleCount && this.chunks.length > 0) {
      const [chunk] = this.chunks;
      if (!chunk) {
        break;
      }
      const count = Math.min(chunk.length - this.head, sampleCount - filled);
      samples.set(chunk.subarray(this.head, this.head + count), filled);
      filled += count;
      this.head += count;
      this.queuedSamples -= count;
      if (this.head >= chunk.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    return samples;
  }
}

export function concatPcm(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function decodeStereoPcm(pcm: Uint8Array): Int16Array | null {
  if (pcm.byteLength < 4 || pcm.byteLength % 4 !== 0) {
    return null;
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Int16Array(pcm.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}
