import type { Site } from "../core/types";

/**
 * Everything Wisp knows about each site's page lives here. When ChatGPT or Claude change
 * their layout, these selectors are the only thing that should need updating.
 * Last checked in Chrome on 2026-11-05: ChatGPT (signed out) and Claude (signed in).
 * Older selectors are kept alongside newer ones because sites roll out changes gradually.
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

/** Text of the editor, whether it's a <textarea> or a contenteditable div. */
export function editorText(el: Element | null): string {
  if (!el) return "";
  const raw = el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? "";
  return raw.replace(/ /g, " ").trim();
}
