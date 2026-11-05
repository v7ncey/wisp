import type { TipId } from "./types";

/** Draft-level detectors: they look only at the text being written. */
export type DraftDetectorId = Extract<TipId, "vague-build" | "paste-no-ask" | "vague-fix" | "facts-no-sources" | "no-example">;

export const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

const BUILD_VERB = /\b(build|make|create|code|develop|design|write|generate|program|set up)\b/i;
const BUILD_OBJECT =
  /\b(app|apps|website|site|web ?page|landing page|game|program|script|tool|bot|chatbot|dashboard|extension|api|project|plugin|startup|business plan|portfolio)\b/i;
/** Signs the user already gave details or asked for a plan. */
const HAS_SPECIFICS =
  /\b(using|with|in (python|javascript|typescript|react|java|c\+\+|swift|html)|that (lets|allows|can|has|shows|tracks)|which|should|must|needs? to|requirements?|features?)\b|clarifying|plan first|questions/i;
/** Questions about a topic, not requests to act. */
const QUESTION_START = /^(explain|what|how|why|who|when|where|is|are|does|do|should|which|tell me (about|why|how))\b/i;

function vagueBuild(text: string, wc: number): boolean {
  if (wc > 30 || QUESTION_START.test(text)) return false;
  if (!BUILD_VERB.test(text) || !BUILD_OBJECT.test(text)) return false;
  if (/\n\s*[-*\d]/.test(text)) return false; // bullet list of requirements
  return !HAS_SPECIFICS.test(text);
}

const SHORT_ASK =
  /(thoughts\??|what do you think\??|any feedback\??|feedback\??|review this\.?|check this\.?|look at this\.?|is this good\??|thoughts on this\??|improve this\.?|make (it|this) better\.?|fix this\.?|rate this\.?|opinions?\??)\s*$/i;
const HAS_FEEDBACK_GOAL = /\b(audience|focus on|the goal|tone|clarity|structure|grammar|shorter|longer|formal|casual|recruiter|professor|teacher|manager)\b/i;

function pasteNoAsk(text: string, wc: number): boolean {
  if (wc < 120) return false;
  const lines = text.trim().split(/\n/).filter((l) => l.trim());
  const firstLine = lines[0] ?? "";
  const lastLine = lines[lines.length - 1] ?? "";
  // The instruction is usually the first or last short line around the paste.
  const asks = [firstLine, lastLine].filter((l) => words(l).length <= 12);
  if (asks.some((l) => HAS_FEEDBACK_GOAL.test(l))) return false;
  if (asks.some((l) => SHORT_ASK.test(l.trim()))) return true;
  // No instruction at all: a long paste with no question mark anywhere near the edges.
  const edges = `${firstLine} ${lastLine}`;
  return !/[?]/.test(edges) && !/\b(please|can you|could you|help me|summari[sz]e|translate|rewrite|explain|edit)\b/i.test(text.slice(0, 200) + text.slice(-200));
}

const FIX_PHRASE =
  /\b(fix (it|this|that)|(it|this|that)('s| is)? (still )?(not working|doesn't work|does not work|broken|wrong)|(it|this) (still )?(doesn't|does not|won't) work|still broken|still (doesn't|not) work(ing)?|that'?s wrong|not working|doesn'?t work|try again|didn'?t work|it broke)\b/i;
const HAS_DETAIL = /error|exception|traceback|expected|instead|line \d+|undefined|null|\bat \w+\(|```|returns?|output|shows?|says?/i;

function vagueFix(text: string, wc: number): boolean {
  if (wc > 25 || /^(what|how|why|when|where|who)\b/i.test(text)) return false;
  return FIX_PHRASE.test(text) && !HAS_DETAIL.test(text);
}

const FACT_ASK =
  /\b((statistics?|stats|numbers|data) (on|about|for)|percent(age)?|how many|how much (does|did|do|is)|what year|studies|study shows|research (on|shows|says)|data on|facts? (about|on)|evidence|according to|market size|average (salary|cost|price)|population of|when (did|was)|who (invented|discovered|founded))\b/i;
const HAS_SOURCE_ASK = /\b(sources?|cite|citations?|references?|links?|not sure|uncertain|verify)\b/i;

function factsNoSources(text: string, wc: number): boolean {
  if (wc > 80) return false;
  return FACT_ASK.test(text) && !HAS_SOURCE_ASK.test(text);
}

const STYLE_WRITING =
  /\b(write|draft|compose|create|make)\b.{0,40}\b(cover letter|email|linkedin post|post|caption|bio|tagline|slogan|tweet|speech|toast|poem|ad|product description|announcement|newsletter|personal statement|about me|instagram|tiktok script)\b/i;
const HAS_STYLE_GUIDE =
  /\b(example|like this|in the style|tone|voice|casual|formal|friendly|professional|funny|witty|short|brief|words|sentences|similar to|here'?s (my|the|what))\b/i;

function noExample(text: string, wc: number): boolean {
  if (wc > 40) return false;
  return STYLE_WRITING.test(text) && !HAS_STYLE_GUIDE.test(text);
}

const DRAFT_DETECTORS: Array<[DraftDetectorId, (text: string, wc: number) => boolean]> = [
  // Order = priority when several fire.
  ["vague-fix", vagueFix],
  ["paste-no-ask", pasteNoAsk],
  ["vague-build", vagueBuild],
  ["facts-no-sources", factsNoSources],
  ["no-example", noExample],
];

export const DRAFT_DETECTOR_IDS: DraftDetectorId[] = DRAFT_DETECTORS.map(([id]) => id);

/** Every draft detector that fires on this text, highest priority first. */
export function detectDraft(text: string): DraftDetectorId[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const wc = words(trimmed).length;
  return DRAFT_DETECTORS.filter(([, fn]) => fn(trimmed, wc)).map(([id]) => id);
}

/* ---------- Memory-based signals ---------- */

const CONTEXT_SENTENCE =
  /\b(i'?m an? |i am an? |i work (as|at|in)|i'?m working on|i am working on|my (project|startup|company|class|course|major|job|team|business) (is|are)|for context|about me|i study|i'?m studying|i'?m a (student|junior|senior|freshman|sophomore))/i;

const STOP = new Set("a an the i i'm im am is are my at in on for of to and as with this that it we our".split(" "));

/** Background sentences the user tends to repeat, reduced to word sets for fuzzy matching. */
export function contextFingerprints(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => CONTEXT_SENTENCE.test(s))
    .map((s) =>
      words(s)
        .filter((w) => !STOP.has(w))
        .slice(0, 14)
        .join(" "),
    )
    .filter((fp) => fp.split(" ").length >= 3);
}

export function similarity(a: string, b: string): number {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

const TASKS: Array<[string, RegExp]> = [
  ["cover letter", /\bcover letters?\b/i],
  ["summary", /\b(summari[sz]e|summary of|tl;?dr)\b/i],
  ["email reply", /\b(reply to|respond to|write|draft) (this|an?|the) (email|message)\b/i],
  ["study material", /\b(flashcards?|quiz me|study guide|practice questions)\b/i],
  ["social post", /\b(linkedin|instagram|tiktok|twitter|x) (post|caption|script)\b/i],
  ["meeting notes", /\b(meeting notes|action items|minutes from)\b/i],
];

export function taskCategory(text: string): string | null {
  for (const [name, re] of TASKS) if (re.test(text)) return name;
  return null;
}

export const LONG_CHAT_MESSAGES = 20;
