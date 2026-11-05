# Wisp

A small companion that watches how you prompt AI chat assistants and pops up with tips you can click to apply.

**Try it (no sign-in, no install):** https://wisp-coach.vercel.app

Wisp is for people who are new to AI. When you pause typing a prompt, it checks your draft for a few common habits. If one shows up, Wisp peeks in from the edge of the screen, says what it noticed, explains *why* the fix helps, and offers add-ons you can click to append to your prompt. The idea comes from the "something is watching you" feeling of the Minecraft mod Verity, minus the horror.

## What it does

| Habit | What Wisp suggests |
|---|---|
| A vague "build me X" | Ask the AI for clarifying questions and a plan first |
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

Both sets were written by me, so they share my blind spots. Real user prompts are the next step. `npm run eval:gemini` runs the same prompts through Gemini-as-detector for comparison; it needs `GEMINI_API_KEY`.

## Project layout

```
src/core/       detectors, tip library, coach engine, memory (shared)
src/ui/         Wisp's pop-up (shadow DOM) and the controller that wires it to a text box
src/demo/       the demo page
src/extension/  Chrome extension: per-site selectors, content script, background worker
src/server/     Gemini calls and the /api/coach handler
api/coach.ts    Vercel function
evals/          labeled prompts and results
```

## Run it

```bash
npm install
npm test          # unit tests (Node's built-in runner)
npm run eval      # detector precision/recall
npm run build     # bundles demo + extension, zips the extension into public/
npx tsx scripts/serve.ts   # local demo on http://localhost:5178
```

To load the extension: run `npm run build`, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick the `extension/` folder.

## Known limits

- The extension reads ChatGPT's and Claude's pages using CSS selectors (`src/extension/sites.ts`). When those sites change their layout, the selectors need updating.
- The extension is not on the Chrome Web Store yet.
- Plan availability for Projects, Skills and custom GPTs varies and changes, so Wisp's notes stay general. Each feature entry has a `lastChecked` date.
- The server's rate limit is per instance and best-effort.

Wisp is an independent project and isn't affiliated with OpenAI, Anthropic or Google.
