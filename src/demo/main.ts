import { Coach } from "../core/engine";
import { LocalStorageStore } from "../core/storage";
import { requestPersonalized } from "../core/personalize-client";
import type { CoachContext } from "../core/types";
import { WispUI } from "../ui/wisp-ui";
import { WispController } from "../ui/controller";
import results from "../../evals/results.json";
import geminiComparison from "../../evals/gemini-comparison.json";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const draftEl = $<HTMLTextAreaElement>("#draft");
const messagesEl = $<HTMLOListElement>("#messages");
const aiToggle = $<HTMLInputElement>("#ai-toggle");

const DEMO_COOLDOWN_MS = 8000;
const store = new LocalStorageStore();
const coach = new Coach(store, { cooldownMs: DEMO_COOLDOWN_MS });
const ui = new WispUI($("#wisp-host"), { mode: "contained" });

let chatNumber = 1;
let chatId = `demo-${Date.now()}`;
let sent = 0;

const context = (): CoachContext => ({ site: "demo", chatId, userMessageCount: sent, now: Date.now() });

const personalize = (draft: string, s: Parameters<typeof requestPersonalized>[2]) => requestPersonalized("/api/coach", draft, s);

const controller = new WispController({
  coach,
  ui,
  context,
  editor: {
    getDraft: () => draftEl.value,
    insert(text) {
      const v = draftEl.value.trimEnd();
      draftEl.value = v ? `${v}${/[.!?:]$/.test(v) ? "" : "."} ${text}` : text;
      draftEl.focus();
      draftEl.setSelectionRange(draftEl.value.length, draftEl.value.length);
      return true;
    },
  },
  personalize: aiToggle.checked ? personalize : undefined,
  pauseMs: 1200,
});

aiToggle.addEventListener("change", () => controller.setPersonalize(aiToggle.checked ? personalize : undefined));

ui.setPanelProvider(async () => ({
  memory: await coach.snapshot(),
  personalizeOn: aiToggle.checked,
  personalizeNote: "On this demo page, the draft that triggered a tip goes to Google Gemini when this is on.",
  onTogglePersonalize: (on) => {
    aiToggle.checked = on;
    aiToggle.dispatchEvent(new Event("change"));
  },
  onReset: resetMemory,
}));

/* ---------- Chat ---------- */

function addMessage(text: string, who: "me" | "them" | "note") {
  messagesEl.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = who;
  li.textContent = text;
  messagesEl.append(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

const CANNED = [
  "(Practice chat: no real AI here, so this is a placeholder reply. Wisp is the part to watch.)",
  "(Placeholder reply. In a real chat the AI would answer here.)",
];

async function send(text: string) {
  if (!text.trim()) return;
  await controller.onSend(text);
  sent++;
  addMessage(text, "me");
  draftEl.value = "";
  setTimeout(() => addMessage(CANNED[sent % CANNED.length], "them"), 350);
  void renderStats();
}

$<HTMLFormElement>("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  void send(draftEl.value);
});
draftEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send(draftEl.value);
  }
});
draftEl.addEventListener("input", () => controller.onInput());

function newChat() {
  chatNumber++;
  chatId = `demo-${Date.now()}-${chatNumber}`;
  sent = 0;
  messagesEl.innerHTML = "";
  addMessage(`New chat #${chatNumber}. Wisp still remembers your earlier chats.`, "note");
  $("#chat-title").textContent = `Practice chat #${chatNumber}`;
  ui.hide();
}
$("#new-chat").addEventListener("click", newChat);

/* ---------- Scenarios ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function typeOut(text: string) {
  draftEl.value = "";
  draftEl.focus();
  const step = text.length > 200 ? 40 : 2;
  for (let i = 0; i < text.length; i += step) {
    draftEl.value = text.slice(0, i + step);
    controller.onInput();
    await sleep(18);
  }
  draftEl.value = text;
}

/** Type a prompt and let Wisp look, skipping the cooldown since the user asked for it. */
async function tryPrompt(text: string) {
  ui.hide();
  controller.forceNextLook();
  await typeOut(text);
  controller.onInput();
}

const ESSAY =
  "Marketing has changed a lot in the last decade. Brands used to rely on TV, print and radio, but now social media lets even small businesses reach millions of people for very little money. A local bakery can build a loyal following on Instagram without paying for a billboard. On the other hand, the sheer amount of content means attention is harder to win than ever. Companies now compete with every creator, meme and video in a feed. Successful brands have responded by focusing on authenticity, community and consistent posting rather than polished campaigns, and they measure everything from click-through rates to watch time. In this essay I argue that the most important marketing skill today is not creativity alone but the ability to learn quickly from data while keeping a human voice.\n\nthoughts?";
const INTRO = "I'm a junior studying computer science and I want to become a product manager.";

const SCENARIOS: Array<[string, () => Promise<void>]> = [
  ["Vague project", () => tryPrompt("build me a website for my club")],
  ["“Fix it”", () => tryPrompt("it still doesn't work, fix it")],
  ["Asking for stats", () => tryPrompt("what percentage of college students use AI for homework")],
  ["Cover letter", () => tryPrompt("write a cover letter for a marketing internship")],
  ["Pasted essay", () => tryPrompt(ESSAY)],
  [
    "Same intro, new chat",
    async () => {
      ui.hide();
      newChat();
      await typeOut(`${INTRO} What classes should I take next year?`);
      await send(draftEl.value);
      await sleep(700);
      newChat();
      await tryPrompt(`${INTRO} How should I prepare for PM interviews?`);
    },
  ],
  [
    "Same task, 3rd chat",
    async () => {
      ui.hide();
      for (const t of [
        "cover letter for a barista job. I've worked at a café for 2 years and I'm friendly, here's an example I like: …",
        "cover letter for a library assistant role, short and formal, I love books",
      ]) {
        newChat();
        await typeOut(t);
        await send(draftEl.value);
        await sleep(500);
      }
      newChat();
      await tryPrompt("help with a cover letter for a museum job, I studied art history");
    },
  ],
  [
    "Very long chat",
    async () => {
      ui.hide();
      newChat();
      for (let i = 1; i <= 20; i++) {
        await coach.recordSend(`message ${i}`, context());
        sent++;
      }
      addMessage("(20 earlier messages skipped for the demo)", "note");
      await tryPrompt("ok now change the header color to blue");
    },
  ],
];

const scenariosEl = $("#scenarios");
for (const [label, run] of SCENARIOS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", async () => {
    scenariosEl.querySelectorAll("button").forEach((x) => (x.disabled = true));
    try {
      await run();
    } finally {
      scenariosEl.querySelectorAll("button").forEach((x) => (x.disabled = false));
    }
  });
  scenariosEl.append(b);
}

/* ---------- Stats + evals ---------- */

async function renderStats() {
  const mem = await coach.snapshot();
  const t = { shown: 0, chipClicks: 0, dismissed: 0, learned: 0 };
  for (const s of Object.values(mem.stats)) {
    if (!s) continue;
    t.shown += s.shown;
    t.chipClicks += s.chipClicks;
    t.dismissed += s.dismissed;
    t.learned += s.learned;
  }
  $("#stats").innerHTML = [
    ["Tips shown", t.shown],
    ["Add-ons used", t.chipClicks],
    ["Dismissed", t.dismissed],
    ["Did it yourself", t.learned],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
}
setInterval(renderStats, 1500);
void renderStats();

async function resetMemory() {
  await coach.reset();
  void renderStats();
}
$("#reset").addEventListener("click", resetMemory);

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const heldout = results.heldout;
const dev = results.dev;
$("#eval-caption").textContent =
  `Scored on ${heldout.total} held-out prompts I wrote after freezing the rules (${results.runAt}). I wrote them myself, so treat this as a sanity check, not proof. On the ${dev.total} prompts I tuned against, it looks better, which is exactly why the held-out number is the one to trust.`;
$("#eval-body").innerHTML = heldout.perDetector
  .map((d) => `<tr><td>${d.id}</td><td>${pct(d.precision)}</td><td>${pct(d.recall)}</td></tr>`)
  .join("");
$("#eval-quiet").textContent = `Stayed quiet when it should have: ${heldout.quiet.correct} of ${heldout.quiet.total} held-out prompts.`;

// Gemini-as-detector on the same held-out prompts.
const gh = geminiComparison.heldout;
$("#eval-gemini").textContent =
  `Could Gemini spot these habits instead of rules? On the same ${gh.scoredOn} held-out prompts, Gemini made ${gh.gemini.mistakes.length} mistakes to the rules' ${gh.rules.mistakes.length} and stayed quiet correctly ${gh.gemini.quiet.correct} of ${gh.gemini.quiet.total} times. It mostly over-flagged "vague project". So the rules decide when Wisp speaks, and Gemini only rewords the tip.`;
