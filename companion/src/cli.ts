import { LineBuffer } from "../../src/userplugins/mvc/companionLink/line-buffer";
import { AudioHub } from "./audio-hub";
import { CompanionApp } from "./companion-app";
import { nodeGatewaySockets, realScheduler } from "./node-gateway";
import { DiscordVoiceBridge } from "./voice-bridge";

export function runCompanion(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream
): Promise<void> {
  const audio = new AudioHub();
  const app = new CompanionApp({
    audio,
    scheduler: realScheduler,
    sockets: nodeGatewaySockets,
    voices: new DiscordVoiceBridge(),
    write: (line) => output.write(line),
  });
  audio.onMicrophone((guildId, pcm) =>
    app.sessions.writeMicrophone(guildId, pcm)
  );
  let stopped = false;
  const stoppedPromise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      audio.close();
      resolve();
    };
    audio
      .listen()
      .then((port) => {
        output.write(
          `${JSON.stringify({ audioPort: port, protocol: 1, type: "ready" })}\n`
        );
        const lines = new LineBuffer();
        input.setEncoding("utf8");
        input.on("data", (chunk) => {
          accept(String(chunk));
        });
        input.on("end", () => {
          app.handle(JSON.stringify({ type: "shutdown" })).finally(finish);
        });

        async function accept(chunk: string): Promise<void> {
          let commands: string[];
          try {
            commands = lines.push(chunk);
          } catch {
            output.write(
              `${JSON.stringify({ message: "invalid control message", type: "error" })}\n`
            );
            return;
          }
          for (const command of commands) {
            // biome-ignore lint/performance/noAwaitInLoops: control commands must run in order
            await app.handle(command);
            if (isShutdown(command)) {
              finish();
            }
          }
        }
      })
      .catch(() => {
        if (stopped) {
          return;
        }
        stopped = true;
        audio.close();
        reject(new Error("voice companion stopped"));
      });
  });
  return stoppedPromise;
}

function isShutdown(line: string): boolean {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return value.type === "shutdown";
  } catch {
    return false;
  }
}

if (require.main === module) {
  runCompanion(process.stdin, process.stdout).then(
    () => {
      process.exit(0);
    },
    () => {
      process.stderr.write("voice companion stopped\n");
      process.exit(1);
    }
  );
}
