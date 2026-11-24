import { describe, it } from "node:test";
import { expect } from "./expect";
import { Coach } from "../src/core/engine";
import { InMemoryStore } from "../src/core/storage";
import { WispController } from "../src/ui/controller";
import type { WispUI } from "../src/ui/wisp-ui";

/** A stand-in for the pop-up that records what the controller asked it to do. */
function fakeUI() {
  const calls: string[] = [];
  const ui = {
    isOpen: false,
    currentTip: null,
    glance() {},
    toast(t: string) {
      calls.push(`toast:${t}`);
    },
    show(s: { tipId: string }) {
      calls.push(`show:${s.tipId}`);
    },
    applyPersonalization() {},
    hide() {},
  };
  return { ui: ui as unknown as WispUI, calls };
}

function setup(draft: () => string) {
  const { ui, calls } = fakeUI();
  const quiet: string[] = [];
  const coach = new Coach(new InMemoryStore(), { cooldownMs: 60_000 });
  let now = 1_000_000;
  const c = new WispController({
    coach,
    ui,
    editor: { getDraft: draft, insert: () => true },
    context: () => ({ site: "demo", chatId: "c1", userMessageCount: 0, now }),
    onQuiet: (why) => quiet.push(why),
  });
  return { c, calls, quiet, tick: (ms: number) => (now += ms) };
}

describe("controller: telling the demo when Wisp stays quiet", () => {
  it("reports 'clear' once per draft when no tip applies", async () => {
    let draft = "write an essay about climate change";
    const { c, calls, quiet } = setup(() => draft);
    await c.look();
    await c.look();
    expect(quiet).toEqual(["clear"]);
    expect(calls).toEqual([]);
    draft = "summarize the french revolution in 5 bullet points";
    await c.look();
    expect(quiet).toEqual(["clear", "clear"]);
  });

  it("reports 'waiting' when a tip applies but Wisp is holding off", async () => {
    let draft = "build me a website";
    const { c, calls, quiet, tick } = setup(() => draft);
    await c.look();
    expect(calls).toEqual(["show:vague-build"]);
    tick(5_000);
    draft = "fix it";
    await c.look();
    expect(quiet).toEqual(["waiting"]);
  });

  it("stays silent about silence when the page didn't ask (the extension)", async () => {
    const { ui, calls } = fakeUI();
    const c = new WispController({
      coach: new Coach(new InMemoryStore()),
      ui,
      editor: { getDraft: () => "hello there", insert: () => true },
      context: () => ({ site: "demo", chatId: "c1", userMessageCount: 0, now: 1 }),
    });
    await c.look();
    expect(calls).toEqual([]);
  });
});
