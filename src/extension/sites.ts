import type { Site } from "../core/types";

/**
 * Everything Wisp knows about each site's page lives here. When ChatGPT or Claude change
 * their layout, these selectors are the only thing that should need updating.
 * Last checked in Chrome on 2026-11-05: ChatGPT (signed out) and Claude (signed in).
 * Older selectors are kept alongside newer ones because sites roll out changes gradually.
 * If they stop matching anyway, findComposer() below falls back to generic signals, and the
 * content script tells the user when it can't find the chat box at all.
 */
export interface SiteAdapter {
  site: Exclude<Site, "demo">;
  editorSelector: string;
  userMessageSelector: string;
  chatId(path: string): string | null;
}

export const ADAPTERS: Record<string, SiteAdapter> = {
  "chatgpt.com": {
    site: "chatgpt",
    // 2026-11: a plain <textarea name="prompt">; earlier a ProseMirror div with id prompt-textarea.
    editorSelector: 'textarea[name="prompt"], #prompt-textarea, div.ProseMirror[contenteditable="true"]',
    userMessageSelector: '[data-message-role="user"], [data-message-author-role="user"]',
    // Signed-in chats use /c/<id>; signed-out chats use /uc/<id>.
    chatId: (path) => path.match(/\/u?c\/([\w-]+)/)?.[1] ?? null,
  },
  "claude.ai": {
    site: "claude",
    editorSelector: '[data-testid="chat-input"], div.ProseMirror[contenteditable="true"]',
    userMessageSelector: '[data-testid="user-message"]',
    chatId: (path) => path.match(/\/chat\/([\w-]+)/)?.[1] ?? null,
  },
};

export function adapterFor(hostname: string): SiteAdapter | null {
  for (const [host, a] of Object.entries(ADAPTERS)) {
    if (hostname === host || hostname.endsWith(`.${host}`)) return a;
  }
  return null;
}

/**
 * A brand-new chat has no id in its URL until the first message is sent, and then gets one.
 * That's the same conversation, not a navigation, so the draft being tracked must survive it.
 */
export function isSameChat(prevId: string | null, nextId: string | null): boolean {
  return prevId === nextId || prevId === null;
}

/* ------------------------------------------------------------------------------------------
 * Fallbacks for when the selectors above stop matching (the sites change their pages often).
 * The decisions are pure functions over plain data so they can be unit tested without a DOM.
 * ---------------------------------------------------------------------------------------- */

/** How the chat box was found: the adapter's selector, or one of the backup signals in order. */
export type FindStrategy = "primary" | "role-textbox" | "labeled" | "largest-bottom";

/** What the fallback finder needs to know about each editable element on the page. */
export interface EditorCandidate {
  kind: "textarea" | "contenteditable";
  role: string | null;
  /** aria-label, placeholder and data-placeholder, joined. */
  label: string;
  visible: boolean;
  top: number;
  height: number;
  width: number;
}

const COMPOSER_WORDS = /\b(message|prompt|ask|chat|reply|write|send)/i;
const NOT_COMPOSER = /\b(search|find|rename|title|filter)\b/i;

/**
 * Picks the chat box among the page's editable elements, by stable signals in order:
 * 1. a contenteditable with role=textbox; 2. a textarea or contenteditable whose label or
 * placeholder talks about a message/prompt/chat; 3. the largest editable in the bottom half
 * of the viewport. Ties go to the element lowest on the page, where chat boxes live.
 */
export function pickComposer(
  cands: EditorCandidate[],
  viewportHeight: number,
): { index: number; strategy: Exclude<FindStrategy, "primary"> } | null {
  const usable = cands
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.visible && c.width >= 40 && c.height >= 16 && !NOT_COMPOSER.test(c.label));
  const lowest = (xs: typeof usable) => xs.reduce((a, b) => (b.c.top > a.c.top ? b : a));

  const roleBox = usable.filter(({ c }) => c.kind === "contenteditable" && c.role === "textbox");
  if (roleBox.length) return { index: lowest(roleBox).index, strategy: "role-textbox" };

  const labeled = usable.filter(({ c }) => COMPOSER_WORDS.test(c.label));
  if (labeled.length) return { index: lowest(labeled).index, strategy: "labeled" };

  const bottom = usable.filter(({ c }) => c.top + c.height / 2 >= viewportHeight / 2);
  if (!bottom.length) return null;
  const largest = bottom.reduce((a, b) => (b.c.width * b.c.height > a.c.width * a.c.height ? b : a));
  return { index: largest.index, strategy: "largest-bottom" };
}

/**
 * Finds the chat box: the adapter's selector first, then the backup signals in pickComposer.
 * Ignores Wisp's own UI and editors nested inside another editor.
 */
export function findComposer(a: SiteAdapter, doc: Document = document): { el: HTMLElement; strategy: FindStrategy } | null {
  const primary = doc.querySelector<HTMLElement>(a.editorSelector);
  if (primary) return { el: primary, strategy: "primary" };
  const editable = 'textarea, [contenteditable]:not([contenteditable="false"])';
  const els = [...doc.querySelectorAll<HTMLElement>(editable)].filter(
    (el) => !el.closest("#wisp-root") && !el.parentElement?.closest(editable) && !(el as HTMLTextAreaElement).disabled,
  );
  const cands: EditorCandidate[] = els.map((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      kind: el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable",
      role: el.getAttribute("role"),
      label: ["aria-label", "placeholder", "data-placeholder"].map((k) => el.getAttribute(k) ?? "").join(" ").trim(),
      visible: el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none",
      top: r.top,
      height: r.height,
      width: r.width,
    };
  });
  const pick = pickComposer(cands, doc.defaultView?.innerHeight ?? 800);
  return pick ? { el: els[pick.index], strategy: pick.strategy } : null;
}

/** User messages marked by a generic attribute, for when the adapter's selector matches nothing. */
export const USER_MESSAGE_FALLBACK =
  '[data-message-author-role="user"], [data-message-role="user"], [data-role="user"], [data-author="user"], [data-author-role="user"]';

/** Enter without Shift (and not mid-IME-composition) is how both sites send. */
export function isSendKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/**
 * Backup send detection that needs no message selector: after Enter or a button click, the
 * draft that was there is gone. (Message counting stays the main signal when it works.)
 */
export function clearedAfterSend(draftAtTrigger: string, draftNow: string): boolean {
  return draftAtTrigger.trim() !== "" && draftNow.trim() === "";
}

/** Pages on each site that should have a chat box (not settings, login, etc.). */
export function isChatPage(site: SiteAdapter["site"], path: string): boolean {
  return site === "chatgpt" ? /^\/($|c\/|uc\/|g\/)/.test(path) : /^\/(new|chat\/|project\/)/.test(path);
}

export interface HealthState {
  now: number;
  /** When the chat box went missing (page load, navigation, or a selector that stopped matching); null if found. */
  missingSince: number | null;
  lastTypedAt: number;
  noticeShownThisPage: boolean;
  tipOpen: boolean;
  onChatPage: boolean;
}

export const HEALTH_GRACE_MS = 10_000;
const TYPING_QUIET_MS = 3_000;

/** Show the "can't find the chat box" notice: missing for ~10 s, once per page load, never while typing. */
export function shouldShowNotice(s: HealthState): boolean {
  return (
    s.onChatPage &&
    s.missingSince !== null &&
    s.now - s.missingSince >= HEALTH_GRACE_MS &&
    !s.noticeShownThisPage &&
    !s.tipOpen &&
    s.now - s.lastTypedAt >= TYPING_QUIET_MS
  );
}

export const NOTICE_TEXT =
  "Wisp can't find the chat box on this page, so tips are paused. ChatGPT or Claude may have changed their layout.";
export const ISSUES_URL = "https://github.com/v7ncey/wisp/issues";

/** The line in the orb's stats panel that says how Wisp is connected to the page. */
export function connectionLine(strategy: FindStrategy | null): string {
  if (strategy === "primary") return "Connected to the chat box";
  if (strategy) return "Using a backup way to find the chat box";
  return "Can't find the chat box on this page, so tips are paused";
}

/** Text of the editor, whether it's a <textarea> or a contenteditable div. */
export function editorText(el: Element | null): string {
  if (!el) return "";
  const raw = el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? "";
  return raw.replace(/ /g, " ").trim();
}
