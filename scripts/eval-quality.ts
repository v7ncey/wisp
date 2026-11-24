/**
 * Coaching-quality eval: does following Wisp's tip make the AI's reply better?
 *
 * For each case in evals/quality/<set>.json:
 *   1. Check Wisp's rules really flag the draft with the expected tip.
 *   2. "Original": the draft as typed. "With tip": the draft plus every add-on of that tip, with
 *      blanks filled from the case's details (what the person would type).
 *   3. A chat assistant (Gemini Flash-Lite, standing in for ChatGPT/Claude) replies to each.
 *      For tips whose add-ons tell the AI to ask questions first, a simulated person (who knows
 *      the hidden goal) replies once and the assistant answers again, on both sides.
 *   4. A stronger judge (Gemini Flash) sees only the hidden goal and the two final replies, never
 *      the prompts, and scores them on a fixed rubric, twice with the order swapped. "With tip"
 *      wins only if the judge prefers it in both orders; mixed verdicts count as ties.
 *
 * Backends: GEMINI_API_KEY (or GEMINI_KEY) calls Gemini directly. Otherwise WISP_EVAL_URL plus
 * WISP_EVAL_TOKEN runs each step through the deployed /api/eval endpoint.
 *
 * Run: npm run eval:quality -- --set heldout --label baseline
 *      npm run eval:quality -- --set heldout --label after --reuse evals/quality/heldout-baseline.json
 * --reuse keeps the "original" side's replies from an earlier run (the drafts are unchanged),
 * so only the "with tip" side is regenerated and re-judged.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { detectDraft } from "../src/core/detectors";
import { applyChips, type Details } from "../src/core/apply";
import { TIPS } from "../src/core/library";
import type { TipId } from "../src/core/types";
import type { GeminiResult, ThinkingLevel, Turn } from "../src/server/gemini";
import { ANSWER_MODEL, CRITERIA, JUDGE_MODEL, JUDGE_THINKING, JUDGE_SYSTEM, USER_SIM_SYSTEM, answer, judge, simulateUser, type Answer, type Judgement, type Scores } from "../src/server/quality";

export interface QualityCase {
  id: string;
  tip: TipId;
  prompt: string;
  goal: string;
  history?: Turn[];
  details?: Details;
}

/** Tips whose add-ons make the AI ask before answering, so they're judged after one exchange. */
export const TWO_TURN_TIPS: TipId[] = ["vague-build"];

interface Arm {
  prompt: string;
  turns: Turn[];
  final: string;
  /** Model versions Gemini reported for the replies (and simulated person) on this side. */
  models: string[];
}

interface Backend {
  answer(prompt: string, history: Turn[]): Promise<GeminiResult<Answer>>;
  user(goal: string, conversation: Turn[]): Promise<GeminiResult<Answer>>;
  judge(goal: string, a: string, b: string): Promise<GeminiResult<Judgement>>;
}

interface JudgeChoice {
  model?: string;
  thinking?: ThinkingLevel;
}

function directBackend(key: string, j: JudgeChoice): Backend {
  const env = { GEMINI_API_KEY: key };
  return {
    answer: (p, h) => answer(p, h, env),
    user: (g, c) => simulateUser(g, c, env),
    judge: (g, a, b) => judge(g, a, b, env, fetch, j),
  };
}

function remoteBackend(base: string, token: string, j: JudgeChoice): Backend {
  const call = async <T>(body: unknown): Promise<GeminiResult<T>> => {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/eval`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wisp-eval-token": token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 404) throw new Error("The eval endpoint answered 404: WISP_EVAL_TOKEN is wrong or not set on the server.");
      if (!res.ok) return { ok: false, reason: "error" };
      return (await res.json()) as GeminiResult<T>;
    } catch (e) {
      if ((e as Error).message.startsWith("The eval endpoint")) throw e;
      return { ok: false, reason: "timeout" };
    }
  };
  return {
    answer: (prompt, history) => call({ task: "answer", prompt, history }),
    user: (goal, conversation) => call({ task: "user", goal, conversation }),
    judge: (goal, a, b) => call({ task: "judge", goal, a, b, ...j }),
  };
}

interface CaseResult {
  id: string;
  tip: TipId;
  ruleFired: boolean;
  twoTurn: boolean;
  reusedOriginal: boolean;
  /** Copied unchanged from the --reuse run because neither prompt changed. */
  carriedOver?: boolean;
  verdict: Verdict;
  judgeAgreedWithItself: boolean;
  scores: { original: Scores; withTip: Scores };
  replyChars: { original: number; withTip: number };
  judgements: Array<Judgement & { order: string }>;
  original: Arm;
  withTip: Arm;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Standard error of the mean of paired differences. */
const stderr = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const avgScores = (a: Scores, b: Scores): Scores => Object.fromEntries(CRITERIA.map((c) => [c, (a[c] + b[c]) / 2])) as Scores;
const overall = (s: Scores) => mean(CRITERIA.map((c) => s[c]));

export type Verdict = "win" | "tie" | "loss";
/** j1 shows (original, with tip) as (A, B); j2 swaps them. */
export function verdict(j1: Judgement["preferred"], j2: Judgement["preferred"]): Verdict {
  if (j1 === "B" && j2 === "A") return "win";
  if (j1 === "A" && j2 === "B") return "loss";
  return "tie";
}

async function main() {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "heldout" },
      label: { type: "string", default: "baseline" },
      reuse: { type: "string" },
      only: { type: "string" },
      "judge-model": { type: "string" },
      "judge-thinking": { type: "string" },
    },
  });
  const set = values.set!;
  const cases = (JSON.parse(readFileSync(`evals/quality/${set}.json`, "utf8")) as { cases: QualityCase[] }).cases.filter(
    (c) => !values.only || values.only.split(",").includes(c.tip),
  );

  const key = process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY;
  const url = process.env.WISP_EVAL_URL;
  const token = process.env.WISP_EVAL_TOKEN;
  const judgeChoice: JudgeChoice = { model: values["judge-model"], thinking: values["judge-thinking"] as ThinkingLevel | undefined };
  const backend = key ? directBackend(key, judgeChoice) : url && token ? remoteBackend(url, token, judgeChoice) : null;
  if (!backend) {
    console.log("Set GEMINI_API_KEY (direct), or WISP_EVAL_URL and WISP_EVAL_TOKEN (through the deployed /api/eval). Nothing was run.");
    process.exit(0);
  }

  const PACE_MS = Number(process.env.PACE_MS ?? 4000);
  let calls = 0;
  let failedCalls = 0;
  async function step<T>(name: string, fn: () => Promise<GeminiResult<T>>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(PACE_MS * 2 ** attempt);
      calls++;
      const r = await fn();
      await sleep(PACE_MS);
      if (r.ok) return r.value;
      failedCalls++;
      console.warn(`  ${name} failed (${r.reason}), attempt ${attempt + 1}`);
    }
    throw new Error(`${name} failed 4 times`);
  }

  const reused = new Map<string, Arm>();
  const reusedRows = new Map<string, CaseResult>();
  if (values.reuse && existsSync(values.reuse)) {
    for (const c of JSON.parse(readFileSync(values.reuse, "utf8")).cases ?? []) {
      reused.set(c.id, c.original);
      reusedRows.set(c.id, c);
    }
  }

  async function runArm(c: QualityCase, prompt: string): Promise<Arm> {
    const history = c.history ?? [];
    const first = await step(`${c.id} answer`, () => backend!.answer(prompt, history));
    const turns: Turn[] = [{ role: "user", text: prompt }, { role: "model", text: first.text }];
    if (!TWO_TURN_TIPS.includes(c.tip)) return { prompt, turns, final: first.text, models: [first.model] };
    const reply = await step(`${c.id} person`, () => backend!.user(c.goal, [...history, ...turns]));
    const second = await step(`${c.id} answer 2`, () => backend!.answer(reply.text, [...history, ...turns]));
    turns.push({ role: "user", text: reply.text }, { role: "model", text: second.text });
    return { prompt, turns, final: second.text, models: [...new Set([first.model, reply.model, second.model])] };
  }

  const results: CaseResult[] = [];
  for (const [i, c] of cases.entries()) {
    console.log(`[${i + 1}/${cases.length}] ${c.id}`);
    const fired = detectDraft(c.prompt);
    const withTip = applyChips(c.prompt, TIPS[c.tip].chips, c.details ?? {});
    if (withTip === null) throw new Error(`${c.id}: a blank in ${c.tip}'s add-ons has no detail in the case`);

    // Nothing about this case changed since the reused run: carry its result over without new calls.
    const priorRow = reusedRows.get(c.id);
    if (priorRow && priorRow.original.prompt === c.prompt && priorRow.withTip.prompt === withTip) {
      console.log(`  carried over (${priorRow.verdict}): its add-ons didn't change`);
      results.push({ ...priorRow, carriedOver: true });
      continue;
    }
    const prior = reused.get(c.id);
    const original = prior && prior.prompt === c.prompt ? prior : await runArm(c, c.prompt);
    const tipped = await runArm(c, withTip);
    const j1 = await step(`${c.id} judge`, () => backend!.judge(c.goal, original.final, tipped.final));
    const j2 = await step(`${c.id} judge swapped`, () => backend!.judge(c.goal, tipped.final, original.final));
    const v = verdict(j1.preferred, j2.preferred);
    const scores = { original: avgScores(j1.a, j2.b), withTip: avgScores(j1.b, j2.a) };
    console.log(`  ${v}  overall ${round(overall(scores.original))} -> ${round(overall(scores.withTip))}`);
    results.push({
      id: c.id,
      tip: c.tip,
      ruleFired: (fired as TipId[]).includes(c.tip),
      twoTurn: TWO_TURN_TIPS.includes(c.tip),
      reusedOriginal: original === prior,
      verdict: v,
      judgeAgreedWithItself: v !== "tie" || (j1.preferred === "tie" && j2.preferred === "tie"),
      scores,
      replyChars: { original: original.final.length, withTip: tipped.final.length },
      judgements: [
        { order: "A=original, B=withTip", ...j1 },
        { order: "A=withTip, B=original", ...j2 },
      ],
      original,
      withTip: tipped,
    });
  }

  const summarize = (rows: CaseResult[]) => {
    const diffs = rows.map((r) => overall(r.scores.withTip) - overall(r.scores.original));
    return {
      n: rows.length,
      wins: rows.filter((r) => r.verdict === "win").length,
      ties: rows.filter((r) => r.verdict === "tie").length,
      losses: rows.filter((r) => r.verdict === "loss").length,
      meanOverall: { original: round(mean(rows.map((r) => overall(r.scores.original)))), withTip: round(mean(rows.map((r) => overall(r.scores.withTip)))) },
      pairedDelta: { mean: round(mean(diffs)), stderr: round(stderr(diffs)) },
      perCriterionDelta: Object.fromEntries(CRITERIA.map((k) => [k, round(mean(rows.map((r) => r.scores.withTip[k] - r.scores.original[k])))])),
      medianReplyChars: {
        original: rows.map((r) => r.replyChars.original).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
        withTip: rows.map((r) => r.replyChars.withTip).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
      },
    };
  };
  const tips = [...new Set(results.map((r) => r.tip))];
  const out = {
    method: "coaching-quality",
    set,
    label: values.label,
    runAt: new Date().toISOString(),
    command: `npm run eval:quality -- ${process.argv.slice(2).join(" ")}`.trim(),
    backend: key ? "direct" : "deployed /api/eval",
    models: {
      assistant: `${ANSWER_MODEL} (no thinking)`,
      simulatedPerson: `${ANSWER_MODEL} (no thinking)`,
      judge: results[0]?.judgements[0]?.model ?? `${judgeChoice.model ?? JUDGE_MODEL} (thinking ${judgeChoice.thinking ?? JUDGE_THINKING})`,
      resolvedVersions: [...new Set(results.flatMap((r) => [...r.original.models, ...r.withTip.models]))],
    },
    twoTurnTips: TWO_TURN_TIPS,
    rubric: JUDGE_SYSTEM,
    simulatedPersonInstructions: USER_SIM_SYSTEM,
    addOns: Object.fromEntries(tips.map((t) => [t, TIPS[t].chips])),
    modelCalls: { total: calls, failedAndRetried: failedCalls },
    carriedOver: results.filter((r) => r.carriedOver).map((r) => r.id),
    reusedFrom: values.reuse ?? null,
    summary: summarize(results),
    perTip: Object.fromEntries(tips.map((t) => [t, summarize(results.filter((r) => r.tip === t))])),
    cases: results,
  };
  const file = `evals/quality/${set}-${values.label}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  writeSummary(file);
  const s = out.summary;
  console.log(`\n${set}/${values.label}: with tip won ${s.wins}, tied ${s.ties}, lost ${s.losses} of ${s.n}. Overall ${s.meanOverall.original} -> ${s.meanOverall.withTip} (paired delta ${s.pairedDelta.mean} ± ${s.pairedDelta.stderr} SE). ${calls} model calls.`);
  console.log(`Wrote ${file}`);
}

/** A small copy without transcripts, for the demo page (the full file is ~100 KB). */
export function writeSummary(file: string) {
  const { cases, rubric, simulatedPersonInstructions, addOns, ...rest } = JSON.parse(readFileSync(file, "utf8"));
  const rows = (cases as CaseResult[]).map((c) => ({ id: c.id, tip: c.tip, verdict: c.verdict }));
  writeFileSync(file.replace(/\.json$/, ".summary.json"), JSON.stringify({ ...rest, cases: rows }, null, 2) + "\n");
}

if (process.argv[1]?.endsWith("eval-quality.ts")) {
  if (process.argv[2] === "--summarize") for (const f of process.argv.slice(3)) writeSummary(f);
  else await main();
}
