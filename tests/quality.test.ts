import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { expect } from "./expect";
import { appendAddOn, applyChips, fillChip } from "../src/core/apply";
import { detectDraft } from "../src/core/detectors";
import { TIPS } from "../src/core/library";
import { handleEval, tokenMatches } from "../src/server/eval-handler";
import { judge } from "../src/server/quality";
import type { Fetch } from "../src/server/gemini";
import { verdict, type QualityCase } from "../scripts/eval-quality";

const TOKEN = "t".repeat(32);
const geminiText = (text: string): Fetch =>
  (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], modelVersion: "fake-model" }))) as unknown as Fetch;
const evalReq = (body: unknown, token: string | null = TOKEN) =>
  new Request("https://wisp.test/api/eval", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-wisp-eval-token": token } : {}) },
    body: JSON.stringify(body),
  });

describe("applying add-ons", () => {
  it("appends like the editor does: a period only when the draft doesn't end a sentence", () => {
    expect(appendAddOn("build me a website", "Ask first.")).toBe("build me a website. Ask first.");
    expect(appendAddOn("fix it!", "Ask first.")).toBe("fix it! Ask first.");
    expect(appendAddOn("  ", "Ask first.")).toBe("Ask first.");
  });

  it("fills ___ blanks in order and trailing-colon blanks at the end", () => {
    const [error, expectedActual] = TIPS["vague-fix"].chips;
    expect(fillChip(expectedActual, { expected: "a list", actual: "a blank page" })).toBe("I expected a list, but instead a blank page.");
    expect(fillChip(error, { error: "TypeError: x" })).toBe("Here's the exact error message: TypeError: x");
  });

  it("refuses to produce a prompt with a blank left unfilled", () => {
    expect(fillChip(TIPS["vague-fix"].chips[1], { expected: "a list" })).toBe(null);
    expect(applyChips("fix it", TIPS["vague-fix"].chips, {})).toBe(null);
  });

  it("marks every add-on that has a blank, so the UI and the eval know about it", () => {
    for (const tip of Object.values(TIPS)) {
      for (const chip of tip.chips) {
        const blanks = chip.insert.split("___").length - 1;
        const trailing = /:\s*$/.test(chip.insert) ? 1 : 0;
        expect(chip.fill?.length ?? 0).toBe(blanks || trailing);
      }
    }
  });
});

describe("coaching-quality eval cases", () => {
  for (const set of ["heldout", "dev"]) {
    const { cases } = JSON.parse(readFileSync(`evals/quality/${set}.json`, "utf8")) as { cases: QualityCase[] };
    it(`${set}: every draft is flagged by Wisp's rules with its tip, and every blank has a detail`, () => {
      for (const c of cases) {
        expect(detectDraft(c.prompt)).toContain(c.tip);
        expect(applyChips(c.prompt, TIPS[c.tip].chips, c.details ?? {})).not.toBeNull();
      }
    });
  }

  it("ids are unique across both sets", () => {
    const ids = ["heldout", "dev"].flatMap((s) => (JSON.parse(readFileSync(`evals/quality/${s}.json`, "utf8")) as { cases: QualityCase[] }).cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("verdicts", () => {
  it("counts a win or loss only when the judge agrees with itself in both orders", () => {
    expect(verdict("B", "A")).toBe("win");
    expect(verdict("A", "B")).toBe("loss");
    expect(verdict("B", "B")).toBe("tie"); // position bias, not a preference
    expect(verdict("tie", "A")).toBe("tie");
  });
});

describe("POST /api/eval", () => {
  it("is closed unless a long token is configured and sent", async () => {
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
    expect(tokenMatches("short", "short")).toBe(false);
    expect(tokenMatches(null, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect((await handleEval(evalReq({ task: "answer", prompt: "hi" }), {})).status).toBe(404);
    expect((await handleEval(evalReq({ task: "answer", prompt: "hi" }, "wrong".padEnd(32, "x")), { WISP_EVAL_TOKEN: TOKEN })).status).toBe(404);
    expect((await handleEval(evalReq({ task: "answer", prompt: "hi" }, null), { WISP_EVAL_TOKEN: TOKEN })).status).toBe(404);
  });

  it("answers, plays the person and judges when authorized", async () => {
    const env = { WISP_EVAL_TOKEN: TOKEN, GEMINI_API_KEY: "k" };
    const a = await (await handleEval(evalReq({ task: "answer", prompt: "hi" }), env, geminiText("Hello!"))).json();
    expect(a).toEqual({ ok: true, value: { text: "Hello!", model: "fake-model" } });
    const u = await (await handleEval(evalReq({ task: "user", goal: "g", conversation: [{ role: "user", text: "hi" }] }), env, geminiText("PERSON: Thanks"))).json();
    expect(u).toEqual({ ok: true, value: { text: "Thanks", model: "fake-model" } });
  });

  it("rejects malformed requests", async () => {
    const env = { WISP_EVAL_TOKEN: TOKEN, GEMINI_API_KEY: "k" };
    expect((await handleEval(evalReq({ task: "answer" }), env)).status).toBe(400);
    expect((await handleEval(evalReq({ task: "answer", prompt: "x", history: [{ role: "system", text: "x" }] }), env)).status).toBe(400);
    expect((await handleEval(evalReq({ task: "nope" }), env)).status).toBe(400);
  });
});

describe("judge replies", () => {
  const env = { GEMINI_API_KEY: "k" };
  const s = { fit: 4, assumptions: 5, actionability: 3, trust: 3 };
  it("accepts a complete rubric", async () => {
    const r = await judge("g", "a", "b", env, geminiText(JSON.stringify({ a: s, b: s, preferred: "tie", reason: "same" })));
    expect(r.ok).toBe(true);
  });
  it("rejects out-of-range or missing scores and unknown verdicts", async () => {
    expect((await judge("g", "a", "b", env, geminiText(JSON.stringify({ a: { ...s, fit: 9 }, b: s, preferred: "A" })))).ok).toBe(false);
    expect((await judge("g", "a", "b", env, geminiText(JSON.stringify({ a: s, preferred: "A" })))).ok).toBe(false);
    expect((await judge("g", "a", "b", env, geminiText(JSON.stringify({ a: s, b: s, preferred: "C" })))).ok).toBe(false);
  });
});

describe("judge configuration", () => {
  const s = { fit: 3, assumptions: 3, actionability: 3, trust: 3 };
  const capture = () => {
    const sent: Array<{ url: string; body: { generationConfig: Record<string, unknown> } }> = [];
    const f = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ a: s, b: s, preferred: "tie" }) }] } }] }));
    }) as unknown as Fetch;
    return { sent, f };
  };

  it("defaults to Flash-Lite with high thinking, and records it", async () => {
    const { sent, f } = capture();
    const r = await judge("g", "a", "b", { GEMINI_API_KEY: "k" }, f);
    expect(sent[0].url.includes("/models/gemini-flash-lite-latest:")).toBe(true);
    expect(sent[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
    expect(r.ok && r.value.model).toBe("gemini-flash-lite-latest (thinking high)");
  });

  it("only lets the eval pick judge models from the allowlist", async () => {
    const { sent, f } = capture();
    await judge("g", "a", "b", { GEMINI_API_KEY: "k" }, f, { model: "some-expensive-model" });
    expect(sent[0].url.includes("/models/gemini-flash-lite-latest:")).toBe(true);
    await judge("g", "a", "b", { GEMINI_API_KEY: "k" }, f, { model: "gemini-flash-latest", thinking: "low" });
    expect(sent[1].url.includes("/models/gemini-flash-latest:")).toBe(true);
    expect(sent[1].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });
});
