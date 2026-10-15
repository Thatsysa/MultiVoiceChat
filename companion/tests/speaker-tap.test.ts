import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SpeakerTaps,
  type TapDecoder,
  type TapStream,
} from "../src/speaker-tap";

describe("speaker taps", () => {
  it("decodes each speaker once and closes that decoder", () => {
    const taps = new SpeakerTaps();
    let subscriptions = 0;
    let decoders = 0;
    let destroyed = 0;
    const start = (userId: string) =>
      taps.start(
        userId,
        () => {
          subscriptions += 1;
          return {
            destroy() {
              destroyed += 1;
            },
            pipe() {
              /* attached once */
            },
          } satisfies TapStream;
        },
        () => {
          decoders += 1;
          return {
            destroy() {
              destroyed += 1;
            },
            on() {
              /* ignore */
            },
            removeAllListeners() {
              /* ignore */
            },
          } satisfies TapDecoder;
        },
        () => undefined
      );

    assert.equal(start("speaker"), true);
    assert.equal(start("speaker"), false);
    assert.equal(subscriptions, 1);
    assert.equal(decoders, 1);
    assert.equal(start("other"), true);
    assert.equal(subscriptions, 2);
    taps.close();
    assert.equal(destroyed, 4);
    assert.equal(start("speaker"), true);
  });
});
