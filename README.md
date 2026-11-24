# Wisp

A small companion that watches how you prompt AI chat assistants and pops up with tips you can click to apply.

**Try it (no sign-in, no install):** https://wisp-coach.vercel.app

Wisp is for people who are new to AI. When you pause typing a prompt, it checks your draft for a few common habits. If one shows up, Wisp peeks in from the edge of the screen, says what it noticed, explains *why* the fix helps, and offers add-ons you can click to append to your prompt. The idea comes from the "something is watching you" feeling of the Minecraft mod Verity, minus the horror.

## What it does

| Habit | What Wisp suggests |
|---|---|
| A vague "build me X" | Ask the AI a few questions about what matters, then build |
| A long paste plus "thoughts?" | Say what kind of feedback you want and who it's for |
| "Fix it" with no details | Paste the exact error, or say what you expected |
| Asking for facts or numbers | Ask for sources and for it to flag uncertainty |
| Style-dependent writing with no example | Show an example, set a length |
| The same background typed in several chats | Claude Projects, ChatGPT custom instructions or Projects |
| The same kind of task across chats | Claude Skills, custom GPTs, Projects |
| A very long conversation | Start fresh with a summary |

Behaviors:

- **Rare on purpose.** At most one tip every 3 minutes, never mid-typing, never the same tip twice in one chat, and any tip can be turned off. (The demo page shortens the 3 minutes to a few seconds.)
- **"I've seen this before."** From the third time a habit shows up, Wisp says so.
- **Teaches, doesn't just rewrite.** Every add-on comes with the reason it helps. When you start writing the habit yourself without clicking, Wisp counts it as "did it yourself," which is the metric that matters.
- **Memory stays on your device.** It lives in `localStorage` (demo) or `chrome.storage.local` (extension).

## AI, and what happens when it's down

The detectors are plain rules and need no AI. Optionally, Gemini rewrites a tip so it refers to your specific draft and suggests one extra add-on. If Gemini has no key, is slow, is rate-limited or returns something unusable, Wisp keeps the built-in tip and labels it, for example "Built-in tip (AI is busy right now)". In the extension, AI personalization is **off until you turn it on**.

Your draft is treated as data, not instructions, in the Gemini prompt, and replies are validated before they're shown.

## How accurate are the rules?

`npm run eval` scores the detectors against hand-labeled prompts:

- `evals/prompts.json` (82 prompts): the set I tuned the rules against. It looks great, which is why it doesn't count.
- `evals/heldout.json` (40 prompts): written after the rules were frozen and scored once, without tuning. This is the honest number.

Both sets were written by me, so they share my blind spots. Real user prompts are the next step.

### Rules vs. Gemini as the detector

`npm run eval:gemini` asks Gemini (`gemini-flash-lite-latest`, which resolved to Gemini 3.5 Flash-Lite) to label the same prompts. It needs `GEMINI_KEY` or `GEMINI_API_KEY` in `.env.local`. Results from one run on 2026-11-05 are in `evals/gemini-comparison.json`.

On the 40 held-out prompts (Gemini answered all 40, median about 1.2 s):

| | Rules | Gemini |
|---|---|---|
| Mistakes | 7 | 13 |
| Stayed quiet when it should | 14 / 17 | 10 / 17 |
| "Vague project" false alarms | 3 | 9 |
| Missed "ask for sources" / "show an example" | 1 / 1 | 2 / 3 |
| Missed "fix it" | 1 | 0 |

Gemini over-flags "vague project", for example on "what should I name my startup" and "help me pick between two job offers". Some of its other "mistakes" are arguable labels of mine, like whether "code a calculator" needs a tip. I left the labels as written instead of relabeling after seeing the results. The Gemini classifier prompt was not tuned at all, so this compares tuned rules with an untuned model, not the best Gemini could do.

What it changed: the rules stay in charge of *when* Wisp speaks, which is also free, instant and works offline. Gemini is used only to reword a tip that already fired. The dev-set comparison is in the JSON too, but the rules were tuned on that set, so it isn't a fair contest.

## Do the tips actually help? (coaching-quality eval)

Spotting a habit correctly is only half the job. The other half is whether following the tip gets a better answer. `npm run eval:quality` checks that:

1. Each case in `evals/quality/heldout.json` (15 cases, 3 per draft tip) is a draft Wisp's rules flag, the goal the person really had, and the details they'd type into an add-on's blanks.
2. The draft is answered twice by Gemini Flash-Lite, standing in for ChatGPT or Claude: once as typed, and once with every add-on of the tip applied and filled in.
3. For "Let it ask before it builds", whose add-ons make the AI ask questions first, a simulated person who knows the goal replies once, and the AI answers again. Both sides get the same number of turns.
4. A judge sees only the goal and the two final replies, never the prompts. It scores them on a fixed rubric (fit, wrong assumptions, actionability, trust) and picks one. It runs twice with the order swapped, and a win counts only if both orders agree.

Results from 2026-11-24, held-out set, after the one change described below (`evals/quality/heldout-after.json`):

| Tip | Better with tip | Same | Worse |
|---|---|---|---|
| Show it what went wrong | 2 | 0 | 1 |
| Ask for sources | 2 | 1 | 0 |
| Show an example | 2 | 1 | 0 |
| Say what feedback you want | 2 | 1 | 0 |
| Let it ask before it builds | 0 | 1 | 2 |
| **All 15** | **8** | **4** | **3** |

The judge's average score went from 3.71 to 4.03 out of 5 (paired difference +0.33, standard error 0.30). Before the change (`heldout-baseline.json`) it was 9 better, 4 same, 2 worse.

What changed: on the dev set (`evals/quality/dev.json`, 10 cases), the old second add-on of "Let it ask before it builds", "show me a plan and wait for my OK", made the AI stop at a plan and ask permission after its questions were answered. It lost both dev cases. A first rewrite (`dev-after-try1.json`) fixed the stall, but the AI then asked shallow questions such as currency and color scheme, and it still lost. The second rewrite steers the questions toward what changes the build and then builds right away. It went 1-1 on dev, so it shipped, and the held-out set was scored once. There it went 0 wins, 1 tie, 2 losses (before: 1-1-1). Those losses come from things outside the tip: a bug in generated code, raw HTML handed to someone who can't code, and long replies cut off at the length limit. So this eval can't show that the tip helps, and it stays a hypothesis. The other four tips were better in 8 of their 12 held-out cases and worse in 1.

Caveats, read before quoting any of this:
- Gemini stands in for ChatGPT and Claude, and the judge is also Gemini. The plan was Gemini Flash as the judge, but on run day it was overloaded and Pro had no free quota. So the judge is Flash-Lite with "high" thinking, while the assistant runs with no thinking. Same-family judging can't be ruled out as a bias, though both replies come from the same model.
- The cases were written by the builder (with an AI agent), not by users. 15 held-out cases can only show large effects.
- Judges tend to favor longer replies. With "Ask for sources" the replies were about 4 times longer, so part of that win may be length. Each results file records reply lengths.
- Asking for sources without web search can produce made-up citations, and this judge can't check links.

Re-run it: put `GEMINI_API_KEY` in `.env.local` and run `npm run eval:quality -- --set heldout --label baseline`. To reuse the "as typed" replies from an earlier run, add `--reuse evals/quality/heldout-baseline.json`. Use `--judge-model gemini-flash-latest` once Flash isn't overloaded. One full held-out run is about 75 model calls. Without a key, the script can call the deployed `/api/eval` instead, which is closed unless the server has `WISP_EVAL_TOKEN` set and the caller sends it.

## Project layout

```
src/core/       detectors, tip library, coach engine, memory (shared)
src/ui/         Wisp's pop-up (shadow DOM) and the controller that wires it to a text box
src/demo/       the demo page
src/extension/  Chrome extension: per-site selectors, content script, background worker
src/server/     Gemini calls, the /api/coach handler, and the coaching-quality eval steps
api/coach.ts    Vercel function (public)
api/eval.ts     Vercel function for the eval (closed without WISP_EVAL_TOKEN)
evals/          labeled prompts and results
```

## Run it

```bash
npm install
npm test          # unit tests (Node's built-in runner)
npm run eval      # detector precision/recall
npm run eval:quality -- --set heldout --label baseline   # do the tips improve answers? (needs a Gemini key)
npm run build     # bundles demo + extension, zips the extension into public/
npx tsx scripts/serve.ts   # local demo on http://localhost:5178
```

To load the extension: run `npm run build`, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick the `extension/` folder.

## Known limits

- The extension reads ChatGPT's and Claude's pages using CSS selectors (`src/extension/sites.ts`). When those stop matching, it falls back to generic signals (a `role=textbox` editor, a box labeled "message"/"prompt"/"ask", then the largest editable box near the bottom) and counts a send when the draft clears after Enter or a button click. If it still can't find the chat box for about 10 seconds, the orb says so once and links to GitHub issues; the stats panel shows whether Wisp is using the normal or the backup way. `npm run eval:extension -- --label <name>` checks this against 15 fixture pages in `tests/fixtures/sites` (5 documented shapes, 10 hypothetical) in headless Chromium; results are in `evals/extension/`: on the code before this change (`baseline-v1-code.json`), Wisp fully worked on 4 of 15 variants and told the user nothing on the other 11; after it (`after-merge.json`), 14 of 15, and it shows the notice on the one it can't handle (a chat box inside an iframe, which the content script can't reach). `baseline.json`/`after.json` are the same suite run on the branch before the v1 changes merged, with the same totals. The fixtures are simplified mock-ups, not the real sites, so the selectors still need checking by hand after a site change.
- The extension is not on the Chrome Web Store yet.
- Plan availability for Projects, Skills and custom GPTs varies and changes, so Wisp's notes stay general. Each feature entry has a `lastChecked` date.
- The server's rate limit is per instance and best-effort.

Wisp is an independent project and isn't affiliated with OpenAI, Anthropic or Google.
