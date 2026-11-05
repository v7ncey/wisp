export type Site = "chatgpt" | "claude" | "demo";

/** What Wisp knows about the moment it is asked to look. */
export interface CoachContext {
  site: Site;
  /** Stable id for the current conversation (from the URL on real sites). */
  chatId: string;
  /** User messages already sent in this conversation, not counting the draft. */
  userMessageCount: number;
  /** Epoch ms. Injected so tests can control time. */
  now: number;
}

export type TipId =
  | "vague-build"
  | "paste-no-ask"
  | "vague-fix"
  | "facts-no-sources"
  | "no-example"
  | "repeated-context"
  | "long-drift"
  | "recurring-task";

/** A clickable add-on phrase that gets appended to the user's draft. */
export interface Chip {
  label: string;
  /** Text appended to the draft. Ends with a space/colon when the user should finish it. */
  insert: string;
}

/** A real product feature Wisp may point to. Kept with a "last checked" date because these change often. */
export interface Feature {
  name: string;
  site: Exclude<Site, "demo">;
  howTo: string;
  /** Plan or availability caveat, if any. */
  note?: string;
  url: string;
  lastChecked: string;
}

export interface Suggestion {
  tipId: TipId;
  title: string;
  /** One sentence on what Wisp noticed. */
  noticed: string;
  /** One sentence on why the tip helps. This is the teaching part. */
  why: string;
  chips: Chip[];
  features: Feature[];
  /** Set when Wisp has seen this habit before ("I've seen this before"). */
  seenBefore?: { times: number; line: string };
}
