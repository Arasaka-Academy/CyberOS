import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const repository = fileURLToPath(new URL("../", import.meta.url));
const source = process.env.CARD_SOURCE_ROOT ?? repository;
const baseline = process.env.CARD_PHASE === "before";
const cacheName = baseline ? ".vite-card-surfaces-before" : ".vite-card-surfaces";
const output = process.env.CARD_OUTPUT_DIR ?? path.join(repository, ".cyberos/browser-card-surfaces", baseline ? "before" : "after");
const { chromium } = createRequire(new URL("../docs/package.json", import.meta.url))("playwright");
const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];
const records = [];
let server, browser, baseUrl;
before(async () => {
  await mkdir(output, { recursive: true });
  server = await createServer({
    root: path.join(source, "packages/web"), configFile: path.join(source, "packages/web/vite.config.ts"),
    cacheDir: path.join(source, "packages/web/node_modules", cacheName),
    resolve: { alias: [{ find: /^@cyberos\/ui$/, replacement: path.join(source, "packages/ui/src/index.ts") }] },
    optimizeDeps: { include: ["react", "react-dom/client"] },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repository] } }
  });
  await server.listen(); baseUrl = server.resolvedUrls.local[0]; browser = await chromium.launch();
});
after(async () => {
  await browser?.close(); await server?.close();
  await writeFile(path.join(output, "results.json"), JSON.stringify(records, null, 2));
});

const example = (name, classes, content = "<strong>128 GiB / 项目资料</strong><p>中文与 English · Ready</p>", role = "soft") =>
  `<article data-card-example="${name}" data-surface="${role}" class="${classes}">${content}</article>`;
const sectionNames = ["docker-container-detail-section", "network-interface-detail-section", "network-interface-flags", "storage-disk-detail-section", "storage-pool-members", "monitoring-incident-detail-section"];
const summaryNames = ["network-interface-overview", "storage-disk-capacity-overview", "storage-pool-details-overview", "system-wifi-device-summary", "docker-container-detail-stat", "docker-pressure-stat"];

async function fixture(context, { tv = false, locale = "en" } = {}) {
  const page = await browser.newPage({ reducedMotion: "reduce" }); context.after(() => page.close());
  const errors = []; page.on("pageerror", error => { errors.push(error.message); globalThis.console.error(error.message); });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "Read-only visual fixture" } }));
  const markup = tv ? [
    example("tv-poster", "tv-poster", '<span class="tv-poster-art">Film / 影片</span><strong>Long film title / 长标题</strong>', "soft"),
    example("tv-episode", "tv-episode", "<span>01</span><strong>Episode / 剧集</strong><small>24 min</small>", "soft"),
    example("tv-search", "tv-search-result", "<strong>Search result / 搜索结果</strong>", "soft")
  ].join("").replaceAll("<article", '<button type="button"').replaceAll("</article>", "</button>") : [
    example("widget", "ui-card ui-card-frame management-dashboard-widget", '<div class="management-widget-content"><section class="management-section"><header class="management-section-header"><div><h3>Storage / 存储管理</h3><p>工作区状态 · Read only</p></div></header><div class="management-workload-list"><article class="management-workload"><span>01</span><strong>项目文档 / Project documents</strong><small>Ready</small></article></div></section></div>', "frame"),
    example("metric", "ui-card management-metric", '<span>Available / 可用空间</span><strong>128 GiB</strong><small>Storage pool / 存储池</small>'),
    example("approval", "ui-card ui-card-frame approval-card", '<div class="approval-card-icon" data-kind="capability">!</div><div class="approval-card-body"><strong>Approve access / 允许访问</strong><p>Requires confirmation / 需要确认</p><dl class="approval-card-details"><div><dt>Scope / 范围</dt><dd>Project documents</dd></div></dl></div><div class="approval-actions"><button disabled>Allow / 允许</button><button>Cancel / 取消</button></div>', "frame"),
    '<div class="settings-metric-grid">'+example("settings-metric", "", "<strong>1,024</strong><span>Files / 文件</span>")+"</div>",
    '<div class="video-panel" style="display:block">'+example("video", "ui-card video-poster", '<span class="video-artwork">影片</span><strong>电影名称 / Long film title</strong><small>2026 · 1080p</small>')+"</div>",
    example("album", "ui-card music-album", '<button class="music-album-open"><span class="music-cover">♪</span><strong>专辑标题 / Album</strong><small>Artist / 艺术家</small></button><div class="music-album-meta">12 tracks</div>'),
    example("photo", "ui-card photo-tile", '<button class="photo-open" aria-label="Open photo">Photo / 照片</button>'),
    example("recording", "ui-card nvr-card nvr-recording", '<header class="nvr-card-header"><h3>Recording / 录像</h3></header><p>12:30 – 12:31</p>'),
    example("event", "ui-card nvr-card nvr-event", '<header class="nvr-card-header"><h3>Motion / 移动侦测</h3></header><p>Camera 01</p>'),
    ...sectionNames.map(name => example(name, name, "<header><h3>Details / 详情分组</h3></header><p>Project documents / 项目资料</p>", "open")),
    ...summaryNames.map(name => example(name, name)),
    example("download", "download-task-row", "<strong>Download / 下载任务</strong><span>Running / 运行中</span>", "open"),
    example("resource-row", "management-resource-row", "<span>CPU</span><strong>12%</strong>", "open"),
    '<div class="monitoring-incident-list">'+example("incident", "", "<span></span><strong>Incident / 告警</strong>", "open")+"</div>",
    '<button data-card-example="notification" data-surface="open" class="notification-item"><span>!</span><span>Notification / 通知内容</span></button>',
    '<div class="network-interface-detail-facts">'+example("network-fact", "", "<span>IP</span><strong>192.168.1.8</strong>", "open")+"</div>"
  ].join("");
  await page.route("**/__card_fixture__", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/${tv ? "tv/tv.css" : "styles.css"}"><style>
    html,body{height:auto;overflow:auto}
    #root{padding:18px;display:grid;gap:18px;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));height:auto;min-height:100dvh;overflow:visible}
    #root>*{min-width:0} [data-card-example]{min-height:90px;position:relative} [data-card-example] p{overflow-wrap:anywhere}
    [data-card-example="widget"]{height:210px} [data-card-example="photo"]{height:180px} .video-artwork{min-height:140px} .music-cover{min-height:120px}
    .tv-poster{width:100%;min-height:220px}.tv-poster-art{height:180px;aspect-ratio:auto}
  </style></head><body><main id="root" class="${tv ? "tv-app" : "app-shell"}"></main><script type="module">
    import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(globalThis.window);globalThis.window.$RefreshReg$=()=>{};globalThis.window.$RefreshSig$=()=>type=>type;globalThis.window.__vite_plugin_react_preamble_installed__=true;
    const R=await import("/node_modules/${cacheName}/deps/react.js");const React=R.default??R;
    const D=await import("/node_modules/${cacheName}/deps/react-dom_client.js");const createRoot=D.createRoot??D.default.createRoot;
    const UI=await import("/@fs/${path.join(source, "packages/ui/src/index.ts")}");
    import "/@fs/${path.join(source, "packages/ui/src/styles.css")}";
    import "/@fs/${path.join(source, "packages/ui/src/fonts.css")}";
    import "/src/components/nvr/nvr.css";
    const {initI18n}=await import('/src/i18n/index.ts');localStorage.setItem('cyberos:language',${JSON.stringify(locale)});await initI18n();
    const {NvrCameraCard}=await import('/src/components/nvr/NvrLive.tsx');
    const {PanelHeaderAction}=await import('/src/components/workspace/PanelHeader.tsx');
    const device={id:'camera-1',name:'门口摄像机 / Camera with a very long operational name',connection:'connected',video:'available',recording:'recording',analytics:true,ptz:'idle',lastError:null};
    const Card=UI.Card??((props)=>React.createElement('article',{...props,className:'ui-card '+(props.className??'')},props.children));
    function Example(){const [value,setValue]=React.useState('Draft / 未保存输入');return React.createElement(React.Fragment,null,
      React.createElement(Card,{'data-card-example':'shared','data-surface':'soft',title:'标题与操作 / Card with a long descriptive title',description:'Operational description / 简短运行说明',actions:React.createElement(UI.Button,{variant:'secondary',id:'card-action'},'Open / 打开'),footer:React.createElement('span',null,'Footer / 底部信息')},React.createElement(UI.Input,{id:'card-draft',value,onChange:e=>setValue(e.target.value)})),
      React.createElement(UI.Section,{title:'Section / 常驻区块','data-card-example':'section','data-surface':'open'},React.createElement('p',null,'No nested frame / 不叠加卡片框')),
      ${tv ? "null," : "React.createElement('section',{className:'management-section','data-card-example':'section-actions','data-surface':'open'},React.createElement(UI.SectionHeader,{title:'Devices / 设备',className:'management-section-header',actions:React.createElement(PanelHeaderAction,{id:'card-section-action',label:'Create device / 创建设备',onClick:()=>{globalThis.window.__created=(globalThis.window.__created??0)+1}},React.createElement('svg',{viewBox:'0 0 20 20',width:18,height:18,'aria-hidden':true},React.createElement('path',{d:'M10 3v14M3 10h14',stroke:'currentColor',strokeWidth:2})))})),"}
      ${tv ? "null," : "React.createElement(NvrCameraCard,{device,paused:true,onOpen:()=>{globalThis.window.__opened=(globalThis.window.__opened??0)+1}}),"}
      React.createElement('div',{style:{display:'contents'},dangerouslySetInnerHTML:{__html:${JSON.stringify(markup)}}}));}
    createRoot(globalThis.document.getElementById('root')).render(React.createElement(Example));globalThis.window.__fixtureReady=true;
  </script></body></html>` }));
  await page.goto(baseUrl + "__card_fixture__");
  await page.waitForFunction(() => globalThis.window.__fixtureReady); await page.locator("#card-draft").waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready); assert.deepEqual(errors, []);
  return page;
}

test("card families share geometry, theme surfaces and open sections across languages and widths", async context => {
  for (const locale of baseline ? ["en"] : ["en", "zh-CN"]) {
    const page = await fixture(context, { locale });
    for (const width of baseline ? [1440, 390] : [1440, 820, 560, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const scheme of baseline ? ["neon"] : schemes) for (const mode of baseline ? ["dark"] : ["dark", "light"]) {
        await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
        await page.waitForTimeout(250);
        const readings = await page.locator("[data-card-example],.nvr-camera").evaluateAll(elements => elements.map(element => {
          const css = globalThis.getComputedStyle(element), probe = globalThis.document.createElement("span");
          probe.style.backgroundColor = `var(${element.dataset.surface === "frame" ? "--cyber-bg" : "--cyber-soft"})`; element.append(probe);
          const expected = globalThis.getComputedStyle(probe).backgroundColor; probe.remove();
          return { name: element.dataset.cardExample ?? "nvr-camera", role: element.dataset.surface ?? "soft", radius: css.borderRadius,
            shadow: css.boxShadow, background: css.backgroundColor, image: css.backgroundImage, expected, clip: css.clipPath };
        }));
        if (!baseline) {
          for (const reading of readings) {
            assert.equal(reading.radius, "0px", JSON.stringify(reading)); assert.equal(reading.shadow, "none", JSON.stringify(reading));
            assert.equal(reading.image, "none", JSON.stringify(reading)); assert.equal(reading.clip, "none", JSON.stringify(reading));
            assert.equal(reading.background, reading.role === "open" ? "rgba(0, 0, 0, 0)" : reading.expected, `${scheme}/${mode}: ${JSON.stringify(reading)}`);
          }
          assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), `Overflow at ${width}`);
          const action = await page.locator("#card-section-action").evaluate(element => {
            const probe = globalThis.document.createElement("span"); probe.style.color = "var(--cyber-ink)"; element.append(probe);
            const expected = globalThis.getComputedStyle(probe).color; probe.remove();
            const bounds = element.getBoundingClientRect();
            return { color: globalThis.getComputedStyle(element).color, expected, width: bounds.width, height: bounds.height };
          });
          assert.equal(action.color, action.expected, `${scheme}/${mode}: section action contrast`);
          assert.ok(action.width >= 32 && action.height >= 32);
        }
        records.push({ locale, width, scheme, mode, readings });
        if (scheme === "neon" && locale === "en" && [1440, 390].includes(width)) await page.screenshot({ fullPage: true, path: path.join(output, `cards-${width}-${mode}.png`) });
      }
    }
    if (!baseline) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("#card-draft").fill("Preserved draft / 保留草稿");
      await page.evaluate(() => globalThis.document.documentElement.dataset.cyberScheme = "amber");
      assert.equal(await page.locator("#card-draft").inputValue(), "Preserved draft / 保留草稿");
      await page.locator(".nvr-camera-open").click(); assert.equal(await page.evaluate(() => globalThis.window.__opened), 1);
      await page.locator("#card-section-action").click(); assert.equal(await page.evaluate(() => globalThis.window.__created), 1);
      await page.keyboard.press("Tab");
      await page.locator("#card-action").focus();
      assert.equal(await page.locator("#card-action").evaluate(element => globalThis.getComputedStyle(element).outlineWidth), "2px");
      assert.equal(await page.locator("[data-card-example='shared'] .ui-card-header h3").evaluate(element => globalThis.getComputedStyle(element).fontSize), "15px");
      const heading = await page.locator("[data-card-example='shared']").getAttribute("aria-labelledby");
      assert.ok(heading && await page.locator(`[id='${heading}']`).count() === 1);
    }
    await page.close();
  }
});

test("TV cards retain a complete remote focus ring without decorative shadows", async context => {
  const page = await fixture(context, { tv: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of baseline ? ["neon"] : schemes) for (const mode of baseline ? ["dark"] : ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
    for (const selector of [".tv-poster", ".tv-episode", ".tv-search-result"]) {
      await page.locator(selector).evaluate(element => element.tabIndex = 0);
      await page.keyboard.press("Tab");
      await page.locator(selector).focus();
      const reading = await page.locator(selector).evaluate(element => {
        const css = globalThis.getComputedStyle(element); return { outline: css.outlineWidth, offset: css.outlineOffset, radius: css.borderRadius, shadow: css.boxShadow };
      });
      if (!baseline) assert.deepEqual(reading, { outline: "3px", offset: "4px", radius: "0px", shadow: "none" });
      records.push({ surface: "TV", scheme, mode, selector, reading });
    }
    if (scheme === "neon") await page.screenshot({ fullPage: true, path: path.join(output, `tv-cards-${mode}.png`) });
  }
});
