import {
  LONG_CHAT_MESSAGES,
  contextFingerprints,
  detectDraft,
  similarity,
  taskCategory,
} from "./detectors";
import { TIPS } from "./library";
import { emptyMemory, type MemoryStore, type TipStats, type WispMemory } from "./storage";
import type { CoachContext, Suggestion, TipId } from "./types";

export interface CoachOptions {
  /** Minimum gap between pop-ups. Wisp is rare on purpose. */
  cooldownMs?: number;
}

export const DEFAULT_COOLDOWN_MS = 3 * 60 * 1000;
const CONTEXT_MATCH = 0.6;
/** "Seen before" kicks in from the third time a habit shows up. */
const SEEN_BEFORE_AT = 3;

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

/**
 * The coach. Pure logic plus a storage adapter; the demo page and the extension both use it.
 * It never sends anything anywhere.
 */
export class Coach {
  private memory: WispMemory = emptyMemory();
  private ready: Promise<void>;
  private cooldownMs: number;
  /** Tips whose add-on was clicked during the current draft (reset on send). */
  private clickedThisDraft = new Set<TipId>();

  constructor(private store: MemoryStore, options: CoachOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.ready = store.load().then((m) => {
      this.memory = m;
    });
  }

  async snapshot(): Promise<WispMemory> {
    await this.ready;
    return structuredClone(this.memory);
  }

  /** Every tip that applies to this draft right now, ignoring pacing. Used by evals and tests. */
  async candidates(draft: string, ctx: CoachContext): Promise<TipId[]> {
    await this.ready;
    const found: TipId[] = [...detectDraft(draft)];
    if (this.otherChatsWithContext(draft, ctx.chatId) >= 1) found.push("repeated-context");
    const task = taskCategory(draft);
    if (task && this.otherChatsWithTask(task, ctx.chatId) >= 2) found.push("recurring-task");
    if (ctx.userMessageCount >= LONG_CHAT_MESSAGES) found.push("long-drift");
    return found;
  }

  /**
   * Called when the user pauses typing (never mid-keystroke; the UI debounces).
   * Returns at most one suggestion, or null when Wisp should stay quiet.
   * `force` skips the cooldown for an explicit user action such as a demo scenario button.
   */
  async check(draft: string, ctx: CoachContext, { force = false } = {}): Promise<Suggestion | null> {
    await this.ready;
    if (!force && ctx.now - this.memory.lastShownAt < this.cooldownMs) return null;
    const shownHere = this.memory.shownInChat[ctx.chatId] ?? [];
    const tipId = (await this.candidates(draft, ctx)).find(
      (id) => !this.memory.muted.includes(id) && !shownHere.includes(id),
    );
    if (!tipId) return null;

    this.memory.lastShownAt = ctx.now;
    this.memory.shownInChat[ctx.chatId] = [...shownHere, tipId];
    this.trimChats();
    this.bump(tipId, "shown");
    await this.persist();
    return this.buildSuggestion(tipId, draft, ctx);
  }

  buildSuggestion(tipId: TipId, draft: string, ctx: CoachContext): Suggestion {
    const tip = TIPS[tipId];
    const suggestion: Suggestion = {
      tipId,
      title: tip.title,
      noticed: tip.noticed,
      why: tip.why,
      chips: tip.chips,
      features: tip.features?.[ctx.site] ?? [],
    };
    if (tipId === "repeated-context") {
      const n = this.otherChatsWithContext(draft, ctx.chatId) + 1;
      suggestion.noticed = `You've given this same background in ${n} chats now.`;
    }
    if (tipId === "recurring-task") {
      const task = taskCategory(draft) ?? "task";
      const n = this.otherChatsWithTask(task, ctx.chatId) + 1;
      suggestion.noticed = `This is the ${ordinal(n)} chat where you've started a ${task} task.`;
    }
    const times = (this.memory.habitCounts[tipId] ?? 0) + 1;
    if (times >= SEEN_BEFORE_AT && tipId !== "repeated-context" && tipId !== "recurring-task") {
      suggestion.seenBefore = { times, line: `I've seen this one before. It's the ${ordinal(times)} time.` };
    }
    return suggestion;
  }

  /** Record a sent message: update habits, memory, and the "learned" metric. */
  async recordSend(text: string, ctx: CoachContext): Promise<{ learned: TipId[] }> {
    await this.ready;
    const learned: TipId[] = [];

    for (const id of detectDraft(text)) {
      this.memory.habitCounts[id] = (this.memory.habitCounts[id] ?? 0) + 1;
    }

    // Learned: the user wrote the habit themselves, without clicking the add-on this time,
    // after having used that add-on before.
    for (const id of this.memory.clickedEver) {
      const pattern = TIPS[id].learnPattern;
      if (pattern && pattern.test(text) && !this.clickedThisDraft.has(id)) {
        this.bump(id, "learned");
        learned.push(id);
      }
    }
    this.clickedThisDraft.clear();

    for (const fp of contextFingerprints(text)) {
      const match = this.memory.contexts.find((c) => similarity(c.fp, fp) >= CONTEXT_MATCH);
      if (match) {
        if (!match.chats.includes(ctx.chatId)) match.chats.push(ctx.chatId);
      } else {
        this.memory.contexts.push({ fp, chats: [ctx.chatId] });
      }
    }
    this.memory.contexts = this.memory.contexts.slice(-50);

    const task = taskCategory(text);
    if (task) {
      const chats = this.memory.tasks[task] ?? [];
      if (!chats.includes(ctx.chatId)) chats.push(ctx.chatId);
      this.memory.tasks[task] = chats.slice(-20);
    }

    await this.persist();
    return { learned };
  }

  async chipClicked(tipId: TipId) {
    await this.ready;
    this.clickedThisDraft.add(tipId);
    if (!this.memory.clickedEver.includes(tipId)) this.memory.clickedEver.push(tipId);
    this.bump(tipId, "chipClicks");
    await this.persist();
  }

  async dismissed(tipId: TipId) {
    await this.ready;
    this.bump(tipId, "dismissed");
    await this.persist();
  }

  async mute(tipId: TipId) {
    await this.ready;
    if (!this.memory.muted.includes(tipId)) this.memory.muted.push(tipId);
    await this.persist();
  }

  async reset() {
    this.memory = emptyMemory();
    this.clickedThisDraft.clear();
    await this.persist();
  }

  private otherChatsWithContext(text: string, chatId: string): number {
    const chats = new Set<string>();
    for (const fp of contextFingerprints(text)) {
      for (const c of this.memory.contexts) {
        if (similarity(c.fp, fp) >= CONTEXT_MATCH) c.chats.filter((id) => id !== chatId).forEach((id) => chats.add(id));
      }
    }
    return chats.size;
  }

  private otherChatsWithTask(task: string, chatId: string): number {
    return (this.memory.tasks[task] ?? []).filter((id) => id !== chatId).length;
  }

  private bump(tipId: TipId, key: keyof TipStats) {
    const s = (this.memory.stats[tipId] ??= { shown: 0, chipClicks: 0, dismissed: 0, learned: 0 });
    s[key]++;
  }

  private trimChats() {
    const keys = Object.keys(this.memory.shownInChat);
    for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete this.memory.shownInChat[k];
  }

  private persist() {
    return this.store.save(this.memory);
  }
}
