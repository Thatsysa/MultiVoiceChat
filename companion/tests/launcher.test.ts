import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveNodeRuntime } from "../../src/userplugins/mvc/companionLink/node-runtime";

describe("companion launcher", () => {
  it("emits a ready handshake and exits after shutdown", async () => {
    const runtime = resolveNodeRuntime();
    assert.equal(
      path.basename(runtime).toLowerCase(),
      process.platform === "win32" ? "node.exe" : "node"
    );
    assert.equal(runtime.toLowerCase().includes("discord.exe"), false);
    // biome-ignore lint/correctness/noGlobalDirnameFilename: this test compiles as CommonJS
    const entry = path.resolve(__dirname, "../../../start.cjs");
    const child = spawn(runtime, [entry], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const ready = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("launcher did not become ready"));
      }, 3000);
      const fail = (exitCode: number | null) => {
        clearTimeout(timer);
        reject(new Error(`launcher exited ${exitCode ?? "null"} before ready`));
      };
      child.once("exit", fail);
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        const line = output
          .split("\n")
          .find((item) => item.includes('"type":"ready"'));
        if (!line) {
          return;
        }
        clearTimeout(timer);
        child.off("exit", fail);
        resolve(line);
      });
    });
    const message = JSON.parse(ready) as {
      type?: string;
      protocol?: number;
      audioPort?: number;
    };
    assert.equal(message.type, "ready");
    assert.equal(message.protocol, 1);
    assert.equal(
      Number.isInteger(message.audioPort) && (message.audioPort ?? 0) > 0,
      true
    );
    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    const [code] = (await once(child, "exit")) as [number | null];
    assert.equal(code, 0);
    assert.equal(stderr.includes("mfa."), false);
  });
});
