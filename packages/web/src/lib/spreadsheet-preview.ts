let spreadsheetModule: Promise<typeof import("@js-preview/excel")> | null = null;

export function loadSpreadsheetPreview(): Promise<typeof import("@js-preview/excel")> {
  spreadsheetModule ??= importSpreadsheetPreview().catch((error: unknown) => {
    spreadsheetModule = null;
    throw error;
  });
  return spreadsheetModule;
}

async function importSpreadsheetPreview(): Promise<typeof import("@js-preview/excel")> {
  const previousStyles = new Set(document.head.querySelectorAll("style"));
  const containStyles = () => {
    for (const style of document.head.querySelectorAll("style")) {
      const css = style.textContent ?? "";
      if (previousStyles.has(style) || style.dataset.cyberosSpreadsheetLayer || css.includes("@layer")) continue;
      if (!css.includes(".x-spreadsheet") || !css.includes("form fieldset label")) continue;
      style.dataset.cyberosSpreadsheetLayer = "legacy";
      style.textContent = `@layer legacy {\n${css}\n}`;
    }
  };
  const observer = new MutationObserver(containStyles);
  observer.observe(document.head, { childList: true, subtree: true });
  try {
    const loaded = await import("@js-preview/excel");
    containStyles();
    return loaded;
  } finally {
    observer.disconnect();
  }
}
