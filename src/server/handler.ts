import { TIPS } from "../core/library.js";
import type { TipId } from "../core/types";
import { MAX_DRAFT_CHARS, personalize, type Fetch, type GeminiEnv } from "./gemini.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

/** Best-effort per-instance limit so one visitor can't burn the free-tier quota. Resets when the instance restarts. */
const hits = new Map<string, number[]>();
const LIMIT = 8;
const WINDOW_MS = 60_000;

export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

/**
 * POST { draft, tipId } -> 200 { source: "gemini", noticed, why, chip? }
 * Any failure -> 200 { source: "built-in", reason } so the client shows the built-in tip, labeled.
 */
export async function handleCoach(req: Request, env: GeminiEnv, fetchImpl: Fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { draft?: unknown; tipId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { draft, tipId } = body;
  if (typeof draft !== "string" || !draft.trim() || draft.length > MAX_DRAFT_CHARS * 5) return json({ error: "Bad draft" }, 400);
  if (typeof tipId !== "string" || !(tipId in TIPS)) return json({ error: "Unknown tip" }, 400);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return json({ source: "built-in", reason: "rate-limited" });

  const r = await personalize(draft, tipId as TipId, env, fetchImpl);
  if (!r.ok) return json({ source: "built-in", reason: r.reason });
  return json({ source: "gemini", ...r.value });
}
