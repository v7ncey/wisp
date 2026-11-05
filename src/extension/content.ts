import { Coach } from "../core/engine";
import { ChromeStore } from "../core/storage";
import { requestPersonalized } from "../core/personalize-client";
import type { CoachContext, Suggestion } from "../core/types";
import { WispUI } from "../ui/wisp-ui";
import { WispController } from "../ui/controller";
import { adapterFor } from "./sites";
import { API_URL, DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from "./config";

const adapter = adapterFor(location.hostname);
if (adapter) void start();

async function start() {
  const a = adapter!;
  const coach = new Coach(new ChromeStore());
  const host = document.createElement("div");
  host.id = "wisp-root";
  document.documentElement.append(host);
  const ui = new WispUI(host, { mode: "fixed" });

  const pageLoadId = `new-${Date.now()}`;
  const chatId = () => a.chatId(location.pathname) ?? pageLoadId;
  const userMessages = () => document.querySelectorAll(a.userMessageSelector).length;
  const editorEl = () => document.querySelector<HTMLElement>(a.editorSelector);
  const readDraft = () => (editorEl()?.innerText ?? "").replace(/ /g, " ").trim();

  const context = (): CoachContext => ({ site: a.site, chatId: chatId(), userMessageCount: userMessages(), now: Date.now() });

  const personalize = (draft: string, s: Suggestion) =>
    requestPersonalized(API_URL, draft, s, (_url, body) => chrome.runtime.sendMessage({ type: "wisp:personalize", body }));

  let settings: Settings = { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {}) };

  const controller = new WispController({
    coach,
    ui,
    context,
    editor: { getDraft: readDraft, insert: (text) => insertIntoEditor(editorEl(), text) },
    personalize: settings.personalize ? personalize : undefined,
  });

  ui.setPanelProvider(async () => ({
    memory: await coach.snapshot(),
    personalizeOn: settings.personalize,
    personalizeNote:
      "Off by default. When on, the draft that triggered a tip is sent to Wisp's server and Google Gemini to tailor the wording. Everything else stays on this computer.",
    onTogglePersonalize: async (on) => {
      settings = { ...settings, personalize: on };
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      controller.setPersonalize(on ? personalize : undefined);
    },
    onReset: () => void coach.reset(),
  }));

  // Typing: listen at the document level because these sites replace the editor element on navigation.
  let lastDraft = "";
  document.addEventListener(
    "input",
    (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(a.editorSelector)) return;
      lastDraft = readDraft();
      controller.onInput();
    },
    true,
  );

  // Sending: a new user message appears and the editor empties. Checking both avoids
  // counting old messages that load in when you open an existing chat.
  let knownCount = userMessages();
  let knownChat = chatId();
  const observer = new MutationObserver(() => {
    if (chatId() !== knownChat) {
      knownChat = chatId();
      knownCount = userMessages();
      lastDraft = "";
      ui.hide();
      return;
    }
    const count = userMessages();
    if (count > knownCount) {
      if (lastDraft && !readDraft()) {
        const text = lastDraft;
        lastDraft = "";
        void controller.onSend(text);
      }
      knownCount = count;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Appends text to a contenteditable editor (ProseMirror) the way a user would type it. */
function insertIntoEditor(el: HTMLElement | null, text: string): boolean {
  if (!el) return false;
  el.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const current = el.innerText.trim();
  const toInsert = current ? `${/[.!?:]$/.test(current) ? "" : "."} ${text}` : text;
  // execCommand is deprecated but is still what rich-text editors listen for as real typing.
  let ok = document.execCommand("insertText", false, toInsert);
  if (!ok || !el.innerText.includes(text.trim().slice(0, 20))) {
    // Fallback: a synthetic paste, which ProseMirror-based editors handle.
    const dt = new DataTransfer();
    dt.setData("text/plain", toInsert);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    ok = el.innerText.includes(text.trim().slice(0, 20));
  }
  return ok;
}
