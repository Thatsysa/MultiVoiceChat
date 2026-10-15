const SNOWFLAKE = /^[0-9]{5,25}$/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//;
const USER_TOKEN = /^(?:[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}|mfa\.[\w-]{20,})$/;

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE.test(value);
}

export function isUserToken(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 200 && USER_TOKEN.test(value)
  );
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function normalizeVolume(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0 || value > 1) {
    return null;
  }
  return value;
}

export function isSafeCompanionEntry(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") {
    return false;
  }
  if (candidate.length === 0 || candidate.length > 4096) {
    return false;
  }
  if (candidate.includes("\0")) {
    return false;
  }
  const normalized = candidate.replaceAll("\\", "/");
  if (!(normalized.endsWith("/start.cjs") || normalized.endsWith("/cli.js"))) {
    return false;
  }
  const absolute =
    WINDOWS_ABSOLUTE.test(normalized) || normalized.startsWith("/");
  if (!absolute) {
    return false;
  }
  if (normalized.split("/").includes("..")) {
    return false;
  }
  return true;
}

export function asPcmBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    if (
      value.byteLength === 0 ||
      value.byteLength > 16_384 ||
      value.byteLength % 2 !== 0
    ) {
      return null;
    }
    return value;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.length % 2 !== 0
  ) {
    return null;
  }
  if (
    !value.every((item) => typeof item === "number" && item >= 0 && item <= 255)
  ) {
    return null;
  }
  return Uint8Array.from(value);
}
