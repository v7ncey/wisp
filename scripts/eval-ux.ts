/**
 * First-run UX and accessibility checks for the demo page, in headless Chromium.
 *
 *   npm run eval:ux -- --label baseline            (builds, serves public/ locally, measures)
 *   npm run eval:ux -- --label prod --url https://wisp-coach.vercel.app
 *
 * Records, into evals/ux/<label>.json:
 *  - Lighthouse scores (mobile and desktop presets): performance, accessibility, best practices, SEO.
 *  - axe-core violations (WCAG 2.0/2.1 A and AA rules) on the page as loaded, with a tip open, and with the
 *    stats panel open, in light and dark mode. Wisp's pop-up lives in an open shadow root, which axe checks.
 *  - Time to first tip: a new visitor (empty memory) clicks into the message box and types a vague request
 *    at ~8 characters a second; milliseconds from the last keystroke until the tip is fully open.
 *  - Keyboard-only task: from page load, with Tab/Shift+Tab/Enter/typing only, reach the message box, type a
 *    vague request, then reach the tip's first add-on and press it. Success = the add-on lands in the draft.
 *    Records the number of Tab presses needed after the tip appears (cap 25).
 *  - Phone (390x844): is the open tip entirely inside the viewport?
 * AI personalization is switched off for the timing runs, so they don't depend on Gemini.
 */
import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as { chromium: Any };
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DRAFT = "build me a website for my club";

const { values } = parseArgs({ options: { label: { type: "string", default: "run" }, url: { type: "string" } } });

async function serveLocally(): Promise<{ url: string; stop: () => void }> {
  execSync("npm run build", { stdio: "ignore" });
  const port = 5190 + Math.floor(Math.random() * 50);
  const child = spawn("npx", ["tsx", "scripts/serve.ts"], { env: { ...process.env, PORT: String(port), GEMINI_API_KEY: "", GEMINI_KEY: "" }, stdio: "ignore" });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await sleep(200);
  }
  return { url, stop: () => child.kill() };
}

async function lighthouse(url: string, preset: "mobile" | "desktop") {
  const { default: lh } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  const remote = !url.startsWith("http://localhost");
  const flags = ["--headless=new", "--no-sandbox", ...(remote && process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])];
  const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: flags });
  try {
    const config = preset === "desktop" ? (await import("lighthouse/core/config/desktop-config.js")).default : undefined;
    const r = await lh(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] }, config);
    const lhr = r!.lhr;
    const score = (k: string) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
    const failedA11y = Object.values(lhr.audits)
      .filter((a: Any) => a.score === 0 && lhr.categories.accessibility.auditRefs.some((ref: Any) => ref.id === a.id))
      .map((a: Any) => a.id);
    return {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
      failedAccessibilityAudits: failedA11y,
      lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: Number((lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    };
  } finally {
    await chrome.kill();
  }
}

async function newPage(browser: Any, url: string, opts: Any = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...opts });
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  // Personalization off so timings don't depend on Gemini.
  // Done in the page, not with a click, so the browser doesn't scroll down to the checkbox.
  await page.evaluate(() => {
    const t = document.querySelector<HTMLInputElement>("#ai-toggle")!;
    if (t.checked) {
      t.checked = false;
      t.dispatchEvent(new Event("change"));
    }
    scrollTo(0, 0);
  });
  return page;
}

const tipOpen = (page: Any) => page.locator("#wisp-host .wisp[data-state=open] .chip").first();

async function axe(page: Any) {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n: any) => JSON.stringify(n.target)) }));
  });
  return res as Array<{ id: string; impact: string; nodes: number; targets: string[] }>;
}

async function axeStates(browser: Any, url: string, colorScheme: "light" | "dark") {
  const out: Record<string, Awaited<ReturnType<typeof axe>>> = {};
  let page = await newPage(browser, url, { colorScheme });
  out.loaded = await axe(page);
  await page.click("#draft");
  await page.keyboard.type(DRAFT, { delay: 20 });
  await tipOpen(page).waitFor({ timeout: 10_000 });
  await sleep(300);
  out.tipOpen = await axe(page);
  await page.close();
  page = await newPage(browser, url, { colorScheme });
  await page.locator("#wisp-host .orb-btn").click();
  await sleep(400);
  out.statsPanel = await axe(page);
  await page.close();
  return out;
}

async function timeToFirstTip(browser: Any, url: string) {
  const page = await newPage(browser, url);
  await page.click("#draft");
  await page.keyboard.type(DRAFT, { delay: 125 });
  const t0 = Date.now();
  await tipOpen(page).waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector("#wisp-host")?.shadowRoot?.querySelector(".wisp")?.getAttribute("data-state") === "open");
  const ms = Date.now() - t0;
  await page.close();
  return ms;
}

async function keyboardTask(browser: Any, url: string) {
  const page = await newPage(browser, url);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Tab until the message box has focus.
  let tabsToBox = 0;
  for (; tabsToBox < 40; tabsToBox++) {
    if (await page.evaluate(() => document.activeElement?.id === "draft")) break;
    await page.keyboard.press("Tab");
  }
  if (tabsToBox >= 40) return { success: false, reason: "never reached the message box", tabsToBox, tabsToAddOn: null };
  await page.keyboard.type(DRAFT, { delay: 30 });
  const appeared = await tipOpen(page).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (!appeared) return { success: false, reason: "no tip", tabsToBox, tabsToAddOn: null };
  const focusedChip = () =>
    page.evaluate(() => {
      const root = document.querySelector("#wisp-host")?.shadowRoot;
      return !!root && root.activeElement?.classList.contains("chip") === true;
    });
  let tabsToAddOn = 0;
  for (; tabsToAddOn <= 25; tabsToAddOn++) {
    if (await focusedChip()) break;
    await page.keyboard.press("Tab");
  }
  if (tabsToAddOn > 25) return { success: false, reason: "couldn't reach an add-on with Tab", tabsToBox, tabsToAddOn: null };
  const before = await page.inputValue("#draft");
  await page.keyboard.press("Enter");
  await sleep(300);
  const after = await page.inputValue("#draft");
  return { success: after.length > before.length, reason: after.length > before.length ? null : "Enter on the add-on didn't add it", tabsToBox, tabsToAddOn };
}

async function phoneTip(browser: Any, url: string) {
  const page = await newPage(browser, url, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.click("#draft");
  await page.keyboard.type(DRAFT, { delay: 20 });
  await tipOpen(page).waitFor({ timeout: 10_000 });
  await sleep(400);
  const r = await page.evaluate(() => {
    const b = document.querySelector("#wisp-host")!.shadowRoot!.querySelector(".bubble")!.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth, vh: innerHeight, scrollY: Math.round(scrollY) };
  });
  await page.close();
  return { ...r, insideViewport: r.top >= 0 && r.left >= 0 && r.bottom <= r.vh && r.right <= r.vw };
}

/** Phone, page as loaded: is the whole message box on the first screen? */
async function phoneComposer(browser: Any, url: string) {
  const page = await newPage(browser, url, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const r = await page.$eval("#draft", (el: Element) => {
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight };
  });
  await page.close();
  return { ...r, onFirstScreen: r.bottom <= r.vh };
}

/** Phone with the keyboard up (simulated as a 390x450 viewport): is the open tip fully visible? */
async function phoneKeyboardTip(browser: Any, url: string) {
  const page = await newPage(browser, url, { viewport: { width: 390, height: 450 }, isMobile: true, hasTouch: true });
  await page.click("#draft");
  await page.keyboard.type(DRAFT, { delay: 20 });
  await tipOpen(page).waitFor({ timeout: 10_000 });
  await sleep(500);
  const r = await page.evaluate(() => {
    const b = document.querySelector("#wisp-host")!.shadowRoot!.querySelector(".bubble")!.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight };
  });
  await page.close();
  return { ...r, fullyVisible: r.top >= 0 && r.bottom <= r.vh };
}

/** Typing a clear prompt (no tip applies): does the visitor see any sign that Wisp looked? */
async function clearPromptFeedback(browser: Any, url: string) {
  const page = await newPage(browser, url);
  await page.click("#draft");
  await page.keyboard.type("write an essay about climate change", { delay: 20 });
  const shown = await page
    .waitForFunction(() => document.querySelector("#wisp-host")?.shadowRoot?.querySelector(".wisp")?.getAttribute("data-state") === "open", null, { timeout: 6000 })
    .then(() => true, () => false);
  const text = shown ? await page.evaluate(() => document.querySelector("#wisp-host")!.shadowRoot!.querySelector(".bubble")!.textContent?.trim()) : null;
  await page.close();
  return { feedbackShown: shown, text };
}

/** With a tip open: does a status line (role=status / aria-live) carry the tip's title, and does Escape close it? */
async function screenReaderAndEscape(browser: Any, url: string) {
  const page = await newPage(browser, url);
  await page.click("#draft");
  await page.keyboard.type(DRAFT, { delay: 20 });
  await tipOpen(page).waitFor({ timeout: 10_000 });
  await sleep(600);
  const r = await page.evaluate(() => {
    const root = document.querySelector("#wisp-host")!.shadowRoot!;
    const title = root.querySelector(".bubble header strong")?.textContent?.trim() ?? "";
    const live = [...root.querySelectorAll('[role="status"], [aria-live]'), ...document.querySelectorAll('[role="status"], [aria-live]')]
      .filter((el) => !(el as HTMLElement).classList.contains("bubble") || getComputedStyle(el).visibility !== "hidden")
      .map((el) => el.textContent ?? "");
    return { title, announced: !!title && live.some((t) => t.includes(title)) };
  });
  await page.focus("#draft");
  await page.keyboard.press("Escape");
  await sleep(400);
  const state = await page.evaluate(() => document.querySelector("#wisp-host")!.shadowRoot!.querySelector(".wisp")!.getAttribute("data-state"));
  await page.close();
  return { ...r, escapeCloses: state === "idle" };
}

async function main() {
  const local = values.url ? null : await serveLocally();
  const url = values.url ?? local!.url;
  const remote = !url.startsWith("http://localhost");
  const browser = await chromium.launch(remote && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  try {
    const out: Record<string, unknown> = {
      label: values.label,
      date: new Date().toISOString(),
      command: `npm run eval:ux -- ${process.argv.slice(2).join(" ")}`.trim(),
      target: values.url ?? "local build of this commit (scripts/serve.ts)",
      commit: execSync("git rev-parse --short HEAD").toString().trim(),
      uncommittedChanges: execSync("git status --porcelain -- src public").toString().trim() ? "yes" : "no",
    };
    out.lighthouse = { mobile: await lighthouse(url, "mobile"), desktop: await lighthouse(url, "desktop") };
    console.log("lighthouse", JSON.stringify(out.lighthouse));
    const light = await axeStates(browser, url, "light");
    const dark = await axeStates(browser, url, "dark");
    const count = (s: Record<string, Array<{ nodes: number }>>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.reduce((n, x) => n + x.nodes, 0)]));
    out.axe = { light, dark, failingElements: { light: count(light), dark: count(dark) } };
    console.log("axe failing elements", JSON.stringify((out.axe as Any).failingElements));
    const times: number[] = [];
    for (let i = 0; i < 3; i++) times.push(await timeToFirstTip(browser, url));
    out.timeToFirstTipMs = { runs: times, median: [...times].sort((a, b) => a - b)[1] };
    console.log("time to first tip", JSON.stringify(out.timeToFirstTipMs));
    out.keyboardTask = await keyboardTask(browser, url);
    console.log("keyboard", JSON.stringify(out.keyboardTask));
    out.phoneTip = await phoneTip(browser, url);
    console.log("phone", JSON.stringify(out.phoneTip));
    out.phoneComposer = await phoneComposer(browser, url);
    out.phoneKeyboardTip = await phoneKeyboardTip(browser, url);
    out.clearPromptFeedback = await clearPromptFeedback(browser, url);
    out.screenReader = await screenReaderAndEscape(browser, url);
    console.log("phone composer", JSON.stringify(out.phoneComposer), "keyboard tip", JSON.stringify(out.phoneKeyboardTip));
    console.log("clear prompt", JSON.stringify(out.clearPromptFeedback), "sr", JSON.stringify(out.screenReader));
    mkdirSync("evals/ux", { recursive: true });
    writeFileSync(`evals/ux/${values.label}.json`, JSON.stringify(out, null, 2) + "\n");
    console.log(`Wrote evals/ux/${values.label}.json`);
  } finally {
    await browser.close();
    local?.stop();
  }
}

await main();
