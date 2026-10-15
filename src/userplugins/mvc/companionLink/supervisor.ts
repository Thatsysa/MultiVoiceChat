import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { connect as connectTcp } from "node:net";
import {
  AUDIO_UP,
  type AudioFrame,
  AudioFrameDecoder,
  encodeAudioFrame,
} from "../playback/audio-frames";
import { PROBE_GUILD_ID } from "../playback/probe-tone";
import { failureMessage } from "../voiceSession/messages";
import { redact } from "../voiceSession/redaction";
import {
  asPcmBytes,
  isSafeCompanionEntry,
  isSnowflake,
  isUserToken,
} from "../voiceSession/validation";
import { LineBuffer } from "./line-buffer";
import { resolveNodeRuntime } from "./node-runtime";
import {
  type CompanionCommand,
  type CompanionEvent,
  parseCompanionEvent,
} from "./protocol";

export interface CompanionChild {
  kill: () => void;
  onExit: (listener: (code: number | null) => void) => void;
  onStderr: (listener: (chunk: string) => void) => void;
  onStdout: (listener: (chunk: string) => void) => void;
  write: (data: string) => void;
}

export interface AudioSocket {
  close: () => void;
  onFrame: (listener: (frame: AudioFrame) => void) => void;
  send: (bytes: Uint8Array) => void;
}

export interface SupervisorLogger {
  error: (message: string) => void;
}

type UiEvent = Extract<CompanionEvent, { type: "status" | "closed" | "error" }>;

interface Waiter {
  reject: (error: Error) => void;
  resolve: (event: CompanionEvent) => void;
  type: CompanionEvent["type"];
}

export class CompanionSupervisor {
  private child: CompanionChild | null = null;
  private audio: AudioSocket | null = null;
  private token = "";
  private entry = "";
  private unlocked = false;
  private stopping = false;
  private readonly lines = new LineBuffer();
  private readonly events: UiEvent[] = [];
  private readonly audioQueue: Array<{ guildId: string; pcm: Uint8Array }> = [];
  private waiter: Waiter | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly spawnChild: (entry: string) => CompanionChild;
  private readonly connectAudio: (port: number) => Promise<AudioSocket>;
  private readonly logger: SupervisorLogger;
  private readonly handshakeTimeoutMs: number;

  constructor(
    spawnChild: (entry: string) => CompanionChild,
    connectAudio: (port: number) => Promise<AudioSocket>,
    logger: SupervisorLogger,
    handshakeTimeoutMs = 5000
  ) {
    this.spawnChild = spawnChild;
    this.connectAudio = connectAudio;
    this.logger = logger;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
  }

  connect(request: {
    companionEntry: string;
    token: string;
    guildId: string;
    channelId: string;
    muted: boolean;
    deafened: boolean;
    transmitting: boolean;
    replace: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.enqueue(async () => {
      if (!isSafeCompanionEntry(request.companionEntry)) {
        return { error: failureMessage("companion-entry"), ok: false };
      }
      if (!isUserToken(request.token)) {
        return { error: failureMessage("token-unavailable"), ok: false };
      }
      if (!(isSnowflake(request.guildId) && isSnowflake(request.channelId))) {
        return { error: failureMessage("invalid-channel"), ok: false };
      }
      try {
        await this.ensure(request.companionEntry, request.token);
        this.write({
          channelId: request.channelId,
          deafened: request.deafened,
          guildId: request.guildId,
          muted: request.muted,
          replace: request.replace,
          transmitting: request.transmitting,
          type: "connect",
        });
        return { ok: true };
      } catch (error) {
        return { error: this.safeError(error), ok: false };
      }
    });
  }

  update(request: {
    guildId: string;
    muted: boolean;
    deafened: boolean;
    transmitting: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.enqueue(() => {
      if (!this.child) {
        return { error: failureMessage("missing-connection"), ok: false };
      }
      if (!isSnowflake(request.guildId)) {
        return { error: failureMessage("invalid-channel"), ok: false };
      }
      this.write({ type: "update", ...request });
      return { ok: true };
    });
  }

  disconnect(
    guildId: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.enqueue(() => {
      if (!isSnowflake(guildId)) {
        return { error: failureMessage("invalid-channel"), ok: false };
      }
      if (!this.child) {
        return { ok: true };
      }
      this.write({ guildId, type: "disconnect" });
      return { ok: true };
    });
  }

  playbackAck(guildId: string): { ok: boolean; error?: string } {
    if (!(this.child && isSnowflake(guildId))) {
      return { error: failureMessage("missing-connection"), ok: false };
    }
    this.write({ guildId, type: "playback" });
    return { ok: true };
  }

  pushAudio(guildId: string, pcm: Uint8Array): { ok: boolean; error?: string } {
    const bytes = asPcmBytes(pcm);
    if (!(this.audio && isSnowflake(guildId) && bytes)) {
      return { error: failureMessage("invalid-channel"), ok: false };
    }
    this.audio.send(encodeAudioFrame({ guildId, kind: AUDIO_UP, pcm: bytes }));
    return { ok: true };
  }

  pullEvents(): UiEvent[] {
    return this.events.splice(0, this.events.length);
  }

  pullAudio(): Array<{ guildId: string; pcm: Uint8Array }> {
    return this.audioQueue.splice(0, this.audioQueue.length);
  }

  async shutdown(): Promise<void> {
    await this.enqueue(() => {
      this.stopChild(true);
    });
  }

  async probe(
    entry: string,
    kind: "transport" | "opus"
  ): Promise<{
    pcm: Uint8Array;
    receivedFrames: number;
    outputFrames: number;
    queuedMs: number;
    underruns: number;
    droppedMs: number;
    gapMinMs: number;
    gapMaxMs: number;
    toneOk: boolean;
  }> {
    return await this.enqueue(async () => {
      if (!isSafeCompanionEntry(entry)) {
        throw new Error(failureMessage("companion-entry"));
      }
      await this.startProcess(entry);
      const pending = this.waitFor("probe");
      this.write({ kind, type: "probe" });
      const event = await pending;
      if (event.type !== "probe") {
        throw new Error("voice companion stopped");
      }
      await new Promise((resolve) => setImmediate(resolve));
      const frames = this.audioQueue.splice(0, this.audioQueue.length);
      const chunks = frames
        .filter((frame) => frame.guildId === PROBE_GUILD_ID)
        .map((frame) => frame.pcm);
      const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const pcm = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        droppedMs: event.droppedMs,
        gapMaxMs: event.gapMaxMs,
        gapMinMs: event.gapMinMs,
        outputFrames: event.outputFrames,
        pcm,
        queuedMs: event.queuedMs,
        receivedFrames: event.receivedFrames,
        toneOk: event.toneOk,
        underruns: event.underruns,
      };
    });
  }

  private async ensure(entry: string, token: string): Promise<void> {
    if (this.child && this.entry !== entry) {
      this.stopChild(true);
    }
    await this.startProcess(entry);
    if (this.unlocked) {
      return;
    }
    this.token = token;
    const unlocked = this.waitFor("unlocked");
    this.write({ token, type: "unlock" });
    await unlocked;
    this.unlocked = true;
  }

  private async startProcess(entry: string): Promise<void> {
    if (this.child) {
      return;
    }
    this.stopping = false;
    this.entry = entry;
    try {
      this.child = this.spawnChild(entry);
      this.bind(this.child);
      const ready = await this.waitFor("ready");
      if (ready.type !== "ready") {
        throw new Error("voice companion stopped");
      }
      this.audio = await this.connectAudio(ready.audioPort);
      this.audio.onFrame((frame) => {
        if (frame.kind !== 1) {
          return;
        }
        this.audioQueue.push({ guildId: frame.guildId, pcm: frame.pcm });
        if (this.audioQueue.length > 32) {
          this.audioQueue.shift();
        }
      });
    } catch (error) {
      this.stopChild(true);
      throw error;
    }
  }

  private bind(child: CompanionChild): void {
    child.onStdout((chunk) => {
      let commands: string[];
      try {
        commands = this.lines.push(chunk);
      } catch {
        this.logger.error("invalid control message");
        return;
      }
      for (const line of commands) {
        this.receiveLine(line);
      }
    });
    child.onStderr((chunk) =>
      this.logger.error(redact(chunk, this.token ? [this.token] : []))
    );
    child.onExit(() => {
      if (!this.stopping) {
        this.events.push({ message: "voice companion stopped", type: "error" });
      }
      this.clearProcess();
    });
  }

  private receiveLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.logger.error("invalid control message");
      return;
    }
    const event = parseCompanionEvent(value, this.token ? [this.token] : []);
    if (!event) {
      this.logger.error("ignored companion event");
      return;
    }
    const { waiter } = this;
    if (waiter?.type === event.type) {
      this.waiter = null;
      waiter.resolve(event);
      return;
    }
    if (
      event.type === "status" ||
      event.type === "closed" ||
      event.type === "error"
    ) {
      this.events.push(event);
    }
  }

  private waitFor(type: CompanionEvent["type"]): Promise<CompanionEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.resolve === resolve) {
          this.waiter = null;
        }
        reject(new Error("voice companion stopped"));
      }, this.handshakeTimeoutMs);
      this.waiter = {
        reject,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        type,
      };
    });
  }

  private write(command: CompanionCommand): void {
    this.child?.write(`${JSON.stringify(command)}\n`);
  }

  private stopChild(intentional: boolean): void {
    this.stopping = intentional;
    if (this.child) {
      try {
        this.write({ type: "shutdown" });
      } catch {
        // The companion is already gone.
      }
      this.child.kill();
    }
    this.clearProcess();
  }

  private clearProcess(): void {
    this.audio?.close();
    this.audio = null;
    this.child = null;
    this.token = "";
    this.entry = "";
    this.unlocked = false;
  }

  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.chain.then(work, work);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private safeError(error: unknown): string {
    const message =
      error instanceof Error ? error.message : "voice companion stopped";
    return redact(message, this.token ? [this.token] : []).slice(0, 200);
  }
}

export function spawnCompanionProcess(entry: string): CompanionChild {
  if (!(isSafeCompanionEntry(entry) && existsSync(entry))) {
    throw new Error("companion entry rejected");
  }
  const resolved = realpathSync(entry);
  if (!(isSafeCompanionEntry(resolved) && statSync(resolved).isFile())) {
    throw new Error("companion entry rejected");
  }
  const child = spawn(resolveNodeRuntime(), [resolved], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    kill() {
      child.kill();
    },
    onExit(listener) {
      child.on("exit", (code) => listener(code));
    },
    onStderr(listener) {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", listener);
    },
    onStdout(listener) {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", listener);
    },
    write(data) {
      child.stdin?.write(data);
    },
  };
}

export function connectLoopbackAudio(port: number): Promise<AudioSocket> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return Promise.reject(new Error("voice companion stopped"));
  }
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: "127.0.0.1", port });
    const decoder = new AudioFrameDecoder();
    let listener: (frame: AudioFrame) => void = () => undefined;
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(chunk)) {
          listener(frame);
        }
      } catch {
        socket.destroy();
      }
    });
    socket.once("connect", () => {
      resolve({
        close: () => socket.destroy(),
        onFrame: (next) => {
          listener = next;
        },
        send: (bytes) => {
          socket.write(bytes);
        },
      });
    });
    socket.once("error", () => reject(new Error("voice companion stopped")));
  });
}
