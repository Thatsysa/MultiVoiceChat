import type { MicrophonePort } from "../voiceSession/controller";

export function createBrowserMicrophone(): MicrophonePort {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  return {
    async start(onFrame) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("microphone unavailable");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 2,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      context = new AudioContext({ sampleRate: 48_000 });
      processor = context.createScriptProcessor(2048, 2, 2);
      const source = context.createMediaStreamSource(stream);
      processor.onaudioprocess = (event) => {
        const left = event.inputBuffer.getChannelData(0);
        const right =
          event.inputBuffer.numberOfChannels > 1
            ? event.inputBuffer.getChannelData(1)
            : left;
        onFrame(stereoPcm(left, right));
      };
      source.connect(processor);
      processor.connect(context.destination);
    },
    stop() {
      processor?.disconnect();
      processor = null;
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      stream = null;
      context?.close();
      context = null;
    },
  };
}

function stereoPcm(left: Float32Array, right: Float32Array): Uint8Array {
  const bytes = new Uint8Array(left.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < left.length; index += 1) {
    view.setInt16(index * 4, floatSample(left[index]), true);
    view.setInt16(
      index * 4 + 2,
      floatSample(right[index] ?? left[index]),
      true
    );
  }
  return bytes;
}

function floatSample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0
    ? Math.round(clamped * 32_768)
    : Math.round(clamped * 32_767);
}
