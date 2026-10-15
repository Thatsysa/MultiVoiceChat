import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTone, synthesizeTone } from "../../playback/probe-tone";
import { roundTripOpus } from "../src/opus-probe";

describe("opus tone round trip", () => {
  it("keeps a 440Hz stereo tone intelligible", async () => {
    const source = synthesizeTone(1000);
    assert.equal(analyzeTone(source), true);
    const decoded = await roundTripOpus(source);
    assert.equal(decoded.byteLength % 4, 0);
    assert.equal(analyzeTone(decoded), true);
  });
});
