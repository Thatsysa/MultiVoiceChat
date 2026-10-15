const FATAL_CLOSE_CODES = new Set([
  4002, 4003, 4004, 4005, 4010, 4011, 4012, 4013, 4014,
]);

export function nextReconnectDelayMs(
  attempt: number,
  closeCode: number
): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) {
    return null;
  }
  if (!Number.isInteger(closeCode)) {
    return null;
  }
  if (FATAL_CLOSE_CODES.has(closeCode)) {
    return null;
  }
  if (attempt >= 5) {
    return null;
  }
  return Math.min(30_000, 500 * 2 ** attempt);
}

export function isFatalGatewayClose(closeCode: number): boolean {
  return FATAL_CLOSE_CODES.has(closeCode);
}
