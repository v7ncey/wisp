import { timingSafeEqual } from "node:crypto";
import type { Fetch, GeminiEnv, Turn } from "./gemini.js";
import { answer, judge, simulateUser } from "./quality.js";

/**
 * POST /api/eval: runs one step of the coaching-quality eval on the server, where the Gemini key
 * lives. Closed unless WISP_EVAL_TOKEN is set, and then only for requests carrying that token, so
 * it can't be used as a free Gemini proxy. The public coach endpoint is unaffected.
 *
 * { task: "answer", prompt, history? }  -> { ok: true, value: { text, model } }
 * { task: "judge", goal, a, b }         -> { ok: true, value: Judgement }
 * { task: "user", goal, conversation }  -> { ok: true, value: { text, model } }  (the simulated person's next message)
 * Gemini failures come back as { ok: false, reason } with status 200 so the script can retry.
 */
export interface EvalEnv extends GeminiEnv {
  WISP_EVAL_TOKEN?: string;
}

const MAX_FIELD = 12_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const text = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= MAX_FIELD ? v : null);

function parseHistory(v: unknown, max = 6): Turn[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const turns: Turn[] = [];
  for (const t of v) {
    const role = (t as Turn)?.role;
    const body = text((t as Turn)?.text);
    if ((role !== "user" && role !== "model") || !body) return null;
    turns.push({ role, text: body });
  }
  return turns;
}

export async function handleEval(req: Request, env: EvalEnv, fetchImpl: Fetch = fetch): Promise<Response> {
  // Look like a missing route unless the eval is switched on and the caller has the token.
  if (!tokenMatches(req.headers.get("x-wisp-eval-token"), env.WISP_EVAL_TOKEN)) return json({ error: "Not found" }, 404);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.task === "answer") {
    const prompt = text(body.prompt);
    const history = parseHistory(body.history);
    if (!prompt || !history) return json({ error: "Bad answer request" }, 400);
    return json(await answer(prompt, history, env, fetchImpl));
  }
  if (body.task === "judge") {
    const goal = text(body.goal);
    const a = text(body.a);
    const b = text(body.b);
    if (!goal || !a || !b) return json({ error: "Bad judge request" }, 400);
    return json(await judge(goal, a, b, env, fetchImpl));
  }
  if (body.task === "user") {
    const goal = text(body.goal);
    const conversation = parseHistory(body.conversation, 8);
    if (!goal || !conversation?.length) return json({ error: "Bad user request" }, 400);
    return json(await simulateUser(goal, conversation, env, fetchImpl));
  }
  return json({ error: "Unknown task" }, 400);
}
