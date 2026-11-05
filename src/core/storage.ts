import type { TipId } from "./types";

export interface TipStats {
  shown: number;
  chipClicks: number;
  dismissed: number;
  learned: number;
}

/** Everything Wisp remembers. Stored only on the user's device. */
export interface WispMemory {
  version: 1;
  /** How many sent messages showed each habit (whether or not Wisp spoke up). */
  habitCounts: Partial<Record<TipId, number>>;
  /** Background sentences seen, with the chats they appeared in. */
  contexts: Array<{ fp: string; chats: string[] }>;
  /** Task categories seen, with the chats they appeared in. */
  tasks: Record<string, string[]>;
  muted: TipId[];
  lastShownAt: number;
  /** Tips already shown per chat, so Wisp doesn't repeat itself in one conversation. */
  shownInChat: Record<string, TipId[]>;
  /** Tips whose add-on the user has clicked at least once. Needed for the "learned" metric. */
  clickedEver: TipId[];
  stats: Partial<Record<TipId, TipStats>>;
}

export const emptyMemory = (): WispMemory => ({
  version: 1,
  habitCounts: {},
  contexts: [],
  tasks: {},
  muted: [],
  lastShownAt: 0,
  shownInChat: {},
  clickedEver: [],
  stats: {},
});

export interface MemoryStore {
  load(): Promise<WispMemory>;
  save(memory: WispMemory): Promise<void>;
}

const KEY = "wisp-memory-v1";

function parse(raw: unknown): WispMemory {
  if (raw && typeof raw === "object" && (raw as WispMemory).version === 1) {
    return { ...emptyMemory(), ...(raw as WispMemory) };
  }
  return emptyMemory();
}

export class InMemoryStore implements MemoryStore {
  constructor(private memory: WispMemory = emptyMemory()) {}
  async load() {
    return structuredClone(this.memory);
  }
  async save(memory: WispMemory) {
    this.memory = structuredClone(memory);
  }
}

/** Browser storage for the demo page. Falls back to session-only memory if storage is blocked. */
export class LocalStorageStore implements MemoryStore {
  private fallback = new InMemoryStore();
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? parse(JSON.parse(raw)) : emptyMemory();
    } catch {
      return this.fallback.load();
    }
  }
  async save(memory: WispMemory) {
    try {
      localStorage.setItem(KEY, JSON.stringify(memory));
    } catch {
      await this.fallback.save(memory);
    }
  }
}

/** chrome.storage.local for the extension. Data stays on the device. */
export class ChromeStore implements MemoryStore {
  async load() {
    const got = await chrome.storage.local.get(KEY);
    return parse(got[KEY]);
  }
  async save(memory: WispMemory) {
    await chrome.storage.local.set({ [KEY]: memory });
  }
}
