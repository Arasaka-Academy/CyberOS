/**
 * [INPUT]: 依赖聊天浏览器夹具、事件流与 Playwright 断言。
 * [OUTPUT]: 注册工具摘要、筛选、终态和轮次验收。
 * [POS]: 聊天验收子集；只发送隔离夹具事件。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

export function registerToolActivityTests({ openChat, ready, select, emitChatEvent, streams, timestamp, expect }) {
  function toolEvent(index, overrides = {}) {
    return {
      schemaVersion: 1, id: 41 + index, sessionId: "a", jobId: "job-a", type: "tool_execution_end", audience: "chat",
      transcriptSequence: null, transcriptTurnSequence: 31, source: "pi", sourceId: `tools:${index}`,
      runId: "run-tools", sequence: 41 + index, createdAt: timestamp,
      payload: { id: `tool-${index}`, name: ["codemode", "mcp_cyberos_files_list", "mcp_cyberos_docker_get", "mcp_cyberos_docker_manage_propose"][index % 4], isError: [0, 4, 7, 11, 15].includes(index) },
      ...overrides
    };
  }

  for (const language of ["en-US", "zh-CN"]) {
    test(`tool activity stays compact and expands into recent calls and failure filters (${language})`, async t => {
      const { page, errors, mutations } = await openChat(t, { language, snapshotOverrides: {
        a: { liveEvents: Array.from({ length: 16 }, (_, index) => toolEvent(index)) }
      } });
      await ready(page);
      const log = page.locator("details.agent-tool-activity");
      const summary = log.locator("summary");
      await expect(log).toHaveCount(1);
      await expect(log).not.toHaveAttribute("open", "");
      await expect(summary).toContainText(language === "zh-CN" ? "16 次调用" : "16 calls");
      await expect(summary).toContainText(language === "zh-CN" ? "5 次失败" : "5 failed");
      assert.ok((await log.boundingBox()).height <= 50, "collapsed tools should occupy one compact row");
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(log.locator("li")).toHaveCount(6);
      await expect(log.locator("li").first()).toContainText(language === "zh-CN" ? "Docker 信息" : "Docker info");
      await expect(log.locator("li").first().locator("[data-tooltip]")).toHaveAttribute("data-tooltip", "mcp_cyberos_docker_get");
      const all = log.getByRole("button", { name: language === "zh-CN" ? "查看全部（16）" : "Show all (16)", exact: true });
      await all.click();
      await expect(log.locator("li")).toHaveCount(16);
      await log.getByRole("button", { name: language === "zh-CN" ? "仅看失败" : "Failures only", exact: true }).click();
      await expect(log.locator("li")).toHaveCount(5);
      await expect(log.locator('li:not([data-state="failed"])')).toHaveCount(0);
      await log.getByRole("button", { name: language === "zh-CN" ? "仅看失败" : "Failures only", exact: true }).click();
      await expect(log.locator("li")).toHaveCount(6);
      for (const width of [1440, 820, 560, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await summary.scrollIntoViewIfNeeded();
        assert.ok(await log.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}px log overflow`);
        assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1), `${width}px page overflow`);
        assert.ok((await summary.boundingBox()).height >= 44, "summary must retain its touch target");
        assert.equal(await summary.evaluate(element => globalThis.getComputedStyle(element).borderRadius), "0px");
        if (width === 1440 || width === 390) {
          await mkdir(new URL("../.cyberos/chat-tools/", import.meta.url), { recursive: true });
          await page.screenshot({ path: fileURLToPath(new URL(`../.cyberos/chat-tools/expanded-${language}-${width}.png`, import.meta.url)) });
          await summary.click();
          await page.screenshot({ path: fileURLToPath(new URL(`../.cyberos/chat-tools/collapsed-${language}-${width}.png`, import.meta.url)) });
          await summary.click();
        }
      }
      await select({ page, compact: true }, "b");
      await ready(page);
      await expect(page.locator(".agent-tool-activity")).toHaveCount(0);
      assert.deepEqual(errors, []);
      assert.deepEqual(mutations, []);
    });
  }

  for (const terminal of ["job.completed", "job.failed", "job.cancelled"]) test(`tool activity keeps its summary after ${terminal} without moving historical reading`, async t => {
    const { page, errors } = await openChat(t, { reducedMotion: "reduce", snapshotOverrides: {
      a: { liveEvents: [toolEvent(0)], activeJob: { id: "job-a", sessionId: "a", status: "running" } }
    } });
    await ready(page);
    const log = page.locator("details.agent-tool-activity");
    await expect(log).toHaveCount(1);
    const transcript = page.locator(".transcript");
    await transcript.evaluate(element => { element.scrollTop = 220; });
    await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
    await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
    const event = toolEvent(1, { type: "tool_execution_start", payload: { id: "tool-1", name: "mcp_cyberos_files_list" } });
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    await expect(log.locator("summary")).toContainText("Running: File list");
    await expect(log).not.toHaveAttribute("open", "");
    assert.equal(await transcript.evaluate(element => element.scrollTop), 220);
    await log.locator("summary").evaluate(element => element.focus({ preventScroll: true }));
    await expect(page.getByRole("tooltip")).toContainText("mcp_cyberos_files_list");
    await page.keyboard.press("Escape");
    const end = toolEvent(2, { payload: { id: "tool-1", name: "mcp_cyberos_files_list", isError: false } });
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${end.id}\nevent: ${end.type}\ndata: ${JSON.stringify(end)}\n\n`);
    await expect(log.locator("summary")).toContainText("Execution log");
    await expect(log.locator("summary")).toContainText("2 calls");
    assert.equal(await transcript.evaluate(element => element.scrollTop), 220);
    const pending = toolEvent(3, { type: "tool_execution_start", payload: { id: "tool-3", name: "mcp_vendor_a_very_long_tool_name_".repeat(5) } });
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${pending.id}\nevent: ${pending.type}\ndata: ${JSON.stringify(pending)}\n\n`);
    await expect(log.locator("summary")).toContainText("Running:");
    emitChatEvent(45, terminal, "");
    await expect(log.locator("summary")).toContainText("Execution log");
    await expect(log.locator("summary")).toContainText("3 calls");
    await expect(log.locator("summary")).toContainText("2 failed");
    await expect(log).not.toHaveAttribute("open", "");
    await log.locator("summary").click();
    await log.getByRole("button", { name: "Failures only", exact: true }).click();
    const acknowledge = Promise.withResolvers();
    const requested = Promise.withResolvers();
    t.after(() => acknowledge.resolve());
    await page.route("**/api/sessions/a/messages", async route => {
      requested.resolve();
      await acknowledge.promise;
      await route.fulfill({ json: {
        job: { id: "job-next", sessionId: "a", status: "queued" },
        transcriptMessage: { id: "next-prompt", role: "user", content: "Next turn", createdAt: timestamp, sequence: 32, turnSequence: 32 }
      } });
    });
    await page.locator(".composer textarea").fill("Next turn");
    await page.locator('.composer button[type="submit"]').click();
    await requested.promise;
    const nextJob = toolEvent(7, { type: "job.running", jobId: "job-next", payload: { jobId: "job-next" } });
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${nextJob.id}\nevent: ${nextJob.type}\ndata: ${JSON.stringify(nextJob)}\n\n`);
    await expect(log).toHaveCount(0);
    const nextTool = toolEvent(8, { jobId: "job-next", runId: "run-next", payload: { id: "next-tool", name: "codemode", isError: true } });
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${nextTool.id}\nevent: ${nextTool.type}\ndata: ${JSON.stringify(nextTool)}\n\n`);
    await expect(log.locator("summary")).toContainText("1 call");
    await expect(log).not.toHaveAttribute("open", "");
    await log.locator("summary").click();
    await expect(log.getByRole("button", { name: "Failures only", exact: true })).toHaveAttribute("aria-pressed", "false");
    const done = { ...nextJob, id: 50, type: terminal };
    for (const response of streams.get("/api/sessions/a/events")) response.write(`id: ${done.id}\nevent: ${done.type}\ndata: ${JSON.stringify(done)}\n\n`);
    await expect(page.locator('.composer-status[data-state="running"]')).toHaveCount(0);
    acknowledge.resolve();
    await expect(page.locator(".composer")).toHaveAttribute("aria-busy", "false");
    await expect(log.locator("summary")).toContainText("1 call");
    assert.deepEqual(errors, []);
  });
}
