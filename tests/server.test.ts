import { describe, it } from "node:test";
import { expect } from "./expect";
import { handleCoach } from "../src/server/handler";
import { requestPersonalized } from "../src/core/personalize-client";
import type { Fetch } from "../src/server/gemini";
import type { Suggestion } from "../src/core/types";

const post = (body: unknown, ip = "1.1.1.1") =>
  new Request("https://wisp.test/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const geminiReply = (text: string, status = 200): Fetch =>
  (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status })) as unknown as Fetch;

const key = { GEMINI_API_KEY: "test-key" };

describe("POST /api/coach", () => {
  it("falls back to the built-in tip when no API key is set", async () => {
    const res = await handleCoach(post({ draft: "build me a website", tipId: "vague-build" }, "a"), {});
    expect(await res.json()).toEqual({ source: "built-in", reason: "no-key" });
  });

  it("returns Gemini's personalized tip when the reply is valid", async () => {
    const fake = geminiReply(JSON.stringify({ noticed: "N", why: "W", chip: { label: "L", insert: "I" } }));
    const res = await handleCoach(post({ draft: "build me a website", tipId: "vague-build" }, "b"), key, fake);
    expect(await res.json()).toEqual({ source: "gemini", noticed: "N", why: "W", chip: { label: "L", insert: "I" } });
  });

  it("falls back when Gemini returns junk or is rate-limited", async () => {
    let res = await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "c"), key, geminiReply("not json"));
    expect(await res.json()).toEqual({ source: "built-in", reason: "bad-response" });
    res = await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "d"), key, geminiReply("{}", 429));
    expect(await res.json()).toEqual({ source: "built-in", reason: "rate-limited" });
  });

  it("tries the backup model once when the main model is overloaded (503)", async () => {
    const urls: string[] = [];
    const good = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ noticed: "N", why: "W" }) }] } }] });
    const fake = (async (url: string) => {
      urls.push(url);
      return urls.length === 1 ? new Response("{}", { status: 503 }) : new Response(good, { status: 200 });
    }) as unknown as Fetch;
    const res = await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "g"), key, fake);
    expect(await res.json()).toEqual({ source: "gemini", noticed: "N", why: "W" });
    expect(urls.length).toBe(2);
    expect(urls[1].includes("/models/gemini-flash-latest:")).toBe(true);
  });

  it("shows 'busy' when both models are overloaded", async () => {
    let calls = 0;
    const fake = (async () => (calls++, new Response("{}", { status: 503 }))) as unknown as Fetch;
    const res = await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "h"), key, fake);
    expect(await res.json()).toEqual({ source: "built-in", reason: "rate-limited" });
    expect(calls).toBe(2);
  });

  it("falls back when the network call throws", async () => {
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as Fetch;
    const res = await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "e"), key, boom);
    expect(await res.json()).toEqual({ source: "built-in", reason: "error" });
  });

  it("rejects unknown tips and bad bodies", async () => {
    expect((await handleCoach(post({ draft: "x", tipId: "nope" }, "f"), key)).status).toBe(400);
    expect((await handleCoach(post({ tipId: "vague-fix" }, "g"), key)).status).toBe(400);
  });

  it("limits one visitor to a handful of calls per minute", async () => {
    const fake = geminiReply(JSON.stringify({ noticed: "N", why: "W" }));
    let last: { source?: string; reason?: string } = {};
    for (let i = 0; i < 10; i++) {
      last = await (await handleCoach(post({ draft: "fix it", tipId: "vague-fix" }, "same-ip"), key, fake)).json();
    }
    expect(last).toEqual({ source: "built-in", reason: "rate-limited" });
  });
});

describe("client fail-soft", () => {
  const s = { tipId: "vague-build" } as Suggestion;
  it("turns a network failure into a labeled built-in result", async () => {
    const r = await requestPersonalized("/api/coach", "x", s, async () => {
      throw new Error("offline");
    });
    expect(r).toEqual({ source: "built-in", reason: "offline" });
  });
});
