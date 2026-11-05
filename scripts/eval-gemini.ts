/**
 * Compares Gemini-as-detector with the rules on the same labeled prompts.
 * Needs GEMINI_API_KEY in the environment; without it, it says so and exits.
 * Paced for the free tier. Run: npm run eval:gemini
 */
import { readFileSync, writeFileSync } from "node:fs";
import { classify } from "../src/server/gemini";
import { detectDraft, type DraftDetectorId } from "../src/core/detectors";
import { score, type LabeledPrompt } from "./eval";

const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GEMINI_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL };
if (!env.GEMINI_API_KEY) {
  console.log("GEMINI_API_KEY (or GEMINI_KEY) isn't set, so the Gemini comparison was skipped. Nothing was written. Put it in .env.local (git ignores it).");
  process.exit(0);
}

const PACE_MS = Number(process.env.PACE_MS ?? 6500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const out: Record<string, unknown> = { method: "gemini-vs-rules", model: env.GEMINI_MODEL || "gemini-flash-lite-latest", runAt: new Date().toISOString() };
for (const [name, file] of [["dev", "evals/prompts.json"], ["heldout", "evals/heldout.json"]] as const) {
  const { prompts } = JSON.parse(readFileSync(file, "utf8")) as { prompts: LabeledPrompt[] };
  const gemini = new Map<string, DraftDetectorId[]>();
  const latencies: number[] = [];
  const failed: string[] = [];
  for (const [i, p] of prompts.entries()) {
    // Retry Google's transient errors (busy, timeout) so they aren't scored as "stayed quiet".
    const t0 = Date.now();
    let r = await classify(p.text, env);
    if (r.ok) latencies.push(Date.now() - t0);
    for (let attempt = 1; !r.ok && attempt <= 3; attempt++) {
      await sleep(PACE_MS * attempt);
      const t1 = Date.now();
      r = await classify(p.text, env);
      if (r.ok) latencies.push(Date.now() - t1);
    }
    if (r.ok) gemini.set(p.text, r.value);
    else failed.push(p.text);
    process.stdout.write(`\r${name}: ${i + 1}/${prompts.length} (unanswered ${failed.length})`);
    await sleep(PACE_MS);
  }
  // Score both on the same prompts: the ones Gemini actually answered.
  const answered = prompts.filter((p) => gemini.has(p.text));
  const g = score(answered, (t) => gemini.get(t) ?? []);
  const r = score(answered, detectDraft);
  const failures = failed.length;
  latencies.sort((a, b) => a - b);
  out[name] = {
    scoredOn: answered.length,
    of: prompts.length,
    gemini: { ...g, unanswered: failures, medianLatencyMs: latencies[Math.floor(latencies.length / 2)] },
    rules: r,
  };
  console.log(`\n${name}: Gemini stayed quiet ${g.quiet.correct}/${g.quiet.total}, rules ${r.quiet.correct}/${r.quiet.total}; Gemini mistakes ${g.mistakes.length}, rules ${r.mistakes.length}; Gemini failures ${failures}`);
}
writeFileSync("evals/gemini-comparison.json", JSON.stringify(out, null, 2) + "\n");
console.log("Wrote evals/gemini-comparison.json");
