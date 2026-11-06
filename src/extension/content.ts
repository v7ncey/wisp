import { Coach } from "../core/engine";
import { ChromeStore } from "../core/storage";
import { requestPersonalized } from "../core/personalize-client";
import type { CoachContext, Suggestion } from "../core/types";
import { WispUI } from "../ui/wisp-ui";
import { WispController } from "../ui/controller";
import { adapterFor, editorText, isSameChat } from "./sites";
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

  // A new chat has no id until its first message is sent; it keeps this one until then.
  let unsavedChatId = `new-${Date.now()}`;
  const urlChatId = () => a.chatId(location.pathname);
  const chatId = () => urlChatId() ?? unsavedChatId;
  const userMessages = () => document.querySelectorAll(a.userMessageSelector).length;
  const editorEl = () => document.querySelector<HTMLElement>(a.editorSelector);
  const readDraft = () => editorText(editorEl());

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
  let knownUrlId = urlChatId();
  const observer = new MutationObserver(() => {
    const urlId = urlChatId();
    if (urlId !== knownUrlId) {
      const sameChat = isSameChat(knownUrlId, urlId);
      knownUrlId = urlId;
      if (!sameChat) {
        // Moved to a different chat: forget the draft and the message count.
        if (urlId === null) unsavedChatId = `new-${Date.now()}`;
        knownCount = userMessages();
        lastDraft = "";
        ui.hide();
        return;
      }
      // A new chat just got its id because its first message was sent: keep going.
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

/** Appends text to the editor the way a user would type it: a <textarea> or a contenteditable (ProseMirror) div. */
function insertIntoEditor(el: HTMLElement | null, text: string): boolean {
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    el.setSelectionRange(el.value.length, el.value.length);
  } else {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  const current = editorText(el);
  const toInsert = current ? `${/[.!?:]$/.test(current) ? "" : "."} ${text}` : text;
  const landed = () => editorText(el).includes(text.trim().slice(0, 20));
  // execCommand is deprecated but is still what these editors (and React) treat as real typing.
  if (document.execCommand("insertText", false, toInsert) && landed()) return true;
  if (el instanceof HTMLTextAreaElement) {
    // Fallback for a React-controlled textarea: set the value natively, then announce it.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, el.value + toInsert);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return landed();
  }
  // Fallback for ProseMirror: a synthetic paste.
  const dt = new DataTransfer();
  dt.setData("text/plain", toInsert);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  return landed();
}
