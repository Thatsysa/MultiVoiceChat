export class LineBuffer {
  private pending = "";

  push(chunk: string): string[] {
    if (chunk.includes("\0")) {
      throw new Error("invalid control message");
    }
    this.pending += chunk;
    if (this.pending.length > 1_000_000) {
      this.pending = "";
      throw new Error("invalid control message");
    }
    const parts = this.pending.split("\n");
    this.pending = parts.pop() ?? "";
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  }
}
