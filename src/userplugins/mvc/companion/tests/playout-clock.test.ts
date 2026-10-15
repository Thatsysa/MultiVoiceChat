import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlayoutClock } from "../../playback/playout-clock";
import {
  splitToneFrames,
  synthesizeTone,
  TONE_FRAME_BYTES,
} from "../../playback/probe-tone";
import { tone } from "./support";

describe("clocked playout", () => {
  it("emits fixed 20ms frames and stays under 80ms", () => {
    const clock = new PlayoutClock();
    const frame = tone(1920);
    for (let index = 0; index < 10; index += 1) {
      clock.push("speaker", frame, index * 20);
      const played = clock.tick();
      assert.ok(played);
      assert.equal(played?.byteLength, TONE_FRAME_BYTES);
    }
    const stats = clock.diagnostics();
    assert.ok(stats.queuedMs <= 80);
    assert.equal(stats.droppedMs, 0);
    assert.equal(stats.underruns, 0);
    const burst = new PlayoutClock();
    for (const piece of splitToneFrames(synthesizeTone(200))) {
      burst.push("speaker", piece, 0);
    }
    const kept: Uint8Array[] = [];
    for (let index = 0; index < 4; index += 1) {
      const played = burst.tick();
      if (!played) {
        throw new Error("missing playout frame");
      }
      kept.push(played);
    }
    assert.equal(burst.tick(), null);
    assert.ok(burst.diagnostics().queuedMs <= 80);
    assert.ok(burst.diagnostics().droppedMs > 0);
    assert.ok(kept.every((played) => played.byteLength === TONE_FRAME_BYTES));
  });

  it("mixes simultaneous speakers into one frame", () => {
    const clock = new PlayoutClock();
    const frame = tone(1920, 8000);
    for (let index = 0; index < 3; index += 1) {
      clock.push("a", frame, index * 20);
      clock.push("b", frame, index * 20);
    }
    const mixed = clock.tick();
    assert.ok(mixed);
    assert.equal(mixed?.byteLength, TONE_FRAME_BYTES);
    const view = new DataView(
      mixed?.buffer,
      mixed?.byteOffset,
      mixed?.byteLength
    );
    assert.equal(view.getInt16(0, true), 16_000);
  });

  it("drops oldest frames and resets after silence", () => {
    const clock = new PlayoutClock();
    const frame = tone(1920);
    for (let index = 0; index < 20; index += 1) {
      clock.push("speaker", frame, index);
    }
    assert.ok(clock.diagnostics().droppedMs > 0);
    assert.ok(clock.diagnostics().queuedMs <= 80);
    clock.push("speaker", frame, 500);
    assert.equal(clock.diagnostics().queuedMs, 20);
  });
});
