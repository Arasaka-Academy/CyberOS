import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18n, initI18n } from "../../../i18n/index.js";
import { TerminalToolbar, TerminalStatusBar } from "./TerminalControls.js";
import { TerminalClipboardDialog } from "./TerminalClipboardDialog.js";

describe("terminal workbench controls", () => {
  it("disables unavailable input, empty selection, and unsupported fullscreen independently", async () => {
    await initI18n();
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(TerminalToolbar, {
      disabled: false, connected: false, hasSelection: false, searchOpen: false,
      fullscreen: false, fullscreenSupported: false,
      onSearch: () => {}, onCopy: () => {}, onPaste: () => {}, onFullscreen: () => {}
    }));
    expect(html).toContain('aria-label="Terminal tools"');
    expect(html).toContain('aria-label="Search output"');
    expect(html.match(/disabled=""/gu)).toHaveLength(3);
    expect(html).toContain("Fullscreen is not supported in this browser.");
  });

  it("shows dimensions and actual connection state without claiming a live working directory", async () => {
    await initI18n();
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(TerminalStatusBar, {
      state: { status: "connected", diagnostic: null, cols: 120, rows: 32 }, feedback: null
    }));
    expect(html).toContain("Connected");
    expect(html).toContain("120 columns by 32 rows");
    expect(html).toContain("UTF-8");
    expect(html).not.toContain("/home/");
  });

  it("renders errors and takeover as operational states and escapes diagnostics", async () => {
    await initI18n();
    await i18n.changeLanguage("en");
    const error = renderToStaticMarkup(createElement(TerminalStatusBar, {
      state: { status: "error", diagnostic: "<script>not HTML</script>" }, feedback: null
    }));
    expect(error).toContain("Connection error");
    expect(error).not.toContain("<script>");
    expect(error).toContain("&lt;script&gt;");
    const takeover = renderToStaticMarkup(createElement(TerminalStatusBar, {
      state: { status: "takenOver", diagnostic: null }, feedback: null
    }));
    expect(takeover).toContain("Opened elsewhere");
  });

  it("previews unsafe paste as read-only escaped text before any submit", async () => {
    await initI18n();
    await i18n.changeLanguage("en");
    const html = renderToStaticMarkup(createElement(TerminalClipboardDialog, {
      state: { kind: "confirm", target: { tabId: "test", connectionId: 1 }, text: "echo one\n\x1b[31m<script>" },
      onClose: () => {}, onSubmit: () => {}
    }));
    expect(html).toMatch(/readonly/iu);
    expect(html).toContain("\\x1B[31m&lt;script&gt;");
    expect(html).toContain("may execute commands");
    expect(html).toContain("Paste into terminal");
  });
});
