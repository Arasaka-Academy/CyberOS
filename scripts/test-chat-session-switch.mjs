/**
 * [INPUT]: 依赖聊天页面、隔离路由夹具与 Playwright。
 * [OUTPUT]: 验证会话切换、实时状态与凭据输入交互。
 * [POS]: 聊天浏览器验收入口，不调用真实能力。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

// Reuse the browser installed for the documentation smoke suite.
const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const timestamp = "2026-11-04T00:00:00.000Z";
const sessions = ["a", "b", "c", "empty", "failed", ...Array.from({ length: 24 }, (_, index) => `extra-${index}`)].map((id) => ({
  id, currentPath: ".", createdAt: timestamp, updatedAt: timestamp,
  firstMessage: `Session ${id.toUpperCase()}`, lastMessage: null, pendingApprovalCount: 0,
  activeJob: id === "c" ? { id: "job-c", sessionId: id, messageId: "prompt-c", status: "running" } : null
}));
const streams = new Map();
let server;
let browser;
let baseUrl;

before(async () => {
  await mkdir(new URL("../.cyberos/chat-typewriter/video", import.meta.url), { recursive: true });
  server = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "chat-test-events",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          const path = new URL(request.url, "http://localhost").pathname;
          if (!path.endsWith("/events")) return next();
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          response.write(": connected\n\n");
          const clients = streams.get(path) ?? new Set();
          clients.add(response);
          streams.set(path, clients);
          request.on("close", () => clients.delete(response));
        });
      }
    }]
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  // Compile the initial module graph before measuring browser interactions.
  await server.transformRequest("/src/main.tsx");
  await server.waitForRequestsIdle();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const clients of streams.values()) for (const response of clients) response.end();
  await server?.close();
});

function snapshot(id) {
  return {
    transcript: id === "empty" ? [] : Array.from({ length: 31 }, (_, index) => ({
      id: `${id}-message-${index}`, role: index % 2 ? "assistant" : "user",
      content: `${id.toUpperCase()} message ${index}\n\n${"Persisted conversation. ".repeat(10)}`,
      createdAt: timestamp, sequence: index + 1, turnSequence: Math.floor(index / 2) + 1
    })),
    lastEventId: 40, activeJob: sessions.find((item) => item.id === id)?.activeJob ?? null, liveEvents: []
  };
}

async function openChat(t, { width = 1440, language = "en-US", reducedMotion = "no-preference", holdInitial = false, failure = null, initialApprovals = [], snapshotOverrides = {}, recordVideo = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, locale: language, reducedMotion,
    ...(recordVideo ? { recordVideo: { dir: fileURLToPath(new URL("../.cyberos/chat-typewriter/video", import.meta.url)), size: { width, height: 900 } } } : {})
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const blocks = new Map();
  const failed = new Set();
  const mutations = [];
  const block = (id) => {
    const gate = Promise.withResolvers();
    blocks.set(id, gate);
    return () => { blocks.delete(id); gate.resolve(); };
  };
  t.after(async () => {
    for (const gate of blocks.values()) gate.resolve();
    await context.close();
  });
  const releaseInitial = holdInitial ? block("a") : () => {};
  const fixtures = {
    "/api/system/storage": { storage: { pools: [], drives: [] } },
    "/api/settings/model-provider": { settings: { generation: 1, providerName: "openai", model: "test-model", baseUrl: null, apiKeyConfigured: false, updatedAt: timestamp } },
    "/api/approvals": { capabilityApprovals: [] },
    "/api/operations": { operations: [] },
    "/api/docker/operations": { operations: [] },
    "/api/vms/operations": { operations: [] },
    "/api/files/batches": { batches: [] },
    "/api/notifications": { notifications: [], bluetoothTransfers: [], unreadCount: 0, bluetoothUnreadCount: 0 },
    "/api/notifications/summary": { operations: 0, bluetoothTransfers: 0, alerts: 0 },
    "/api/monitoring/alerts/incidents": { incidents: [] }
  };
  await page.route("**/health", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/events")) return route.continue();
    if (route.request().method() !== "GET") mutations.push(path);
    let body = fixtures[path];
    let status = body ? 200 : 503;
    if (path === "/api/approvals") body = { capabilityApprovals: url.searchParams.get("sessionId") === "a" ? initialApprovals : [] };
    if (path === "/api/sessions") {
      body = failure === "sessions" ? { error: "Initial sessions failed" } : { sessions };
      status = failure === "sessions" ? 503 : 200;
      if (route.request().method() === "POST") {
        const gate = blocks.get("create");
        if (gate) await gate.promise;
        body = { session: { ...sessions[0], id: "created", firstMessage: null } };
        status = 201;
      }
    }
    const transcriptMatch = /^\/api\/sessions\/([^/]+)\/transcript$/u.exec(path);
    if (transcriptMatch) {
      const id = transcriptMatch[1];
      const gate = blocks.get(id);
      if (gate) await gate.promise;
      status = failed.has(id) || failure === "transcript" ? 503 : 200;
      body = status === 200 ? { ...snapshot(id), ...snapshotOverrides[id] } : { error: "Transcript request failed" };
    }
    if (path === "/api/settings/model-provider" && failure === "model") {
      status = 503;
      body = { error: "Model settings unavailable" };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body ?? { error: "Unavailable in chat fixture" }) });
  });
  await page.goto(`${baseUrl}#/app/agent`);
  return { page, block, failed, mutations, errors, releaseInitial, compact: width <= 1040 };
}

async function ready(page) {
  await expect(page.locator(".composer textarea")).toBeVisible();
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "false");
}

function emitChatEvent(id, type, content, runId = "typing-run") {
  const event = {
    schemaVersion: 1, id, sessionId: "a", jobId: "job-a", type, audience: "chat",
    transcriptSequence: type === "agent.message" ? id : null, transcriptTurnSequence: 31,
    source: "pi", sourceId: `${runId}:${id}`, runId, sequence: id,
    payload: { role: "assistant", content, jobId: "job-a" }, createdAt: timestamp
  };
  for (const response of streams.get("/api/sessions/a/events") ?? []) {
    response.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}

test("full access restores automatic execution as running after reload", async t => {
  const { page, errors } = await openChat(t, { snapshotOverrides: {
    a: { activeJob: { id: "job-a", sessionId: "a", messageId: "prompt-a", status: "waiting_approval", capabilityInteraction: "automatic" } }
  } });
  await ready(page);
  await expect(page.locator('.composer-status[data-state="running"]')).toBeVisible();
  await expect(page.locator(".approval-card")).toHaveCount(0);
  assert.deepEqual(errors, []);
});

test("full access requests credentials without an approval confirmation", async t => {
  for (const width of [1440, 390]) await t.test(`${width}px`, async child => {
    const approval = {
      id: "input-a", runId: "run-a", sessionId: "a", jobId: "job-a", status: "pending",
      proposal: { summary: "Connect service", requiredSecrets: [{ name: "apiKey", label: "API key" }] },
      interaction: "input_required", risk: "high", revision: 1, requiresConfirmation: false,
      expiresAt: "2099-11-05T00:00:00.000Z", createdAt: timestamp, updatedAt: timestamp,
      client: null,
      run: { id: "run-a", capabilityId: "cyberos.settings.update-propose", state: "waiting_approval",
        subjectId: "a", subjectKind: "pi", input: {}, revision: 1, createdAt: timestamp }
    };
    const { page, errors } = await openChat(child, { width, initialApprovals: [approval] });
    let submitted;
    await page.route("**/api/capability-approvals/input-a/input", async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { run: { state: "succeeded" } } });
    });
    await ready(page);
    await page.locator(".approval-approve").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await dialog.getByLabel("API key").fill("browser-test-value");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect.poll(() => submitted?.sessionId).toBe("a");
    assert.equal(submitted.expectedRevision, 1);
    assert.equal(submitted.decision, undefined);
    assert.equal(submitted.confirmed, undefined);
    assert.deepEqual(errors, []);
  });
});

test("live text types progressively and keeps its DOM identity when persisted", async (t) => {
  const { page, errors } = await openChat(t);
  await ready(page);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => {
    globalThis.typingFrames = [];
    const transcript = globalThis.document.querySelector(".transcript-content");
    new globalThis.MutationObserver(() => {
      const message = transcript.querySelector(".message:last-child .message-markdown");
      if (message) globalThis.typingFrames.push(message.textContent);
    }).observe(transcript, { subtree: true, childList: true, characterData: true });
  });
  const content = "逐字显示中文、English 和 👩🏽‍💻。".repeat(16);
  emitChatEvent(41, "message_update", content);
  await expect(page.locator(".transcript .message").last().locator(".message-markdown")).toHaveText(content);
  assert.equal(await page.evaluate((full) => globalThis.typingFrames.some((text) => text.length > 0 && text.length < full.length), content), true);
  await expect(page.locator(".text-type-cursor")).toBeVisible();
  await page.locator(".transcript .message").last().evaluate((element) => { globalThis.typingMessage = element; });
  emitChatEvent(42, "message_end", content);
  emitChatEvent(43, "agent.message", content, "pi-entry:typing-reply");
  await expect(page.locator(".text-type-cursor")).toHaveCount(0);
  assert.equal(await page.locator(".transcript .message").last().evaluate((element) => element === globalThis.typingMessage), true);
  assert.deepEqual(errors, []);
});

test("a completed burst catches up within 250ms without replaying or breaking Markdown", async (t) => {
  const { page, errors } = await openChat(t);
  await ready(page);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  const content = `## 流式回复\n\n${"中文与 English 👩🏽‍💻 é 🇨🇳。".repeat(100)}\n\n- 第一项\n- [链接](https://example.com/)\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``;
  emitChatEvent(41, "message_update", content);
  await expect(page.locator(".text-type-cursor")).toBeVisible();
  await page.evaluate(() => {
    globalThis.typingCompletion = { start: null, end: null };
    const observer = new globalThis.MutationObserver(() => {
      const message = globalThis.document.querySelector(".transcript .message:last-child");
      if (!message || message.classList.contains("is-streaming")) return;
      const now = globalThis.performance.now();
      globalThis.typingCompletion.start ??= now;
      if (!message.querySelector(".text-type-cursor")) {
        globalThis.typingCompletion.end = now;
        observer.disconnect();
      }
    });
    observer.observe(globalThis.document.querySelector(".transcript-content"), { attributes: true, subtree: true, childList: true, characterData: true });
  });
  emitChatEvent(42, "message_end", content);
  emitChatEvent(43, "agent.message", content, "pi-entry:typing-reply");
  await page.waitForFunction(() => !globalThis.document.querySelector(".text-type-cursor"), { polling: "raf" });
  // Measure DOM commits in the browser, excluding Playwright transport/polling delays.
  const elapsed = await page.evaluate(() => globalThis.typingCompletion.end - globalThis.typingCompletion.start);
  assert.ok(elapsed < 250, `animation completion took ${elapsed}ms (250ms including frame scheduling)`);
  const message = page.locator(".transcript .message").last();
  await expect(message.locator("h2")).toHaveText("流式回复");
  await expect(message.locator("li")).toHaveCount(2);
  await expect(message.locator("a")).toHaveAttribute("href", "https://example.com/");
  await expect(message.locator("code.hljs")).toHaveText("const answer = 42;");
  await expect(message.locator('[role="status"]')).toHaveText(content);
  assert.deepEqual(errors, []);
});

test("hydrated live text is immediate and only subsequent additions animate", async (t) => {
  const restored = {
    schemaVersion: 1, id: 40, sessionId: "a", jobId: "job-a", type: "message_update", audience: "chat",
    transcriptSequence: null, transcriptTurnSequence: 31, source: "pi", sourceId: "typing-run:40",
    runId: "typing-run", sequence: 40, payload: { role: "assistant", content: "恢复的已有内容" }, createdAt: timestamp
  };
  const { page } = await openChat(t, { snapshotOverrides: { a: { liveEvents: [restored] } } });
  await ready(page);
  const message = page.locator(".transcript .message").last().locator(".message-markdown");
  await expect(message).toHaveText("恢复的已有内容");
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  emitChatEvent(41, "message_update", `恢复的已有内容${"继续回答。".repeat(50)}`);
  await expect(message).toContainText("恢复的已有内容");
  await select({ page, compact: false }, "b");
  await expect(page.locator(".text-type-cursor")).toHaveCount(0);
  await select({ page, compact: false }, "a");
  await expect(page.locator(".transcript .message").last().locator(".message-markdown")).toHaveText("恢复的已有内容");
});

for (const terminal of ["job.cancelled", "job.failed", "job.completed"]) {
  test(`${terminal} flushes received text and removes the cursor immediately`, async (t) => {
    const { page } = await openChat(t, { snapshotOverrides: { a: { activeJob: { ...sessions.find((item) => item.id === "c").activeJob, id: "job-a", sessionId: "a" } } } });
    await ready(page);
    await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
    const content = "中断时保留已收到的所有文字。".repeat(300);
    emitChatEvent(41, "message_update", content);
    await expect(page.locator(".text-type-cursor")).toBeVisible();
    emitChatEvent(42, terminal, "");
    await expect(page.locator(".text-type-cursor")).toHaveCount(0);
    await expect(page.locator(".transcript .message-markdown").last()).toHaveText(content);
  });
}

test("reduced motion and returning to the foreground flush the animation backlog", async (t) => {
  const { page } = await openChat(t);
  await ready(page);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  const content = "无需重新播放积压的内容。".repeat(300);
  emitChatEvent(41, "message_update", content);
  await expect(page.locator(".text-type-cursor")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".text-type-cursor")).toHaveCount(0);
  await expect(page.locator(".transcript .message-markdown").last()).toHaveText(content);
  await expect(page.locator(".text-type [role=status]")).toBeEmpty();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".text-type-cursor")).toBeVisible();
  const more = content + "新增内容".repeat(200);
  emitChatEvent(42, "message_update", more);
  await page.waitForFunction((length) => globalThis.document.querySelector(".transcript .message:last-child .message-markdown").textContent.length > length, content.length);
  const foregroundFlushMs = await page.evaluate((full) => new Promise((resolve) => {
    const started = globalThis.performance.now();
    const message = globalThis.document.querySelector(".transcript .message:last-child .message-markdown");
    const observer = new globalThis.MutationObserver(() => {
      if (message.textContent !== full) return;
      observer.disconnect();
      globalThis.clearTimeout(timeout);
      resolve(globalThis.performance.now() - started);
    });
    const timeout = globalThis.setTimeout(() => {
      observer.disconnect();
      resolve(Infinity);
    }, 1000);
    observer.observe(message, { childList: true, subtree: true, characterData: true });
    globalThis.document.dispatchEvent(new globalThis.Event("visibilitychange"));
  }), more);
  assert.ok(foregroundFlushMs < 100, `foreground flush took ${foregroundFlushMs}ms`);
  await expect(page.locator(".text-type [role=status]")).toBeEmpty();
  await page.emulateMedia({ reducedMotion: "reduce" });
  emitChatEvent(43, "message_end", more);
  await expect(page.locator(".text-type [role=status]")).toHaveText(more);
});

test("reduced motion shows code immediately but defers highlighting and reader announcements until completion", async (t) => {
  const { page, errors } = await openChat(t, { reducedMotion: "reduce" });
  await ready(page);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  const content = "```js\nconst greeting = '你好 👩🏽‍💻';\n```";
  emitChatEvent(41, "message_update", content);
  const message = page.locator(".transcript .message").last();
  await expect(message.locator("pre code")).toHaveText("const greeting = '你好 👩🏽‍💻';");
  await expect(message.locator(".text-type-cursor")).toHaveCount(0);
  await expect(message.locator("code.hljs")).toHaveCount(0);
  await expect(message.locator("[role=status]")).toBeEmpty();
  emitChatEvent(42, "message_end", content);
  await expect(message.locator("code.hljs")).toHaveText("const greeting = '你好 👩🏽‍💻';");
  await expect(message.locator("[role=status]")).toHaveText(content);
  assert.deepEqual(errors, []);
});

for (const width of [1440, 820, 560, 390, 320]) {
  test(`typewriter caret, themes and reader position remain stable at ${width}px`, async (t) => {
    const { page, errors } = await openChat(t, { width, language: "zh-CN" });
    await ready(page);
    await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
    const content = `## 回复示例\n\n${"中文与 English 👩🏽‍💻 é 🇨🇳 混合换行。".repeat(18)}\n\n- 保持 Markdown 列表\n- [链接](https://example.com/)\n\n尾部光标`;
    emitChatEvent(41, "message_update", content);
    await expect(page.locator(".transcript .message").last().locator("p").last()).toHaveText("尾部光标");
    await expect(page.locator(".text-type-cursor")).toHaveAttribute("data-waiting", "true");
    for (const mode of ["dark", "light"]) {
      for (const scheme of (width === 1440 ? ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"] : ["neon"])) {
        await page.evaluate(({ scheme, mode }) => {
          globalThis.localStorage.setItem("cyberos:appearance:v1", JSON.stringify({ scheme, mode }));
          globalThis.window.dispatchEvent(new globalThis.StorageEvent("storage", { key: "cyberos:appearance:v1" }));
        }, { scheme, mode });
        await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
        const measured = await page.locator(".text-type").evaluate((element) => {
          const caret = element.querySelector(".text-type-cursor");
          const paragraph = element.querySelector(".message-markdown > p:last-child");
          const range = globalThis.document.createRange();
          range.selectNodeContents(paragraph);
          const end = range.getClientRects()[range.getClientRects().length - 1];
          const rect = caret.getBoundingClientRect();
          return {
            dx: Math.abs(rect.left - end.right), dy: Math.abs(rect.top - end.top),
            width: rect.width, height: rect.height,
            sameColor: globalThis.getComputedStyle(caret).backgroundColor === globalThis.getComputedStyle(paragraph).color,
            overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth
          };
        });
        assert.ok(measured.dx <= 3 && measured.dy <= 2, JSON.stringify(measured));
        assert.equal(measured.width, 2);
        assert.ok(measured.height > 0);
        assert.equal(measured.sameColor, true);
        assert.equal(measured.overflow, false);
      }
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: fileURLToPath(new URL(`../.cyberos/chat-typewriter/${width}-${mode}.png`, import.meta.url)) });
      }
    }
    await page.locator(".transcript").evaluate((element) => { element.scrollTop = 220; });
    emitChatEvent(42, "message_update", `${content}\n\n${"新增内容不打断阅读。".repeat(100)}`);
    await page.waitForFunction(() => globalThis.document.querySelector(".text-type-cursor")?.dataset.waiting === "false");
    assert.equal(await page.locator(".transcript").evaluate((element) => element.scrollTop), 220);
    assert.deepEqual(errors, []);
  });
}

test("records the live typewriter and a second reply in the same run", async (t) => {
  const { page, errors } = await openChat(t, { width: 1440, language: "zh-CN", recordVideo: true });
  await ready(page);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  const text = "## 光标打字机\n\n现在逐字显示新回复，中文、English 和 👩🏽‍💻 都保持完整。\n\n- 模型输出较快时自动追赶\n- 历史记录直接显示\n\n正在等待下一段内容。";
  let id = 41;
  const graphemes = Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
  for (let count = 6; count < graphemes.length + 6; count += 6) {
    emitChatEvent(id++, "message_update", graphemes.slice(0, count).join(""));
    await page.waitForTimeout(90);
  }
  emitChatEvent(id++, "message_end", text);
  emitChatEvent(id++, "agent.message", text, "pi-entry:demo-first");
  await expect(page.locator(".text-type-cursor")).toHaveCount(0);
  const second = "同一次运行中的下一条回复，会从自己的第一个字开始。";
  emitChatEvent(id++, "message_start", "");
  emitChatEvent(id++, "message_update", second);
  await expect(page.locator(".transcript .message").last().locator(".message-markdown")).toHaveText(second);
  emitChatEvent(id++, "message_end", second);
  emitChatEvent(id++, "agent.message", second, "pi-entry:demo-second");
  await expect(page.locator(".text-type-cursor")).toHaveCount(0);
  await expect(page.locator(".transcript .message").nth(31).locator("h2")).toHaveText("光标打字机");
  assert.deepEqual(errors, []);
  const video = page.video();
  await page.close();
  await video.saveAs(fileURLToPath(new URL("../.cyberos/chat-typewriter/chat-typewriter-demo.webm", import.meta.url)));
});

async function select(chat, id, { preserveFocus = false } = {}) {
  const { page, compact } = chat;
  if (compact) await page.locator(".chat-header .panel-header-action").first().click();
  const button = page.locator(compact ? ".mobile-sessions-dialog .session-item" : ".agent-list .session-item")
    .nth(sessions.findIndex((item) => item.id === id));
  if (preserveFocus) await button.evaluate((element) => element.click());
  else await button.click();
}

async function rememberShell(page) {
  await page.evaluate(() => {
    globalThis.chatShell = Object.fromEntries([".chat-pane", ".agent-list", ".session-list", ".agent-footer", ".chat-main", ".chat-header", ".composer", ".composer textarea"]
      .map((selector) => [selector, globalThis.document.querySelector(selector)]));
  });
}

async function assertSameShell(page) {
  assert.deepEqual(await page.evaluate(() => Object.entries(globalThis.chatShell)
    .filter(([selector, element]) => globalThis.document.querySelector(selector) !== element)
    .map(([selector]) => selector)), [], "session loading replaced persistent shell nodes");
}

for (const options of [
  { width: 1440, language: "en-US", reducedMotion: "no-preference" },
  { width: 1440, language: "zh-CN", reducedMotion: "reduce" },
  { width: 820, language: "zh-CN", reducedMotion: "no-preference" },
  { width: 560, language: "en-US", reducedMotion: "reduce" },
  { width: 390, language: "zh-CN", reducedMotion: "reduce" },
  { width: 320, language: "en-US", reducedMotion: "no-preference" }
]) {
  test(`${options.width}px ${options.language} ${options.reducedMotion}: switch only the transcript`, async (t) => {
    const chat = await openChat(t, { ...options, holdInitial: true });
    const { page } = chat;
    await expect(page.locator(".chat-pane.chat-loading")).toBeVisible();
    assert.equal(await page.locator("textarea").count(), 0);
    chat.releaseInitial();
    await ready(page);
    await page.locator(".composer textarea").fill("Preserved draft 草稿");
    await rememberShell(page);
    const releaseB = chat.block("b");
    await select(chat, "b", { preserveFocus: !chat.compact });
    await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "true");
    await assertSameShell(page);
    await expect(page.locator(".chat-header")).toContainText("Session B");
    await expect(page.locator(".transcript-skeleton")).toBeVisible();
    await expect(page.locator(".transcript .message")).toHaveCount(0);
    await expect(page.locator(".composer textarea")).toHaveValue("Preserved draft 草稿");
    await expect(page.locator(".composer button[type=submit]")).toBeDisabled();
    if (!chat.compact) await expect(page.locator(".composer textarea")).toBeFocused();
    await page.locator(".composer textarea").fill("Edited while loading");
    await page.locator(".composer textarea").press("Enter");
    assert.deepEqual(chat.mutations, [], "loading allowed a message to be submitted");
    if (options.width === 1440 && options.language === "en-US") {
      const directory = fileURLToPath(new URL("../.cyberos/chat-browser/", import.meta.url));
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: `${directory}/switch-loading.png` });
    }
    releaseB();
    await ready(page);
    await assertSameShell(page);
    await expect(page.locator(".transcript")).toContainText("B message 30");
    await expect(page.locator(".composer textarea")).toHaveValue("Edited while loading");
    await expect(page.locator(".composer button[type=submit]")).toBeEnabled();
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
    assert.deepEqual(chat.errors, []);
  });
}

test("rapid A to B to C ignores late history, restores running controls and reading positions", async (t) => {
  const chat = await openChat(t);
  const { page } = chat;
  await ready(page);
  await page.locator(".transcript").evaluate((element) => { element.scrollTop = 220; });
  await expect.poll(() => page.locator(".transcript").evaluate((element) => element.scrollTop)).toBe(220);
  // Allow the scroll listener to persist the reader's position before switching.
  await page.waitForFunction(() => globalThis.document.querySelector(".transcript").scrollTop === 220);
  const releaseB = chat.block("b");
  await select(chat, "b");
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "true");
  await select(chat, "c");
  await ready(page);
  await expect(page.locator(".transcript")).toContainText("C message 30");
  await expect(page.locator(".composer-delivery")).toBeVisible();
  const lateB = page.waitForResponse("**/api/sessions/b/transcript");
  releaseB();
  await lateB;
  await expect(page.locator(".chat-header")).toContainText("Session C");
  await expect(page.locator(".transcript")).not.toContainText("B message 30");
  await select(chat, "a");
  await ready(page);
  await expect.poll(() => page.locator(".transcript").evaluate((element) => element.scrollTop)).toBe(220);
  await page.waitForFunction(() => [...globalThis.document.querySelectorAll(".message")].at(-1)?.textContent.includes("A message 30"));
  await expect.poll(() => page.locator(".transcript").evaluate((element) => element.scrollTop)).toBe(220);
  assert.deepEqual(chat.errors, []);
});

test("keyboard switching preserves sidebar scroll and focus", async (t) => {
  const chat = await openChat(t);
  const { page } = chat;
  await ready(page);
  const sidebarTop = await page.locator(".session-list").evaluate((element) => {
    element.scrollTop = 120;
    return element.scrollTop;
  });
  assert.ok(sidebarTop > 0, "fixture must have a scrollable session list");
  const target = page.locator(".agent-list .session-item").nth(1);
  await target.evaluate((element) => element.focus({ preventScroll: true }));
  const releaseB = chat.block("b");
  await page.keyboard.press("Enter");
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "true");
  await expect(target).toBeFocused();
  assert.equal(await page.locator(".session-list").evaluate((element) => element.scrollTop), sidebarTop);
  await expect(page.locator(".agent-settings-button:not(.agent-playback-button)")).toBeEnabled();
  await expect(page.locator(".agent-playback-button")).toBeEnabled();
  await expect(page.locator(".agent-notification-button")).toBeEnabled();
  releaseB();
  await ready(page);
  await expect(target).toBeFocused();
  assert.equal(await page.locator(".session-list").evaluate((element) => element.scrollTop), sidebarTop);
});

test("a late new-session response cannot replace a subsequently selected session", async (t) => {
  const chat = await openChat(t);
  const { page } = chat;
  await ready(page);
  const releaseCreate = chat.block("create");
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/sessions" && response.request().method() === "POST");
  await page.locator(".agent-list-head button").click();
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "true");
  await select(chat, "b");
  await ready(page);
  releaseCreate();
  await created;
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  await expect(page.locator(".chat-header")).toContainText("Session B");
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".transcript")).toContainText("B message 30");
});

test("live messages preserve historical reading and follow the end when requested", async (t) => {
  const { page, errors } = await openChat(t);
  await ready(page);
  const transcript = page.locator(".transcript");
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await transcript.evaluate((element) => { element.scrollTop = 220; });
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  const path = "/api/sessions/a/events";
  await expect.poll(() => streams.get(path)?.size ?? 0).toBe(1);
  const emit = (id) => {
    const event = {
      id, sessionId: "a", runId: "run-a", type: "agent.message", audience: "chat", createdAt: timestamp,
      transcriptSequence: id, transcriptTurnSequence: 17,
      payload: { role: "assistant", content: `Live message ${id}\n\n${"New live content. ".repeat(30)}` }
    };
    for (const response of streams.get(path)) response.write(`id: ${id}\nevent: agent.message\ndata: ${JSON.stringify(event)}\n\n`);
  };
  emit(41);
  await expect(transcript).toContainText("Live message 41");
  assert.equal(await transcript.evaluate((element) => element.scrollTop), 220);
  await transcript.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  emit(42);
  await expect(transcript).toContainText("Live message 42");
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  assert.deepEqual(errors, []);
});

test("a session switch clears old deletion and approval confirmations", async (t) => {
  const approval = {
    id: "approval-a", runId: "run-a", sessionId: "a", jobId: "job-a", status: "pending",
    proposal: { summary: "Old session action" }, risk: "high", revision: 1, requiresConfirmation: true,
    expiresAt: "2026-11-05T00:00:00.000Z", createdAt: timestamp, updatedAt: timestamp, client: null,
    run: { id: "run-a", capabilityId: "cyberos.files.mutate", state: "waiting_approval", subjectId: "a", subjectKind: "agent", input: {}, revision: 1, createdAt: timestamp }
  };
  const chat = await openChat(t, { initialApprovals: [approval] });
  const { page } = chat;
  await ready(page);
  await page.locator(".approval-approve").click();
  await expect(page.locator("#approval-secret-title")).toBeVisible();
  await select(chat, "b", { preserveFocus: true });
  await ready(page);
  await expect(page.locator("#approval-secret-title")).toHaveCount(0);
  await page.locator(".chat-delete-session-button").click();
  await expect(page.locator(".session-delete-dialog")).toBeVisible();
  await select(chat, "empty", { preserveFocus: true });
  await ready(page);
  await expect(page.locator(".session-delete-dialog")).toHaveCount(0);
  assert.deepEqual(chat.mutations, []);
  assert.deepEqual(chat.errors, []);
});

test("empty history, failures and subsequent switches keep the shell usable", async (t) => {
  const chat = await openChat(t);
  const { page } = chat;
  await ready(page);
  await rememberShell(page);
  chat.failed.add("failed");
  await select(chat, "failed");
  await ready(page);
  await assertSameShell(page);
  await expect(page.locator(".transcript-skeleton")).toHaveCount(0);
  await expect(page.locator(".transcript .empty-state")).toHaveCount(0);
  await expect(page.locator(".app-notification[data-tone=error]")).toContainText("Transcript request failed");
  await select(chat, "empty");
  await ready(page);
  await expect(page.locator(".transcript .empty-state")).toBeVisible();
  await select(chat, "b");
  await ready(page);
  await expect(page.locator(".transcript")).toContainText("B message 30");
  await assertSameShell(page);
  assert.deepEqual(chat.errors, []);
});

for (const language of ["en-US", "zh-CN"]) {
  test(`empty history stays centred in the transcript at every width (${language})`, async (t) => {
    const chat = await openChat(t, { language });
    const { page } = chat;
    await ready(page);
    await select(chat, "empty");
    await ready(page);
    const empty = page.locator(".transcript .empty-state");
    for (const width of [1920, 1440, 1280, 820, 560, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(empty).toBeVisible();
      await page.evaluate(() => globalThis.document.fonts.ready);
      const geometry = await empty.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const transcript = element.closest(".transcript");
        const area = transcript.getBoundingClientRect();
        return {
          offsetX: bounds.x + bounds.width / 2 - area.x - area.width / 2,
          offsetY: bounds.y + bounds.height / 2 - area.y - area.height / 2,
          overflowX: transcript.scrollWidth - transcript.clientWidth,
          overflowY: transcript.scrollHeight - transcript.clientHeight
        };
      });
      if (width === 1440 || width === 390) {
        const directory = fileURLToPath(new URL("../.cyberos/chat-browser/", import.meta.url));
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/empty-${language}-${width}.png` });
      }
      assert.ok(Math.abs(geometry.offsetX) <= 1, `${width}px horizontal centring: ${JSON.stringify(geometry)}`);
      assert.ok(Math.abs(geometry.offsetY) <= 1, `${width}px vertical centring: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.overflowX <= 1 && geometry.overflowY <= 1, `${width}px empty history overflowed: ${JSON.stringify(geometry)}`);
    }
    assert.deepEqual(chat.errors, []);
  });
}

for (const failure of ["sessions", "transcript", "model"]) {
  test(`initial ${failure} failure exits the full skeleton`, async (t) => {
    const { page, errors } = await openChat(t, { failure });
    await ready(page);
    await expect(page.locator(".chat-pane.chat-loading")).toHaveCount(0);
    assert.deepEqual(errors, []);
  });
}
