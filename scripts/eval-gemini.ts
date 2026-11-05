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
  console.log("GEMINI_API_KEY isn't set, so the Gemini comparison was skipped. Nothing was written.");
  process.exit(0);
}

const PACE_MS = Number(process.env.PACE_MS ?? 6500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const out: Record<string, unknown> = { method: "gemini-vs-rules", model: env.GEMINI_MODEL || "gemini-flash-lite-latest", runAt: new Date().toISOString() };
for (const [name, file] of [["dev", "evals/prompts.json"], ["heldout", "evals/heldout.json"]] as const) {
  const { prompts } = JSON.parse(readFileSync(file, "utf8")) as { prompts: LabeledPrompt[] };
  const gemini = new Map<string, DraftDetectorId[]>();
  const latencies: number[] = [];
  let failures = 0;
  for (const [i, p] of prompts.entries()) {
    const t0 = Date.now();
    const r = await classify(p.text, env);
    latencies.push(Date.now() - t0);
    if (r.ok) gemini.set(p.text, r.value);
    else {
      failures++;
      gemini.set(p.text, []);
    }
    process.stdout.write(`\r${name}: ${i + 1}/${prompts.length} (failures ${failures})`);
    await sleep(PACE_MS);
  }
  const g = score(prompts, (t) => gemini.get(t) ?? []);
  const r = score(prompts, detectDraft);
  latencies.sort((a, b) => a - b);
  out[name] = {
    gemini: { ...g, failures, medianLatencyMs: latencies[Math.floor(latencies.length / 2)] },
    rules: { ...r, medianLatencyMs: 0 },
  };
  console.log(`\n${name}: Gemini stayed quiet ${g.quiet.correct}/${g.quiet.total}, rules ${r.quiet.correct}/${r.quiet.total}; Gemini mistakes ${g.mistakes.length}, rules ${r.mistakes.length}; Gemini failures ${failures}`);
}
writeFileSync("evals/gemini-comparison.json", JSON.stringify(out, null, 2) + "\n");
console.log("Wrote evals/gemini-comparison.json");
