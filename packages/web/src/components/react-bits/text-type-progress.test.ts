import { describe, expect, it } from "vitest";
import { TextTypeProgress } from "./text-type-progress.js";

describe("streaming TextType progress", () => {
  it("reveals a burst progressively and accelerates to catch up", () => {
    const text = "中文回复".repeat(250);
    const progress = new TextTypeProgress(text, "");
    progress.setTarget(text, true, 0);
    expect(progress.frame.text).toBe("中");
    progress.advance(16);
    expect(progress.frame.text.length).toBeGreaterThan(1);
    expect(progress.frame.text.length).toBeLessThan(text.length);
    for (let time = 32; time <= 1_500; time += 16) progress.advance(time);
    expect(progress.frame).toEqual({ text, pending: false });
  });

  it("preserves the displayed prefix when more text or duplicate targets arrive", () => {
    const progress = new TextTypeProgress("Hello world", "Hello");
    progress.setTarget("Hello world", true, 0);
    progress.advance(32);
    const visible = progress.frame.text;
    progress.setTarget("Hello world and more", true, 33);
    expect(progress.frame.text).toBe(visible);
    progress.setTarget("Hello world and more", true, 34);
    expect(progress.frame.text).toBe(visible);
    progress.advance(50);
    expect(progress.frame.text.startsWith(visible)).toBe(true);
  });

  it("finishes the remaining content with time for Markdown rendering inside the 250ms budget", () => {
    const text = "长回复".repeat(1000);
    const progress = new TextTypeProgress(text, "");
    progress.setTarget(text, true, 0);
    progress.setTarget(text, false, 10);
    progress.advance(26);
    expect(progress.frame.pending).toBe(true);
    progress.advance(210);
    expect(progress.frame).toEqual({ text, pending: false });
  });

  it("resumes hydrated content without replaying it and handles authoritative corrections immediately", () => {
    const progress = new TextTypeProgress("已有文字");
    progress.setTarget("已有文字", true, 0);
    expect(progress.frame).toEqual({ text: "已有文字", pending: false });
    progress.setTarget("已有文字，继续回答", true, 10);
    expect(progress.frame.text.startsWith("已有文字")).toBe(true);
    expect(progress.frame.pending).toBe(true);
    progress.setTarget("修正后的完整回复", true, 20);
    expect(progress.frame).toEqual({ text: "修正后的完整回复", pending: false });
  });

  it("never reveals part of an emoji, flag, or combining character", () => {
    const text = "你👩🏽‍💻é🇨🇳";
    const progress = new TextTypeProgress(text, "");
    progress.setTarget(text, true, 0);
    const prefixes = ["你", "你👩🏽‍💻", "你👩🏽‍💻é", text];
    for (let time = 0; time < 150; time += 8) {
      progress.advance(time);
      expect(prefixes).toContain(progress.frame.text);
    }
    expect(progress.frame.text).toBe(text);
  });

  it("immediately flushes text on interruption or reduced motion", () => {
    const progress = new TextTypeProgress("还在输出的文字", "");
    progress.setTarget("还在输出的文字", true, 0);
    expect(progress.frame.pending).toBe(true);
    progress.setTarget("还在输出的文字", false, 1, true);
    expect(progress.frame).toEqual({ text: "还在输出的文字", pending: false });
  });
});
