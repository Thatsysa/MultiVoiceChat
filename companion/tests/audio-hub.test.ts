import assert from "node:assert/strict";
import { once } from "node:events";
import { connect as connectTcp } from "node:net";
import { describe, it } from "node:test";
import {
  AUDIO_DOWN,
  AUDIO_UP,
  AudioFrameDecoder,
  encodeAudioFrame,
} from "../../src/userplugins/mvc/playback/audio-frames";
import { AudioHub } from "../src/audio-hub";
import { GUILD, tone } from "./support";

describe("loopback audio hub", () => {
  it("exchanges microphone and playback frames on localhost", async () => {
    const hub = new AudioHub();
    const port = await hub.listen();
    const socket = connectTcp({ host: "127.0.0.1", port });
    await once(socket, "connect");
    const uplink = new Promise<{ guildId: string; pcm: Uint8Array }>(
      (resolve) => {
        hub.onMicrophone((guildId, pcm) => resolve({ guildId, pcm }));
      }
    );
    socket.write(
      encodeAudioFrame({ guildId: GUILD, kind: AUDIO_UP, pcm: tone(8) })
    );
    assert.equal((await uplink).guildId, GUILD);
    const downlink = new Promise<Uint8Array>((resolve, reject) => {
      const decoder = new AudioFrameDecoder();
      socket.on("data", (chunk) => {
        try {
          const frames = decoder.push(chunk);
          if (frames[0]) {
            resolve(frames[0].pcm);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    hub.send({ guildId: GUILD, pcm: tone(8) });
    const played = await downlink;
    assert.equal(played.byteLength, tone(8).byteLength);
    assert.equal(AUDIO_DOWN, 1);
    socket.destroy();
    hub.close();
  });
});
