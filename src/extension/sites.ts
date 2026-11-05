import type { Site } from "../core/types";

/**
 * Everything Wisp knows about each site's page lives here. When ChatGPT or Claude change
 * their layout, these selectors are the only thing that should need updating.
 * Last checked by hand: see README.
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
    editorSelector: '#prompt-textarea, div.ProseMirror[contenteditable="true"]',
    userMessageSelector: '[data-message-author-role="user"]',
    chatId: (path) => path.match(/\/c\/([\w-]+)/)?.[1] ?? null,
  },
  "claude.ai": {
    site: "claude",
    editorSelector: 'div.ProseMirror[contenteditable="true"], [data-testid="chat-input"]',
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
