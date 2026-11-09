import { describe, expect, it } from "vitest";
import { TERMINAL_MAX_INPUT_BYTES } from "../../../shared/src/terminal-protocol.js";
import {
  terminalPasteNeedsConfirmation,
  TERMINAL_INPUT_LIMIT_BYTES,
  terminalPastePreview,
  terminalPasteSize,
  terminalPasteTargetMatches,
  terminalWorkbenchShortcut
} from "./terminal-workbench.js";

describe("terminal paste safety", () => {
  it.each(["echo hello", "中文路径/文件", ""])("allows ordinary single-line text: %s", (text) => {
    expect(terminalPasteNeedsConfirmation(text)).toBe(false);
  });

  it.each(["echo one\necho two", "echo one\r", "printf\ttext", "\x1b[31mred", "\0", "\x7f", "\x9b31m"])("requires confirmation for command separators or controls: %j", (text) => {
    expect(terminalPasteNeedsConfirmation(text)).toBe(true);
  });

  it("renders controls visibly without interpreting terminal escape sequences", () => {
    expect(terminalPastePreview("echo one\n\x1b[31m\0\r\t\x7f\x9b"))
      .toBe("echo one\n\\x1B[31m\\x00\\r\\t\\x7F\\x9B");
  });

  it("counts UTF-8 bytes after xterm newline normalization and bracketed-paste wrapping", () => {
    expect(TERMINAL_INPUT_LIMIT_BYTES).toBe(TERMINAL_MAX_INPUT_BYTES);
    expect(terminalPasteSize("中\r\n文\n", false)).toBe(8);
    expect(terminalPasteSize("中\r\n文\n", true)).toBe(20);
    expect(terminalPasteSize("x".repeat(65_524), true)).toBe(65_536);
    expect(terminalPasteSize("x".repeat(65_525), true)).toBeGreaterThan(65_536);
  });

  it("binds paste approval to both the tab and the exact attachment", () => {
    const target = { tabId: "first", connectionId: 3 };
    expect(terminalPasteTargetMatches(target, { ...target })).toBe(true);
    expect(terminalPasteTargetMatches(target, { tabId: "other", connectionId: 3 })).toBe(false);
    expect(terminalPasteTargetMatches(target, { tabId: "first", connectionId: 4 })).toBe(false);
    expect(terminalPasteTargetMatches(target, null)).toBe(false);
  });
});

describe("terminal workbench shortcuts", () => {
  function shortcut(key: string, modifiers: Partial<KeyboardEvent> = {}) {
    return terminalWorkbenchShortcut({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, ...modifiers });
  }

  it("keeps Ctrl+C, Ctrl+F, native paste, and composing input available to the shell/browser", () => {
    expect(shortcut("c", { ctrlKey: true })).toBeNull();
    expect(shortcut("f", { ctrlKey: true })).toBeNull();
    expect(shortcut("v", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(shortcut("f", { metaKey: true, isComposing: true })).toBeNull();
  });

  it("uses scoped search and copy shortcuts without consuming Alt chords", () => {
    expect(shortcut("F", { ctrlKey: true, shiftKey: true })).toBe("search");
    expect(shortcut("f", { metaKey: true })).toBe("search");
    expect(shortcut("C", { ctrlKey: true, shiftKey: true })).toBe("copy");
    expect(shortcut("f", { ctrlKey: true, shiftKey: true, altKey: true })).toBeNull();
  });
});
