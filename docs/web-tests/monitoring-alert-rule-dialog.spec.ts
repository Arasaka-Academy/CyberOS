import { expect, test, type Page } from "@playwright/test";
import type { MonitoringAlertRule } from "../../packages/shared/src/monitoring-alerts.js";
import { fixtures, stamp } from "./fixtures.js";

const rule: MonitoringAlertRule = {
  id: "cpu-rule", name: "CPU usage", enabled: false, builtin: false,
  metric: "cyberos_host_cpu_usage_ratio", selector: {}, transform: "value", aggregation: "avg",
  windowSeconds: 300, comparator: ">", triggerThreshold: 0.9, recoveryThreshold: 0.8,
  triggerDurationSeconds: 300, recoveryDurationSeconds: 300, severity: "warning",
  noDataPolicy: "ignore", escalationPolicyId: null, evaluationError: null, lastEvaluatedAt: null,
  revision: 1, deletedAt: null, createdAt: stamp, updatedAt: stamp
};

const copy = {
  en: { rules: "Rules", add: "Add rule", title: "Rule editor", name: "Name", metric: "Metric", selector: "Label selector (JSON)", selectorError: "Selector must be a JSON object.", save: "Save", cancel: "Cancel", close: "Close", edit: "Edit" },
  "zh-CN": { rules: "规则", add: "添加规则", title: "规则编辑器", name: "名称", metric: "指标", selector: "标签 selector（JSON）", selectorError: "Selector 必须是 JSON 对象。", save: "保存", cancel: "取消", close: "关闭", edit: "编辑" }
} as const;

async function openRules(page: Page, locale: keyof typeof copy) {
  await fixtures(page, locale);
  await page.route("**/api/monitoring/alerts/rules", route => route.fulfill({ json: { rules: [rule] } }));
  await page.route("**/api/monitoring/alerts/policies", route => route.fulfill({ json: { policies: [] } }));
  await page.route("**/api/monitoring/catalog", route => route.fulfill({ json: {
    metrics: [{ name: rule.metric, description: "CPU usage", kind: "gauge", unit: "ratio", labelKeys: [] }], series: []
  } }));
  await page.goto(`${process.env.CYBEROS_ALERT_RULE_BASE_URL ?? ""}/#/app/monitoring`);
  await page.getByRole("tab", { name: copy[locale].rules, exact: true }).click();
  await expect(page.getByRole("cell", { name: "CPU usage", exact: false }).first()).toBeVisible();
}

for (const locale of ["en", "zh-CN"] as const) {
  for (const width of [1440, 820, 560, 390, 320]) {
    test(`rule editor is a viewport modal at ${width}px in ${locale}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 560 ? 480 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openRules(page, locale);
      const labels = copy[locale];
      const add = page.getByRole("button", { name: labels.add, exact: true });
      const table = page.locator(".monitoring-alert-table");
      const before = await table.boundingBox();
      await add.click();
      const dialog = page.getByRole("dialog", { name: labels.title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(table).toBeAttached();
      expect(await table.boundingBox()).toEqual(before);
      expect(await dialog.evaluate(element => element.closest(".workspace-pane") === null)).toBe(true);
      await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      const box = await dialog.boundingBox();
      expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(box!.x).toBeGreaterThanOrEqual(9);
      const height = page.viewportSize()!.height;
      expect(Math.abs(box!.y + box!.height / 2 - height / 2)).toBeLessThanOrEqual(1);
      expect(box!.y).toBeGreaterThanOrEqual(9);
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(dialog.getByRole("button", { name: labels.save, exact: true })).toBeInViewport();
      await expect(dialog.getByRole("button", { name: labels.close, exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath("rule-dialog.png") });
      await dialog.getByRole("button", { name: labels.save, exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: labels.close, exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: labels.save, exact: true })).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(add).toBeFocused();
    });
  }
}

test("rule dialog preserves drafts on failure, blocks closing while saving, and updates the list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRules(page, "en");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rule editor", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Memory warning");
  await dialog.getByRole("textbox", { name: "Label selector (JSON)", exact: true }).fill("[]");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Selector must be a JSON object.");
  await dialog.getByRole("textbox", { name: "Label selector (JSON)", exact: true }).fill("{}");
  await page.route("**/api/monitoring/alerts/rules", route => route.fulfill({ status: 500, json: { error: "Save failed" } }));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Save failed");
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Memory warning");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/monitoring/alerts/rules", async route => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ name: "Memory warning", enabled: false, selector: {} });
    await pending;
    await route.fulfill({ json: { rule: { ...rule, ...input, id: "created-rule" } } });
  });
  try {
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.locator(".monitoring-rule-editor-backdrop").click({ position: { x: 1, y: 1 } });
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Memory warning", exact: false })).toBeVisible();
  } finally { release(); }
  const edit = page.getByRole("row").filter({ hasText: "CPU usage" }).getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("CPU usage");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await edit.click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("CPU warning");
  await page.route("**/api/monitoring/alerts/rules/cpu-rule", async route => {
    expect(route.request().method()).toBe("PATCH");
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ expectedRevision: 1, rule: { name: "CPU warning", enabled: false } });
    await route.fulfill({ json: { rule: { ...rule, ...input.rule, revision: 2 } } });
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "CPU warning", exact: false })).toBeVisible();
});
