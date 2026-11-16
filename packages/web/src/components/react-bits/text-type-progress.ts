// Streaming adaptation of React Bits TextType. See UPSTREAM.md and LICENSE.md.
export interface TextTypeFrame {
  text: string;
  pending: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class TextTypeProgress {
  private target: string;
  private ends: number[];
  private shown: number;
  private previousTime: number | null = null;
  private credit = 0;
  private finishAt: number | null = null;

  constructor(text: string, initialContent = text) {
    this.target = text;
    this.ends = this.boundaries(text);
    this.shown = text.startsWith(initialContent) ? this.countThrough(initialContent.length) : this.ends.length;
  }

  get frame(): TextTypeFrame {
    return { text: this.target.slice(0, this.ends[this.shown - 1] ?? 0), pending: this.shown < this.ends.length };
  }

  setTarget(text: string, streaming: boolean, now: number, immediate = false): void {
    const wasPending = this.shown < this.ends.length;
    const previousLength = this.ends[this.shown - 1] ?? 0;
    const correction = !text.startsWith(this.target);
    if (text !== this.target) {
      this.target = text;
      this.ends = this.boundaries(text);
      this.shown = this.countThrough(previousLength);
    }
    if (immediate || correction) {
      this.shown = this.ends.length;
      this.credit = 0;
      this.previousTime = null;
      this.finishAt = null;
      return;
    }
    if (this.shown < this.ends.length && (!wasPending || this.previousTime === null)) {
      // Show the first available grapheme without an artificial initial delay.
      this.shown += 1;
      this.previousTime = now;
      this.credit = 0;
    }
    if (streaming) this.finishAt = null;
    // Leave 50ms for the final animation frame and Markdown highlighting.
    else this.finishAt ??= now + 200;
  }

  advance(now: number): void {
    const pending = this.ends.length - this.shown;
    if (!pending) return;
    if (this.finishAt !== null && now >= this.finishAt) {
      this.shown = this.ends.length;
      return;
    }
    const elapsed = Math.max(0, Math.min(64, now - (this.previousTime ?? now)));
    this.previousTime = now;
    this.credit += elapsed / 1000 * Math.max(60, pending / 0.15);
    const count = Math.floor(this.credit);
    this.credit -= count;
    this.shown += Math.min(pending, count);
  }

  private boundaries(text: string): number[] {
    return Array.from(segmenter.segment(text), ({ index, segment }) => index + segment.length);
  }

  private countThrough(length: number): number {
    if (!length) return 0;
    const index = this.ends.findIndex((end) => end >= length);
    return index === -1 ? this.ends.length : index + 1;
  }
}
