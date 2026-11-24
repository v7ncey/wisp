import { Coach } from "../core/engine";
import { ChromeStore } from "../core/storage";
import { requestPersonalized } from "../core/personalize-client";
import type { CoachContext, Suggestion } from "../core/types";
import { WispUI } from "../ui/wisp-ui";
import { WispController } from "../ui/controller";
import {
  adapterFor,
  clearedAfterSend,
  connectionLine,
  editorText,
  findComposer,
  isChatPage,
  isSameChat,
  isSendKey,
  shouldShowNotice,
  ISSUES_URL,
  NOTICE_TEXT,
  USER_MESSAGE_FALLBACK,
  type FindStrategy,
} from "./sites";
import { selectFirstBlank } from "../ui/blanks";
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
  const userMessages = () =>
    document.querySelectorAll(a.userMessageSelector).length || document.querySelectorAll(USER_MESSAGE_FALLBACK).length;

  // The chat box: the adapter's selector, else a backup finder (see findComposer). A backup
  // match is reused while it stays on the page, so the fallback scan doesn't run on every keystroke.
  let found: { el: HTMLElement; strategy: FindStrategy } | null = null;
  let loggedStrategy: FindStrategy | null | undefined;
  const locate = () => {
    const primary = document.querySelector<HTMLElement>(a.editorSelector);
    if (primary) found = { el: primary, strategy: "primary" };
    else if (!found || found.strategy === "primary" || !found.el.isConnected) found = findComposer(a);
    const strategy = found?.strategy ?? null;
    // Log when the primary selector stops working (and when it recovers), not on every check.
    if (strategy !== loggedStrategy && loggedStrategy !== undefined) console.info(`[Wisp] chat box: ${strategy ?? "not found"}`);
    loggedStrategy = strategy;
    return found;
  };
  const editorEl = () => locate()?.el ?? null;
  const readDraft = () => editorText(editorEl());
  const inEditor = (t: EventTarget | null) => {
    const el = editorEl();
    return !!el && t instanceof Node && el.contains(t);
  };

  const context = (): CoachContext => ({ site: a.site, chatId: chatId(), userMessageCount: userMessages(), now: Date.now() });

  const personalize = (draft: string, s: Suggestion) =>
    requestPersonalized(API_URL, draft, s, (_url, body) => chrome.runtime.sendMessage({ type: "wisp:personalize", body }));

  let settings: Settings = { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {}) };

  const controller = new WispController({
    coach,
    ui,
    context,
    editor: {
      getDraft: readDraft,
      insert: (text) => {
        const el = editorEl();
        if (!insertIntoEditor(el, text)) return false;
        selectFirstBlank(el); // land on a "___" blank, if any, so typing replaces it
        return true;
      },
    },
    personalize: settings.personalize ? personalize : undefined,
  });

  ui.setPanelProvider(async () => ({
    memory: await coach.snapshot(),
    connection: connectionLine(locate()?.strategy ?? null),
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
  let lastTypedAt = 0;
  document.addEventListener(
    "input",
    (e) => {
      lastTypedAt = Date.now();
      if (!inEditor(e.target)) return;
      lastDraft = readDraft();
      controller.onInput();
    },
    true,
  );

  const send = (text: string) => {
    lastDraft = "";
    void controller.onSend(text);
  };

  // Backup send detection, for when user messages can't be found: after Enter in the chat box or a
  // button click, the draft that was there is gone. Whichever detector sees the send first counts it.
  const watchForSend = (draftAtTrigger: string) => {
    if (!draftAtTrigger) return;
    let tries = 0;
    const poll = window.setInterval(() => {
      if (lastDraft !== draftAtTrigger || ++tries > 20) return window.clearInterval(poll);
      if (clearedAfterSend(draftAtTrigger, readDraft())) {
        window.clearInterval(poll);
        send(draftAtTrigger);
      }
    }, 100);
  };
  document.addEventListener(
    "keydown",
    (e) => {
      lastTypedAt = Date.now();
      if (isSendKey(e) && inEditor(e.target)) watchForSend(lastDraft);
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (e.target instanceof Element && e.target.closest("button, [role=button]")) watchForSend(lastDraft);
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
        missingSince = locate() ? null : Date.now();
        return;
      }
      // A new chat just got its id because its first message was sent: keep going.
    }
    const count = userMessages();
    if (count > knownCount) {
      if (lastDraft && !readDraft()) send(lastDraft);
      knownCount = count;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Health check: if the chat box can't be found for ~10 s (after load, after a navigation, or
  // because a selector stopped matching), say so once per page load instead of failing silently.
  let missingSince: number | null = Date.now();
  let noticeShown = false;
  window.setInterval(() => {
    if (locate()) {
      missingSince = null;
      ui.hideNotice();
      return;
    }
    missingSince ??= Date.now();
    const health = {
      now: Date.now(),
      missingSince,
      lastTypedAt,
      noticeShownThisPage: noticeShown,
      tipOpen: ui.isOpen,
      onChatPage: isChatPage(a.site, location.pathname),
    };
    if (shouldShowNotice(health)) {
      noticeShown = true;
      ui.notice(NOTICE_TEXT, { href: ISSUES_URL, label: "Report it on GitHub" });
    }
  }, 1000);
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
