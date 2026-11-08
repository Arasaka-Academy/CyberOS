import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initI18n } from "../../i18n/index.js";
import { PowerControl, PowerDialog } from "./PowerControl.js";

await initI18n();

const noop = () => undefined;

describe("PowerControl", () => {
  it("marks the unlabelled navigation trigger as icon-only", () => {
    const html = renderToStaticMarkup(createElement(PowerControl, { onRequest: async () => false }));

    expect(html).toContain('data-icon-only="true"');
    expect(html).toContain('class="cyberos-button agent-power-button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('data-slot="decoration"');
  });

  it("preserves the labelled settings command", () => {
    const html = renderToStaticMarkup(createElement(PowerControl, { labelled: true, onRequest: async () => false }));

    expect(html).not.toContain('data-icon-only="true"');
    expect(html).toContain('settings-power-button secondary-button');
    expect(html).toContain('data-slot="decoration"');
  });
});

describe("PowerDialog", () => {
  it("renders restart and shutdown choices before confirmation", () => {
    const html = renderToStaticMarkup(
      createElement(PowerDialog, {
        dialogRef: createRef<HTMLElement>(),
        action: null,
        busy: false,
        onSelect: noop,
        onBack: noop,
        onClose: noop,
        onConfirm: noop
      })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-action="reboot"');
    expect(html).toContain('data-action="shutdown"');
    expect(html).toContain("Restart");
    expect(html).toContain("Shut down");
    expect(html).not.toContain("Restart now");
  });

  it("renders a separate destructive confirmation state", () => {
    const html = renderToStaticMarkup(
      createElement(PowerDialog, {
        dialogRef: createRef<HTMLElement>(),
        action: "shutdown",
        busy: false,
        onSelect: noop,
        onBack: noop,
        onClose: noop,
        onConfirm: noop
      })
    );

    expect(html).toContain("Shut down this device?");
    expect(html).toContain("Shut down now");
    expect(html).toMatch(/class="[^"]*\bdanger-button power-confirm-button\b[^"]*"/u);
    expect(html).not.toContain('data-action="reboot"');
  });

  it("disables navigation and marks confirmation busy while submitting", () => {
    const html = renderToStaticMarkup(
      createElement(PowerDialog, {
        dialogRef: createRef<HTMLElement>(),
        action: "reboot",
        busy: true,
        onSelect: noop,
        onBack: noop,
        onClose: noop,
        onConfirm: noop
      })
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Requesting restart");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
