import type { Suggestion } from "./types";

export type PersonalizeOutcome =
  | { source: "gemini"; noticed: string; why: string; chip?: { label: string; insert: string } }
  | { source: "built-in"; reason: string };

/**
 * Asks the Wisp server to personalize a tip with Gemini. Never throws: any problem
 * (offline, slow, rate-limited, no key) comes back as { source: "built-in" } so the UI
 * keeps the built-in tip and labels it.
 */
export async function requestPersonalized(
  endpoint: string,
  draft: string,
  suggestion: Suggestion,
  post: (url: string, body: unknown) => Promise<unknown> = defaultPost,
): Promise<PersonalizeOutcome> {
  try {
    const data = (await post(endpoint, { draft, tipId: suggestion.tipId })) as Partial<PersonalizeOutcome> & Record<string, unknown>;
    if (data?.source === "gemini" && typeof data.noticed === "string" && typeof data.why === "string") {
      return data as PersonalizeOutcome;
    }
    return { source: "built-in", reason: typeof data?.reason === "string" ? data.reason : "error" };
  } catch {
    return { source: "built-in", reason: "offline" };
  }
}

async function defaultPost(url: string, body: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const FALLBACK_LABEL: Record<string, string> = {
  "no-key": "Built-in tip (AI personalization isn't set up)",
  "rate-limited": "Built-in tip (AI is busy right now)",
  timeout: "Built-in tip (AI took too long)",
  offline: "Built-in tip (couldn't reach the AI)",
  "bad-response": "Built-in tip (AI reply was unusable)",
  error: "Built-in tip (AI unavailable)",
};
