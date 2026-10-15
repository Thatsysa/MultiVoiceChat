import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  NODE_RUNTIME_NOT_FOUND,
  type NodeHost,
  resolveNodeRuntime,
} from "../../src/userplugins/mvc/companionLink/node-runtime";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const DISCORD =
  "C:\\Users\\YSA\\AppData\\Local\\Discord\\app-1.0.9261\\Discord.exe";

describe("node runtime discovery", () => {
  it("never selects Discord.exe when Electron reports a Node release", () => {
    const runtime = resolveNodeRuntime(
      electronHost(),
      (candidate) =>
        candidate.toLowerCase().endsWith("node.exe") || candidate === DISCORD
    );
    assert.equal(runtime, NODE);
    assert.equal(path.basename(runtime).toLowerCase(), "node.exe");
    assert.equal(runtime.toLowerCase().includes("discord.exe"), false);
  });

  it("uses the current executable only when it is actually Node", () => {
    const host = electronHost();
    host.releaseName = "node";
    host.execPath = "C:\\node\\node.exe";
    const runtime = resolveNodeRuntime(host, () => true);
    assert.equal(runtime, host.execPath);
  });

  it("reports a missing runtime instead of falling back to Discord", () => {
    assert.throws(() => resolveNodeRuntime(electronHost(), () => false), {
      message: NODE_RUNTIME_NOT_FOUND,
    });
  });
});

function electronHost(): NodeHost {
  return {
    env: {
      PATH: "C:\\Windows\\System32",
      ProgramFiles: "C:\\Program Files",
    },
    execPath: DISCORD,
    platform: "win32",
    releaseName: "node",
  };
}
