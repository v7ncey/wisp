import { describe, it } from "node:test";
import { expect } from "./expect";
import { Coach } from "../src/core/engine";
import { contextFingerprints, detectDraft, taskCategory } from "../src/core/detectors";
import { InMemoryStore } from "../src/core/storage";
import type { CoachContext } from "../src/core/types";

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
  site: "demo",
  chatId: "chat-1",
  userMessageCount: 0,
  now: 1_000_000,
  ...over,
});

describe("draft detectors", () => {
  it("flags a vague build request and stays quiet once clarifying questions are added", () => {
    expect(detectDraft("build me a website")).toContain("vague-build");
    expect(detectDraft("build me a website. Before you start, ask me clarifying questions.")).not.toContain("vague-build");
  });

  it("returns nothing for empty text", () => {
    expect(detectDraft("   ")).toEqual([]);
  });
});

describe("Coach pacing", () => {
  it("shows at most one tip per cooldown, unless forced", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 60_000 });
    expect(await coach.check("build me a website", ctx())).not.toBeNull();
    expect(await coach.check("fix it", ctx({ chatId: "chat-2", now: 1_030_000 }))).toBeNull();
    expect(await coach.check("fix it", ctx({ chatId: "chat-2", now: 1_030_000 }), { force: true })).not.toBeNull();
    expect(await coach.check("what percentage of people own a car", ctx({ chatId: "chat-3", now: 1_100_000 }))).not.toBeNull();
  });

  it("doesn't repeat the same tip in one chat", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    expect((await coach.check("build me a website", ctx()))?.tipId).toBe("vague-build");
    expect(await coach.check("build me a game", ctx({ now: 2_000_000 }))).toBeNull();
  });

  it("never shows a muted tip", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    await coach.mute("vague-build");
    expect(await coach.check("build me a website", ctx())).toBeNull();
  });
});

describe("Coach memory", () => {
  it("says it has seen a habit before from the third time", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    await coach.recordSend("fix it", ctx({ chatId: "a" }));
    await coach.recordSend("still broken", ctx({ chatId: "b" }));
    const s = await coach.check("doesn't work", ctx({ chatId: "c" }));
    expect(s?.seenBefore?.times).toBe(3);
    expect(s?.seenBefore?.line).toContain("3rd");
  });

  it("notices background repeated across chats and points to real features", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    const intro = "I'm a junior studying computer science at Pace and I want to be a product manager.";
    expect(contextFingerprints(intro).length).toBeGreaterThan(0);
    await coach.recordSend(`${intro} What classes should I take?`, ctx({ chatId: "a" }));
    const s = await coach.check(`${intro} How do I prep for interviews?`, ctx({ chatId: "b", site: "claude" }));
    expect(s?.tipId).toBe("repeated-context");
    expect(s?.noticed).toContain("2 chats");
    expect(s?.features.map((f) => f.name)).toContain("Claude Projects");
  });

  it("suggests making a recurring task reusable on the third chat", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    expect(taskCategory("write a cover letter for this job")).toBe("cover letter");
    await coach.recordSend("write a cover letter for this job: barista, I've worked 2 years", ctx({ chatId: "a" }));
    await coach.recordSend("cover letter for a library assistant role, I love books", ctx({ chatId: "b" }));
    const s = await coach.check("help with a cover letter for a museum job, I studied history", ctx({ chatId: "c", site: "chatgpt" }));
    expect(s?.tipId).toBe("recurring-task");
    expect(s?.features.map((f) => f.name)).toContain("Custom GPTs");
  });

  it("suggests a fresh chat when a conversation gets long", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    const s = await coach.check("ok now change the colors", ctx({ userMessageCount: 25 }));
    expect(s?.tipId).toBe("long-drift");
  });
});

describe("Coach metrics", () => {
  it("counts learned only when the habit is typed without clicking this time", async () => {
    const coach = new Coach(new InMemoryStore(), { cooldownMs: 0 });
    await coach.chipClicked("vague-build");
    let r = await coach.recordSend("build a site. Before you start, ask me clarifying questions", ctx());
    expect(r.learned).toEqual([]); // clicked during this draft
    r = await coach.recordSend("make an app for my club, ask me clarifying questions first", ctx({ chatId: "x" }));
    expect(r.learned).toEqual(["vague-build"]);
    const mem = await coach.snapshot();
    expect(mem.stats["vague-build"]).toMatchObject({ chipClicks: 1, learned: 1 });
  });

  it("persists across Coach instances via the store", async () => {
    const store = new InMemoryStore();
    const a = new Coach(store, { cooldownMs: 0 });
    await a.check("build me a website", ctx());
    await a.dismissed("vague-build");
    const b = new Coach(store);
    expect((await b.snapshot()).stats["vague-build"]).toMatchObject({ shown: 1, dismissed: 1 });
  });
});

