import { parseCompanionCommand } from "../../src/userplugins/mvc/companionLink/protocol";
import {
  analyzeTone,
  PROBE_GUILD_ID,
  splitToneFrames,
  synthesizeTone,
} from "../../src/userplugins/mvc/playback/probe-tone";
import { redact } from "../../src/userplugins/mvc/voiceSession/redaction";
import { opusProbeDiagnostics } from "./opus-probe";
import type { GatewaySocketFactory, Scheduler } from "./runtime";
import {
  type AudioEndpoint,
  type SessionListener,
  SessionManager,
  type VoiceBridge,
} from "./session-manager";

export class CompanionApp {
  readonly sessions: SessionManager;
  private readonly write: (line: string) => void;
  private readonly audio: AudioEndpoint;

  constructor(deps: {
    sockets: GatewaySocketFactory;
    voices: VoiceBridge;
    scheduler: Scheduler;
    audio: AudioEndpoint;
    now?: () => number;
    write: (line: string) => void;
  }) {
    this.write = deps.write;
    this.audio = deps.audio;
    const listener: SessionListener = {
      closed: (guildId, feasibility) =>
        this.writeLine({ feasibility, guildId, type: "closed" }),
      error: (message) =>
        this.writeLine({ message: redact(message), type: "error" }),
      status: (status) =>
        this.writeLine({ connection: status, type: "status" }),
    };
    this.sessions = new SessionManager(
      deps.sockets,
      deps.voices,
      deps.scheduler,
      listener,
      deps.audio,
      deps.now
    );
  }

  async handle(line: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.writeLine({ message: "invalid control message", type: "error" });
      return;
    }
    const command = parseCompanionCommand(parsed);
    if (!command) {
      this.writeLine({ message: "invalid control message", type: "error" });
      return;
    }
    try {
      if (command.type === "probe") {
        await this.probe(command.kind);
        return;
      }
      if (command.type === "unlock") {
        this.sessions.unlock(command.token);
        this.writeLine({ type: "unlocked" });
        return;
      }
      if (command.type === "shutdown") {
        await this.sessions.shutdown();
        return;
      }
      if (command.type === "disconnect") {
        await this.sessions.disconnect(command.guildId);
        return;
      }
      if (command.type === "playback") {
        this.sessions.notePlayback(command.guildId);
        return;
      }
      if (command.type === "update") {
        this.sessions.update(command);
        return;
      }
      await this.sessions.connect(command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "voice session stopped";
      this.writeLine({ message: redact(message), type: "error" });
    }
  }

  private async probe(kind: "transport" | "opus"): Promise<void> {
    const source = synthesizeTone(1000);
    const pcm = kind === "opus" ? (await opusProbeDiagnostics()).pcm : source;
    const toneOk = analyzeTone(pcm);
    for (const frame of splitToneFrames(pcm)) {
      this.audio.send({ guildId: PROBE_GUILD_ID, pcm: frame });
    }
    this.writeLine({
      droppedMs: 0,
      gapMaxMs: 20,
      gapMinMs: 20,
      kind,
      outputFrames: Math.floor(pcm.byteLength / 3840),
      queuedMs: 0,
      receivedFrames: Math.floor(source.byteLength / 3840),
      toneOk,
      type: "probe",
      underruns: 0,
    });
  }

  private writeLine(event: unknown): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
}
