import type { PlaybackPort } from "../voiceSession/controller";
import { PlaybackBuffer, type PlaybackStats } from "./playback-buffer";

const SAMPLE_RATE = 48_000;
const CALLBACK_FRAMES = 1024;

interface GuildOutput {
  buffer: PlaybackBuffer;
  context: AudioContext;
  gain: GainNode;
  keepAlive: ConstantSourceNode;
  processor: ScriptProcessorNode;
}

export function createBrowserPlayback(): PlaybackPort {
  const outputs = new Map<string, GuildOutput>();
  return {
    play(guildId, pcm, volume) {
      const output = outputFor(outputs, guildId);
      output.gain.gain.value = volume;
      output.buffer.push(pcm, output.context.currentTime * 1000);
      if (output.context.state === "suspended") {
        output.context.resume();
      }
    },
    reset(guildId) {
      const output = outputs.get(guildId);
      if (!output) {
        return;
      }
      output.buffer.reset();
    },
    stats(guildId): PlaybackStats | null {
      return outputs.get(guildId)?.buffer.stats ?? null;
    },
    stop(guildId) {
      const output = outputs.get(guildId);
      if (!output) {
        return;
      }
      releaseOutput(output);
      output.context.close();
      outputs.delete(guildId);
    },
    stopAll() {
      for (const guildId of [...outputs.keys()]) {
        this.stop(guildId);
      }
    },
  };
}

function outputFor(
  outputs: Map<string, GuildOutput>,
  guildId: string
): GuildOutput {
  const existing = outputs.get(guildId);
  if (existing) {
    return existing;
  }
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const gain = context.createGain();
  gain.connect(context.destination);
  const buffer = new PlaybackBuffer({ prebufferMs: 60 });
  const processor = context.createScriptProcessor(CALLBACK_FRAMES, 2, 2);
  const keepAlive = context.createConstantSource();
  keepAlive.offset.value = 0;
  keepAlive.connect(processor);
  processor.connect(gain);
  const output: GuildOutput = { buffer, context, gain, keepAlive, processor };
  processor.onaudioprocess = (event) => render(output, event);
  keepAlive.start();
  outputs.set(guildId, output);
  return output;
}

function render(output: GuildOutput, event: AudioProcessingEvent): void {
  const left = event.outputBuffer.getChannelData(0);
  const right = event.outputBuffer.getChannelData(1);
  const sourceFrames = framesAtSourceRate(
    left.length,
    output.context.sampleRate
  );
  output.buffer.armLive(sourceFrames);
  const mixed = output.buffer.readLive(
    sourceFrames,
    output.context.currentTime * 1000
  );
  if (!mixed) {
    left.fill(0);
    right.fill(0);
    return;
  }
  writeChannels(left, right, mixed);
}

function framesAtSourceRate(outputFrames: number, outputRate: number): number {
  if (outputRate === SAMPLE_RATE) {
    return outputFrames;
  }
  return Math.max(1, Math.round((outputFrames * SAMPLE_RATE) / outputRate));
}

function writeChannels(
  left: Float32Array,
  right: Float32Array,
  mixed: Int16Array
): void {
  const sourceFrames = mixed.length / 2;
  if (sourceFrames === left.length) {
    for (let index = 0; index < left.length; index += 1) {
      left[index] = mixed[index * 2] / 32_768;
      right[index] = mixed[index * 2 + 1] / 32_768;
    }
    return;
  }
  const scale = (sourceFrames - 1) / Math.max(1, left.length - 1);
  for (let index = 0; index < left.length; index += 1) {
    const position = index * scale;
    const cursor = Math.floor(position);
    const next = Math.min(sourceFrames - 1, cursor + 1);
    const fraction = position - cursor;
    left[index] =
      (mixed[cursor * 2] * (1 - fraction) + mixed[next * 2] * fraction) /
      32_768;
    right[index] =
      (mixed[cursor * 2 + 1] * (1 - fraction) +
        mixed[next * 2 + 1] * fraction) /
      32_768;
  }
}

function releaseOutput(output: GuildOutput): void {
  output.buffer.reset();
  output.processor.onaudioprocess = null;
  output.processor.disconnect();
  try {
    output.keepAlive.stop();
  } catch {
    /* already stopped */
  }
  output.keepAlive.disconnect();
}
