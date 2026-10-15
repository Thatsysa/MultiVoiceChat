const TOKEN_LIKE = /(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,})/g;

export function redact(text: string, secrets: readonly string[] = []): string {
  let redacted = text.replace(TOKEN_LIKE, "[redacted]");
  for (const secret of secrets) {
    if (secret.length < 8) {
      continue;
    }
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}
