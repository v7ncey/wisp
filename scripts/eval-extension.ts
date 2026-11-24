/**
 * Extension resilience eval: loads the built content script into fixture copies of ChatGPT's and
 * Claude's pages (tests/fixtures/sites) in real Chromium and checks whether Wisp still works.
 *
 *   npm run eval:extension -- --label baseline      (builds first, then runs every variant)
 *   npm run eval:extension -- --label dev --only claude-2026-11
 *
 * Each fixture is served on the real hostname (https://chatgpt.com/..., https://claude.ai/...) via
 * request interception, so the content script's adapterFor(location.hostname) behaves as on the site.
 * Results go to evals/extension/<label>.json.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Playwright is preinstalled globally (not a project dependency), so load it untyped.
type Any = any;
const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: Any };

interface Variant {
  id: string;
  site: "chatgpt" | "claude";
  status: "documented" | "hypothetical";
  file: string;
  path: string;
  description: string;
  harness: { editor: string; frame: string | null; sendBy: "click" | "enter"; before: "navigate" | null };
}

interface Row {
  id: string;
  site: string;
  status: string;
  foundEditor: boolean;
  insertedAddOn: boolean;
  countedSend: boolean;
  /** Wisp showed a visible non-tip message (e.g. a "can't find the chat box" notice) at any point. */
  noticeShown: boolean;
  noticeText: string | null;
  /** foundEditor && insertedAddOn && countedSend. */
  working: boolean;
  /** Only for variants where Wisp did not fully work: did it tell the user? null when working. */
  toldUser: boolean | null;
  /** The connection line in the orb's stats panel at the end of the run, if there is one. */
  panelLine: string | null;
  /** Harness self-check: the fixture itself appended the sent message and cleared its composer. */
  fixtureOk: boolean;
  error: string | null;
}

const ROOT = process.cwd();
const FIXTURES = join(ROOT, "tests/fixtures/sites");
const CONTENT_JS = join(ROOT, "extension/dist/content.js");
const HOSTS = { chatgpt: "chatgpt.com", claude: "claude.ai" } as const;
const DRAFT = "build me a website";
const TIP_WAIT_MS = 6000;
const SEND_WAIT_MS = 4000;
/** How long after the content script loads to keep watching for a notice. */
const OBSERVE_MS = 16000;
const MEMORY_KEY = "wisp-memory-v1";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const label = arg("label");
const only = arg("only");
const concurrency = Number(arg("concurrency") ?? 4);
if (!label || !/^[\w.-]+$/.test(label)) {
  console.error("Usage: npm run eval:extension -- --label <name> [--only <variant-id>] [--concurrency 4]");
  process.exit(1);
}
if (!existsSync(CONTENT_JS)) {
  console.error("extension/dist/content.js is missing: run `npm run build` first.");
  process.exit(1);
}

/** Runs in the page before anything else: an in-memory chrome.storage.local and a runtime stub. */
const CHROME_STUB = `
(() => {
  const data = {};
  const writes = [];
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  window.__wispStub = { data, writes };
  window.chrome = {
    storage: { local: {
      async get(keys) {
        const out = {};
        const list = keys == null ? Object.keys(data) : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        for (const k of list) if (k in data) out[k] = clone(data[k]);
        return out;
      },
      async set(items) { for (const [k, v] of Object.entries(items)) { data[k] = clone(v); writes.push({ key: k, at: Date.now() }); } },
      async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    } },
    runtime: { async sendMessage() { return { ok: false, status: 0, body: null }; } },
  };
})();`;

/** Injected right after the content script: remembers any non-tip message Wisp shows. */
const NOTICE_WATCH = `
(() => {
  window.__wispNotices = [];
  setInterval(() => {
    const root = document.getElementById("wisp-root")?.shadowRoot;
    const wrap = root?.querySelector(".wisp");
    const bubble = root?.querySelector(".bubble");
    if (!wrap || !bubble || wrap.dataset.state === "idle") return;
    if (bubble.querySelector("button.got") || bubble.querySelector(".stats")) return; // a tip or the stats panel
    const text = bubble.textContent.replace(/\\s+/g, " ").trim();
    if (text && !window.__wispNotices.includes(text)) window.__wispNotices.push(text);
  }, 200);
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runVariant(browser: Any, v: Variant, contentJs: string): Promise<Row> {
  const row: Row = {
    id: v.id, site: v.site, status: v.status,
    foundEditor: false, insertedAddOn: false, countedSend: false,
    noticeShown: false, noticeText: null, working: false, toldUser: null, panelLine: null, fixtureOk: false, error: null,
  };
  // SHOTS=<dir> also saves a screenshot of the notice and of the stats panel (for docs); results are unaffected.
  const shots = process.env.SHOTS;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: shots ? 2 : 1 });
  const page = await context.newPage();
  const html = readFileSync(join(FIXTURES, v.file), "utf8");
  const host = HOSTS[v.site];
  await page.route("**/*", (route: Any) => {
    const url = new URL(route.request().url());
    if (url.hostname === host && route.request().resourceType() === "document") {
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    return route.abort();
  });
  await page.addInitScript(CHROME_STUB);
  try {
    await page.goto(`https://${host}${v.path}`, { waitUntil: "load" });
    await page.addScriptTag({ content: contentJs }); // like run_at: document_idle
    await page.addScriptTag({ content: NOTICE_WATCH });
    const loadedAt = Date.now();

    if (v.harness.before === "navigate") {
      await page.locator(v.harness.editor).first().waitFor({ state: "visible", timeout: 5000 });
      await page.click("#nav-chat");
      await sleep(100);
    }
    const scope = v.harness.frame ? page.frameLocator(v.harness.frame) : page;
    const editor = scope.locator(v.harness.editor).first();
    await editor.waitFor({ state: "visible", timeout: 5000 });
    const editorText = () => editor.evaluate((el: Any) => (el.tagName === "TEXTAREA" ? el.value : el.innerText));

    // (a) Typing a vague draft makes Wisp show a tip.
    await editor.click();
    await page.keyboard.type(DRAFT, { delay: 30 });
    const chip = page.locator("#wisp-root .wisp[data-state=open] .chip").first();
    row.foundEditor = await chip.waitFor({ state: "visible", timeout: TIP_WAIT_MS }).then(() => true, () => false);

    // (b) Clicking the first add-on puts its text into the editor.
    if (row.foundEditor) {
      const insert: string = (await chip.getAttribute("title")) ?? "";
      await chip.click();
      await sleep(400);
      row.insertedAddOn = insert.length > 0 && (await editorText()).includes(insert.trim().slice(0, 20));
    }

    // (c) Sending is recorded: Wisp's memory is written after the send.
    const writesBefore: number = await page.evaluate((k: string) => (window as Any).__wispStub.writes.filter((w: Any) => w.key === k).length, MEMORY_KEY);
    if (v.harness.sendBy === "click") await scope.locator("#send").click();
    else {
      await editor.click();
      await page.keyboard.press("Enter");
    }
    row.countedSend = await page
      .waitForFunction(
        ([k, n]: [string, number]) => (window as Any).__wispStub.writes.filter((w: Any) => w.key === k).length > n,
        [MEMORY_KEY, writesBefore],
        { timeout: SEND_WAIT_MS, polling: 100 },
      )
      .then(() => true, () => false);
    row.fixtureOk = (await editorText()).trim() === "" && (await page.locator("#thread").innerText()).includes(DRAFT);

    // (d) Keep watching for a notice, then open the stats panel.
    const left = OBSERVE_MS - (Date.now() - loadedAt);
    if (left > 0) await sleep(left);
    const notices: string[] = await page.evaluate(() => (window as Any).__wispNotices);
    row.noticeShown = notices.length > 0;
    row.noticeText = notices[0] ?? null;
    const state = await page.locator("#wisp-root .wisp").getAttribute("data-state");
    if (shots && state !== "idle") await page.screenshot({ path: join(shots, `${v.id}-notice.png`) });
    if (state !== "idle") {
      // Close whatever is open (a notice) so the orb opens the panel.
      await page.locator("#wisp-root .bubble .x").first().click().catch(() => {});
    }
    await page.locator("#wisp-root .orb-btn").click();
    const conn = page.locator("#wisp-root .bubble .conn");
    row.panelLine = await conn.first().waitFor({ state: "visible", timeout: 1500 }).then(() => conn.first().textContent(), () => null);
    if (shots) await page.screenshot({ path: join(shots, `${v.id}-panel.png`) });
  } catch (e) {
    row.error = (e as Error).message.split("\n")[0];
  }
  row.working = row.foundEditor && row.insertedAddOn && row.countedSend;
  row.toldUser = row.working ? null : row.noticeShown;
  await context.close();
  return row;
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, "variants.json"), "utf8")) as { variants: Variant[] };
  const variants = manifest.variants.filter((v) => !only || v.id === only);
  const contentJs = readFileSync(CONTENT_JS, "utf8");
  const browser = await chromium.launch();
  const rows: Row[] = new Array(variants.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, variants.length) }, async () => {
      while (next < variants.length) {
        const i = next++;
        rows[i] = await runVariant(browser, variants[i], contentJs);
        const r = rows[i];
        console.log(
          `${r.id.padEnd(34)} editor:${r.foundEditor ? "Y" : "n"} addon:${r.insertedAddOn ? "Y" : "n"} send:${r.countedSend ? "Y" : "n"} notice:${r.noticeShown ? "Y" : "n"}${r.fixtureOk ? "" : "  FIXTURE-CHECK-FAILED"}${r.panelLine ? `  [${r.panelLine}]` : ""}${r.error ? `  ERROR ${r.error}` : ""}`,
        );
      }
    }),
  );
  const version: string = browser.version();
  await browser.close();

  const n = rows.length;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const notWorking = rows.filter((r) => !r.working);
  const totals = {
    variants: n,
    documented: count((r) => r.status === "documented"),
    hypothetical: count((r) => r.status === "hypothetical"),
    foundEditor: count((r) => r.foundEditor),
    insertedAddOn: count((r) => r.insertedAddOn),
    countedSend: count((r) => r.countedSend),
    working: count((r) => r.working),
    notWorking: notWorking.length,
    toldUser: notWorking.filter((r) => r.toldUser).length,
    falseAlarms: count((r) => r.working && r.noticeShown),
    errors: count((r) => r.error !== null),
    fixtureOk: count((r) => r.fixtureOk),
  };
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const out = {
    label,
    date: new Date().toISOString(),
    command: `npm run eval:extension -- ${args.join(" ")}`,
    commit: git("rev-parse --short HEAD"),
    uncommittedChanges: git("status --porcelain -- src") ? "yes (src/ differs from the commit)" : "no",
    chromium: version,
    scenario: [
      `Serve the fixture on its real hostname, stub chrome.storage/runtime, inject extension/dist/content.js after load.`,
      `foundEditor: typing "${DRAFT}" into the composer makes Wisp's tip (with add-on chips) visible within ${TIP_WAIT_MS / 1000}s.`,
      `insertedAddOn: clicking the first chip puts its text into the composer.`,
      `countedSend: after Send/Enter, Wisp writes its memory (${MEMORY_KEY}) to chrome.storage within ${SEND_WAIT_MS / 1000}s.`,
      `noticeShown: Wisp showed any visible non-tip message within ${OBSERVE_MS / 1000}s of load. toldUser = noticeShown, counted only for variants that are not fully working.`,
    ],
    totals,
    variants: rows,
  };
  const dir = join(ROOT, "evals/extension");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\n${label}: editor ${totals.foundEditor}/${n}, add-on ${totals.insertedAddOn}/${n}, send ${totals.countedSend}/${n}, working ${totals.working}/${n}, told user ${totals.toldUser}/${totals.notWorking} not working, false alarms ${totals.falseAlarms}`,
  );
  console.log(`Wrote evals/extension/${label}.json`);
}

void main();
