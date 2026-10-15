export const PROBE_GUILD_ID = "10000000000000001";
export const TONE_FRAME_BYTES = 3840;
const TONE_FREQUENCY = 440;

export interface AudioDiagnostics {
  droppedMs: number;
  gapMaxMs: number;
  gapMinMs: number;
  outputFrames: number;
  queuedMs: number;
  receivedFrames: number;
  toneOk: boolean;
  underruns: number;
}

export function emptyDiagnostics(): AudioDiagnostics {
  return {
    droppedMs: 0,
    gapMaxMs: 0,
    gapMinMs: 0,
    outputFrames: 0,
    queuedMs: 0,
    receivedFrames: 0,
    toneOk: false,
    underruns: 0,
  };
}

export function synthesizeTone(
  durationMs: number,
  frequency = TONE_FREQUENCY
): Uint8Array {
  const frameCount = Math.max(1, Math.round((48_000 * durationMs) / 1000));
  const bytes = new Uint8Array(frameCount * 4);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequency * frame) / 48_000) * 12_000
    );
    view.setInt16(frame * 4, sample, true);
    view.setInt16(frame * 4 + 2, sample, true);
  }
  return bytes;
}

export function splitToneFrames(pcm: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const usable = pcm.byteLength - (pcm.byteLength % TONE_FRAME_BYTES);
  for (let offset = 0; offset < usable; offset += TONE_FRAME_BYTES) {
    frames.push(pcm.slice(offset, offset + TONE_FRAME_BYTES));
  }
  return frames;
}

export function analyzeTone(
  pcm: Uint8Array,
  frequency = TONE_FREQUENCY
): boolean {
  if (pcm.byteLength < TONE_FRAME_BYTES || pcm.byteLength % 4 !== 0) {
    return false;
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frames = pcm.byteLength / 4;
  let first = 0;
  while (first < frames && Math.abs(view.getInt16(first * 4, true)) < 500) {
    first += 1;
  }
  const start = Math.min(first, Math.max(0, frames - 4800));
  let previous = 0;
  let crossings = 0;
  let energy = 0;
  let counted = 0;
  let silentRun = 0;
  let longestSilentRun = 0;
  for (let frame = start; frame < frames; frame += 1) {
    const left = view.getInt16(frame * 4, true);
    const right = view.getInt16(frame * 4 + 2, true);
    const sample = (left + right) / 2;
    energy += sample * sample;
    counted += 1;
    if (Math.abs(sample) < 200) {
      silentRun += 1;
    } else {
      longestSilentRun = Math.max(longestSilentRun, silentRun);
      silentRun = 0;
    }
    if ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0)) {
      crossings += 1;
    }
    previous = sample;
  }
  longestSilentRun = Math.max(longestSilentRun, silentRun);
  if (counted < 4800 || energy / counted < 1_000_000) {
    return false;
  }
  if (longestSilentRun > 48_000 * 0.03) {
    return false;
  }
  const estimated = crossings / 2 / (counted / 48_000);
  return Math.abs(estimated - frequency) <= 40;
}
