import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlaybackBuffer } from "../../src/userplugins/mvc/playback/playback-buffer";
import { tone } from "./support";

const PACKET_MS = 20;
const PACKET = tone(1920);

describe("playback jitter", () => {
  it("exposes gaps in the 50ms per-packet scheduler and rides through the same arrivals", () => {
    const arrivals = jitteredArrivals();
    assert.ok(countLegacyUnderruns(arrivals) > 0);
    const buffer = new PlaybackBuffer();
    const stats = playThrough(buffer, arrivals);
    assert.ok(stats.underruns <= 1);
    assert.ok(stats.queuedMs <= 80);
    assert.equal(stats.droppedMs, 0);
  });

  it("drops the oldest audio once latency reaches 250ms", () => {
    const buffer = new PlaybackBuffer();
    for (let index = 0; index < 20; index += 1) {
      buffer.push(PACKET, index);
    }
    const { stats } = buffer;
    assert.ok(stats.queuedMs <= 80);
    assert.ok(stats.droppedMs >= 300);
  });

  it("prebuffers again after silence", () => {
    const buffer = new PlaybackBuffer();
    for (let index = 0; index < 6; index += 1) {
      buffer.push(PACKET, index * PACKET_MS);
    }
    assert.ok(buffer.pull(100));
    buffer.push(PACKET, 400);
    assert.ok(buffer.pull(400));
    assert.equal(buffer.stats.underruns, 0);
  });

  it("resets queued audio on disconnect or deafen", () => {
    const buffer = new PlaybackBuffer();
    for (let index = 0; index < 6; index += 1) {
      buffer.push(PACKET, index);
    }
    buffer.reset();
    assert.equal(buffer.stats.queuedMs, 0);
    assert.equal(buffer.pull(10), null);
  });

  it("plays contiguous samples and gaps one late packet without shifting later audio", () => {
    const buffer = new PlaybackBuffer();
    const first = tone(1920, 1000);
    const second = tone(1920, 2000);
    buffer.push(first, 0);
    buffer.push(second, 20);
    assert.deepEqual(buffer.readLive(1920, 20), pcmSamples([first, second]));
    assert.ok(buffer.stats.queuedMs <= 80);

    const gap = buffer.readLive(960, 40);
    assert.ok(gap);
    assert.ok(gap?.every((sample) => sample === 0));

    buffer.push(tone(960, 4000), 60);
    const late = buffer.readLive(960, 60);
    assert.equal(late?.[0], 4000);
    assert.equal(late?.[1], -4000);
    assert.equal(late?.[960], 0);

    buffer.push(tone(1920, 5000), 80);
    const next = buffer.readLive(960, 80);
    assert.equal(next?.[0], 5000);
    assert.equal(buffer.stats.queuedMs, 0);
    assert.ok(buffer.stats.queuedMs <= 80);
  });

  it("fills every device callback from a steady 20ms stream", () => {
    const buffer = new PlaybackBuffer({ prebufferMs: 60 });
    buffer.armLive(1024);
    for (let index = 0; index < 4; index += 1) {
      buffer.push(tone(1920, 8000), index * 20);
    }
    let packetAt = 80;
    let callbackAt = 60;
    const period = 1024 / 48;
    for (let step = 0; step < 30; step += 1) {
      if (packetAt <= callbackAt) {
        buffer.push(tone(1920, 8000), packetAt);
        packetAt += 20;
        continue;
      }
      const frame = buffer.readLive(1024, callbackAt);
      assert.ok(frame);
      assert.equal(frame?.includes(0), false);
      callbackAt += period;
    }
    assert.equal(buffer.stats.underruns, 0);
    assert.equal(buffer.stats.droppedMs, 0);
    assert.ok(buffer.stats.queuedMs < 120);
  });
});

function jitteredArrivals(): number[] {
  const gaps = [20, 20, 20, 20, 20, 20, 45, 20, 20, 20, 20, 20];
  const arrivals = [0];
  for (const gap of gaps) {
    arrivals.push((arrivals.at(-1) ?? 0) + gap);
  }
  return arrivals;
}

function countLegacyUnderruns(arrivals: readonly number[]): number {
  let next = 0;
  let underruns = 0;
  for (const arrival of arrivals) {
    const start = Math.max(arrival + 50, next);
    if (next > 0 && start > next) {
      underruns += 1;
    }
    next = start + PACKET_MS;
  }
  return underruns;
}

function playThrough(
  buffer: PlaybackBuffer,
  arrivals: readonly number[]
): { underruns: number; queuedMs: number; droppedMs: number } {
  let index = 0;
  let nextPlay = 0;
  let started = false;
  const end = arrivals.at(-1) ?? 0;
  for (let time = 0; time <= end; time += 5) {
    while (index < arrivals.length && arrivals[index] <= time) {
      buffer.push(PACKET, arrivals[index]);
      index += 1;
    }
    if (started && time < nextPlay) {
      continue;
    }
    const played = buffer.pull(time);
    if (!played) {
      continue;
    }
    started = true;
    nextPlay = Math.max(nextPlay, time) + played.byteLength / 4 / 48;
  }
  return buffer.stats;
}

function pcmSamples(chunks: Uint8Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
  const samples = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let index = 0; index < chunk.byteLength / 2; index += 1) {
      samples[offset] = view.getInt16(index * 2, true);
      offset += 1;
    }
  }
  return samples;
}
