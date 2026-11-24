import type { Chip, Feature, Site, TipId } from "./types";

/**
 * Real features Wisp may point to. Plan availability differs between sources and changes
 * often, so notes stay general ("depends on your plan") instead of guessing a tier.
 * Re-check each entry and bump lastChecked before relying on it.
 */
export const FEATURES = {
  claudeProjects: {
    name: "Claude Projects",
    site: "claude",
    howTo: "Create a Project, then put your background in its instructions. Every chat inside it starts out knowing them.",
    note: "How many projects you get depends on your plan.",
    url: "https://support.claude.com/",
    lastChecked: "2026-11-05",
  },
  claudeSkills: {
    name: "Claude Skills",
    site: "claude",
    howTo: "Turn a task you repeat into a skill: saved instructions Claude loads when the task comes up. You can ask Claude to help you write one.",
    note: "Needs code execution turned on in settings. Availability depends on your plan.",
    url: "https://support.claude.com/en/articles/12512180-using-skills-in-claude",
    lastChecked: "2026-11-05",
  },
  chatgptCustomInstructions: {
    name: "ChatGPT custom instructions",
    site: "chatgpt",
    howTo: "In Settings → Personalization, tell ChatGPT about yourself once. It applies to every new chat.",
    url: "https://help.openai.com/",
    lastChecked: "2026-11-05",
  },
  chatgptProjects: {
    name: "ChatGPT Projects",
    site: "chatgpt",
    howTo: "Group related chats in a Project with its own instructions and files.",
    note: "Limits depend on your plan.",
    url: "https://help.openai.com/",
    lastChecked: "2026-11-05",
  },
  chatgptGpts: {
    name: "Custom GPTs",
    site: "chatgpt",
    howTo: "Save the instructions for a task you repeat as a custom GPT, then start that task from it.",
    note: "Creating one needs a paid plan; using shared ones does not.",
    url: "https://help.openai.com/",
    lastChecked: "2026-11-05",
  },
} satisfies Record<string, Feature>;

export interface TipDefinition {
  id: TipId;
  title: string;
  noticed: string;
  why: string;
  chips: Chip[];
  /** Matches when the user writes the habit themselves. Used for the "learned" metric. */
  learnPattern?: RegExp;
  features?: Partial<Record<Site, Feature[]>>;
}

const bothSites = (claude: Feature[], chatgpt: Feature[]): Partial<Record<Site, Feature[]>> => ({
  claude,
  chatgpt,
  demo: [...claude, ...chatgpt],
});

export const TIPS: Record<TipId, TipDefinition> = {
  "vague-build": {
    id: "vague-build",
    title: "Let it ask before it builds",
    noticed: "This is a short, open-ended request, so the AI will have to guess the details.",
    why: "A few questions up front mean it builds what you actually want, instead of a long guess you throw away.",
    // v2 of these add-ons (2026-11-24): the old second one, "show me a plan and wait for my OK", made the
    // AI stop at a plan and ask permission after the questions were answered, which lost on the
    // coaching-quality eval (evals/quality/dev-baseline.json). A first rewrite fixed the stalling but the
    // AI then asked shallow questions (currency, colors) and still lost (dev-after-try1.json), so the
    // first add-on now points the questions at what changes the build.
    chips: [
      {
        label: "Ask me what matters first",
        insert: "Before you start, ask me up to 3 questions whose answers would most change what you build, like who it's for, what it must do, and what I'll use to run or edit it.",
      },
      { label: "Then build it", insert: "Once I answer, give me a 3-line plan and then build it right away, without waiting for my OK." },
    ],
    learnPattern: /clarifying questions?|ask me (up to \d+ |a few |some |any )?(short )?questions|(show|give|make)( me)? a (short |\d-line )?plan|plan first/i,
  },
  "paste-no-ask": {
    id: "paste-no-ask",
    title: "Say what feedback you want",
    noticed: "You pasted a lot of text with a very short ask.",
    why: "\"Thoughts?\" tends to get generic praise. Naming the goal and the audience gets feedback you can act on.",
    chips: [
      { label: "Focus the feedback", insert: "Focus on clarity and structure, and list the 3 changes that would help most." },
      { label: "Name the audience", insert: "The audience for this is: ", fill: ["audience"] },
    ],
    learnPattern: /audience (is|for)|focus (on|your feedback)|the goal (is|of this)|feedback on (the )?(clarity|structure|tone|flow)/i,
  },
  "vague-fix": {
    id: "vague-fix",
    title: "Show it what went wrong",
    noticed: "\"Fix it\" without details means the AI has to guess what's broken.",
    why: "The exact error, or what you expected versus what happened, lets it fix the real problem on the first try.",
    chips: [
      { label: "Paste the exact error", insert: "Here's the exact error message: ", fill: ["error"] },
      { label: "Expected vs. actual", insert: "I expected ___, but instead ___.", fill: ["expected", "actual"] },
    ],
    learnPattern: /error message|i expected|expected .{0,60}(but|instead)/i,
  },
  "facts-no-sources": {
    id: "facts-no-sources",
    title: "Ask for sources",
    noticed: "You're asking for facts or numbers.",
    why: "AI can state made-up facts confidently. Sources let you check them, and asking it to flag uncertainty makes guesses visible.",
    chips: [{ label: "Ask for sources", insert: "Include sources I can check, and tell me when you're not sure." }],
    learnPattern: /\bsources?\b|\bcite\b|citations?|not sure|uncertain/i,
  },
  "no-example": {
    id: "no-example",
    title: "Show an example",
    noticed: "You're asking for writing with a particular style, but haven't shown what you like.",
    why: "Style is hard to describe and easy to show. One example gets closer than a paragraph of adjectives.",
    chips: [
      { label: "Add an example", insert: "Here's an example of the style I like: ", fill: ["example"] },
      { label: "Set a length", insert: "Keep it to about ___ words.", fill: ["words"] },
    ],
    learnPattern: /for example|an example|in the style of|match (this|the|my) tone|like this one/i,
  },
  "repeated-context": {
    id: "repeated-context",
    title: "Stop re-introducing yourself",
    noticed: "You've given this same background in other chats.",
    why: "Saved instructions mean every new chat already knows your background, so you type it once.",
    chips: [],
    features: bothSites([FEATURES.claudeProjects], [FEATURES.chatgptCustomInstructions, FEATURES.chatgptProjects]),
  },
  "long-drift": {
    id: "long-drift",
    title: "Start fresh with a summary",
    noticed: "This conversation is getting long.",
    why: "In very long chats, early details can get lost. A short summary in a new chat keeps what matters in focus.",
    chips: [{ label: "Summarize for a new chat", insert: "Summarize this conversation so far as a short brief I can paste into a new chat." }],
  },
  "recurring-task": {
    id: "recurring-task",
    title: "Make this reusable",
    noticed: "You've started this same kind of task in other chats.",
    why: "Saving the instructions once means you stop retyping them, and the results stay consistent.",
    chips: [],
    features: bothSites([FEATURES.claudeSkills, FEATURES.claudeProjects], [FEATURES.chatgptGpts, FEATURES.chatgptProjects]),
  },
};
