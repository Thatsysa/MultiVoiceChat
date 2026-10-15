const PCM_RMS_THRESHOLD = 0.01;

import type { VoiceControls } from "./connection-record";
import { emptyMilestones, type FeasibilityMilestones } from "./milestones";

export function pcmRms(pcm: Uint8Array): number {
  const length = pcm.byteLength - (pcm.byteLength % 2);
  if (length < 2) {
    return 0;
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, length);
  let sum = 0;
  const count = length / 2;
  for (let index = 0; index < count; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32_768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

function hasDecodedEnergy(pcm: Uint8Array): boolean {
  return pcmRms(pcm) >= PCM_RMS_THRESHOLD;
}

export class FeasibilityTracker {
  private readonly milestones = emptyMilestones();

  snapshot(): FeasibilityMilestones {
    return { ...this.milestones };
  }

  notePresence(): void {
    this.milestones.secondaryPresence = true;
  }

  noteDecoded(pcm: Uint8Array): void {
    if (hasDecodedEnergy(pcm)) {
      this.milestones.encryptedReceive = true;
    }
  }

  notePlayback(): void {
    this.milestones.audiblePlayback = true;
  }

  noteTransmit(pcm: Uint8Array): void {
    if (hasDecodedEnergy(pcm)) {
      this.milestones.microphoneTransmit = true;
    }
  }

  noteControls(previous: VoiceControls, next: VoiceControls): boolean {
    const changes = [
      previous.muted !== next.muted,
      previous.deafened !== next.deafened,
      previous.transmitting !== next.transmitting,
    ].filter(Boolean).length;
    if (changes !== 1) {
      return false;
    }
    this.milestones.independentControls = true;
    return true;
  }

  noteTeardown(): void {
    this.milestones.teardown = true;
  }
}
