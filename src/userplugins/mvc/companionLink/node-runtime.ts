import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export const NODE_RUNTIME_NOT_FOUND = "Node.js runtime not found";

export interface NodeHost {
  env: NodeJS.ProcessEnv;
  execPath: string;
  platform: NodeJS.Platform;
  releaseName: string | undefined;
}

export function resolveNodeRuntime(
  host: NodeHost = currentNodeHost(),
  isFile: (candidate: string) => boolean = isExistingFile
): string {
  const candidates = [
    ...(host.releaseName === "node" ? [host.execPath] : []),
    ...fixedNodeCandidates(host),
    ...pathNodeCandidates(host),
  ];
  for (const candidate of candidates) {
    if (!(isNodeExecutable(candidate) && isFile(candidate))) {
      continue;
    }
    const resolved = resolveExisting(candidate);
    if (isNodeExecutable(resolved) && isFile(resolved)) {
      return resolved;
    }
  }
  throw new Error(NODE_RUNTIME_NOT_FOUND);
}

function currentNodeHost(): NodeHost {
  return {
    env: process.env,
    execPath: process.execPath,
    platform: process.platform,
    releaseName: process.release?.name,
  };
}

function fixedNodeCandidates(host: NodeHost): string[] {
  if (host.platform === "win32") {
    return [host.env.ProgramFiles, host.env["ProgramFiles(x86)"]]
      .filter(
        (root): root is string => typeof root === "string" && root.length > 0
      )
      .map((root) => path.join(root, "nodejs", "node.exe"));
  }
  if (host.platform === "darwin") {
    return ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
  }
  return ["/usr/local/bin/node", "/usr/bin/node"];
}

function pathNodeCandidates(host: NodeHost): string[] {
  const pathValue = host.env.PATH ?? host.env.Path ?? "";
  const name = host.platform === "win32" ? "node.exe" : "node";
  return pathValue
    .split(path.delimiter)
    .filter((part) => part.length > 0)
    .map((part) => path.join(part, name));
}

function isNodeExecutable(candidate: string): boolean {
  if (candidate.length === 0 || candidate.includes("\0")) {
    return false;
  }
  const base = path.basename(candidate).toLowerCase();
  return base === "node" || base === "node.exe";
}

function resolveExisting(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

function isExistingFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}
