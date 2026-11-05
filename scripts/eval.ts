/**
 * Scores Wisp's rule-based draft detectors against the hand-labeled prompts in evals/prompts.json.
 * Writes evals/results.json (also shown on the demo page). Run: npm run eval
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DRAFT_DETECTOR_IDS, detectDraft, type DraftDetectorId } from "../src/core/detectors";

export interface LabeledPrompt {
  text: string;
  expect: DraftDetectorId[];
}

export interface DetectorScore {
  id: DraftDetectorId;
  truePos: number;
  falsePos: number;
  falseNeg: number;
  precision: number | null;
  recall: number | null;
}

export function score(prompts: LabeledPrompt[], predict: (text: string) => DraftDetectorId[]) {
  const perDetector: DetectorScore[] = [];
  const mistakes: Array<{ text: string; expected: string[]; got: string[] }> = [];
  const predictions = prompts.map((p) => predict(p.text));
  prompts.forEach((p, i) => {
    const got = predictions[i];
    const same = got.length === p.expect.length && got.every((g) => p.expect.includes(g));
    if (!same) mistakes.push({ text: p.text.slice(0, 90), expected: p.expect, got });
  });
  for (const id of DRAFT_DETECTOR_IDS) {
    let tp = 0, fp = 0, fn = 0;
    prompts.forEach((p, i) => {
      const exp = p.expect.includes(id);
      const got = predictions[i].includes(id);
      if (exp && got) tp++;
      else if (!exp && got) fp++;
      else if (exp && !got) fn++;
    });
    perDetector.push({
      id,
      truePos: tp,
      falsePos: fp,
      falseNeg: fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    });
  }
  const quiet = prompts.filter((p) => p.expect.length === 0);
  const quietCorrect = quiet.filter((p) => predict(p.text).length === 0).length;
  return { perDetector, mistakes, total: prompts.length, quiet: { total: quiet.length, correct: quietCorrect } };
}

const pct = (n: number | null) => (n === null ? "  n/a" : `${(n * 100).toFixed(0).padStart(4)}%`);

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^\/?/, "/")}` || process.argv[1]?.endsWith("eval.ts")) {
  const out: Record<string, unknown> = { method: "rules", runAt: new Date().toISOString().slice(0, 10) };
  for (const [name, file] of [["dev", "evals/prompts.json"], ["heldout", "evals/heldout.json"]] as const) {
    const { prompts } = JSON.parse(readFileSync(file, "utf8")) as { prompts: LabeledPrompt[] };
    const result = score(prompts, detectDraft);
    console.log(`\n== ${name}: rules vs. ${result.total} hand-labeled prompts ==`);
    console.log("detector           precision  recall   (TP/FP/FN)");
    for (const d of result.perDetector) {
      console.log(`${d.id.padEnd(18)} ${pct(d.precision)}     ${pct(d.recall)}    (${d.truePos}/${d.falsePos}/${d.falseNeg})`);
    }
    console.log(`Stayed quiet when it should: ${result.quiet.correct}/${result.quiet.total}`);
    if (result.mistakes.length) {
      console.log(`Mistakes (${result.mistakes.length}):`);
      for (const m of result.mistakes) console.log(`- "${m.text}"  expected [${m.expected}] got [${m.got}]`);
    }
    out[name] = { ...result, mistakes: result.mistakes };
  }
  writeFileSync("evals/results.json", JSON.stringify(out, null, 2) + "\n");
}
