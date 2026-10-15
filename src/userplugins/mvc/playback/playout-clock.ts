import { AudioMixer, int16ToBytes } from "./audio-mixer";
import {
  type AudioDiagnostics,
  analyzeTone,
  splitToneFrames,
  TONE_FRAME_BYTES,
} from "./probe-tone";

const PREBUFFER_FRAMES = 1;
const MAX_FRAMES = 4;
const SILENCE_RESET_MS = 200;

interface SpeakerQueue {
  frames: Uint8Array[];
  lastPushAt: number | null;
  partial: Uint8Array;
}

export class PlayoutClock {
  private readonly speakers = new Map<string, SpeakerQueue>();
  private started = false;
  private receivedFrames = 0;
  private outputFrames = 0;
  private underruns = 0;
  private droppedFrames = 0;
  private gapMinMs = Number.POSITIVE_INFINITY;
  private gapMaxMs = 0;

  push(speakerKey: string, pcm: Uint8Array, nowMs: number): void {
    if (speakerKey.length === 0 || pcm.byteLength < 2) {
      return;
    }
    const speaker = this.speakers.get(speakerKey) ?? {
      frames: [],
      lastPushAt: null,
      partial: new Uint8Array(0),
    };
    if (speaker.lastPushAt !== null) {
      const gap = nowMs - speaker.lastPushAt;
      if (gap > SILENCE_RESET_MS) {
        this.droppedFrames += speaker.frames.length;
        speaker.frames = [];
        speaker.partial = new Uint8Array(0);
      } else if (gap > 0) {
        this.gapMinMs = Math.min(this.gapMinMs, gap);
        this.gapMaxMs = Math.max(this.gapMaxMs, gap);
      }
    }
    speaker.lastPushAt = nowMs;
    const combined = new Uint8Array(
      speaker.partial.byteLength + pcm.byteLength
    );
    combined.set(speaker.partial, 0);
    combined.set(pcm, speaker.partial.byteLength);
    const frames = splitToneFrames(combined);
    const used = frames.length * TONE_FRAME_BYTES;
    speaker.partial = combined.slice(used);
    for (const frame of frames) {
      speaker.frames.push(frame);
      this.receivedFrames += 1;
    }
    while (speaker.frames.length > MAX_FRAMES) {
      speaker.frames.shift();
      this.droppedFrames += 1;
    }
    this.speakers.set(speakerKey, speaker);
  }

  tick(): Uint8Array | null {
    const ready = [...this.speakers.values()].some(
      (speaker) => speaker.frames.length >= PREBUFFER_FRAMES
    );
    if (!this.started) {
      if (!ready) {
        return null;
      }
      this.started = true;
    }
    const mixer = new AudioMixer();
    let mixed = false;
    for (const [speakerKey, speaker] of this.speakers) {
      const frame = speaker.frames.shift();
      if (!frame) {
        continue;
      }
      mixer.write(speakerKey, frame, 0);
      mixed = true;
    }
    if (!mixed) {
      this.underruns += 1;
      this.started = false;
      return null;
    }
    const frame = mixer.mix(0, 1000, 1920);
    if (frame?.length !== 1920) {
      return null;
    }
    this.outputFrames += 1;
    return int16ToBytes(frame);
  }

  reset(): void {
    this.speakers.clear();
    this.started = false;
  }

  diagnostics(tone: Uint8Array | null = null): AudioDiagnostics {
    const queuedFrames = [...this.speakers.values()].reduce(
      (sum, speaker) => sum + speaker.frames.length,
      0
    );
    return {
      droppedMs: this.droppedFrames * 20,
      gapMaxMs: this.gapMaxMs,
      gapMinMs: Number.isFinite(this.gapMinMs) ? this.gapMinMs : 0,
      outputFrames: this.outputFrames,
      queuedMs: queuedFrames * 20,
      receivedFrames: this.receivedFrames,
      toneOk: tone ? analyzeTone(tone) : false,
      underruns: this.underruns,
    };
  }
}
