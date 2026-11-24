# Heuristic UX review (no user research)

2026-11-24 · One reviewer checking the demo page against usability heuristics and WCAG 2.2 AA, in Playwright/Chromium on a local build (tips show the labeled built-in fallback there). No users were observed; nothing here is a test result. Screenshots (1280x800, 390x844) are named inline.

## 1. Top 8 issues, ranked by impact on a first-time visitor

**1. Your own prompt usually gets silence, with no sign Wisp looked. High.**
Of five prompts I typed, "make me a logo", "write an essay about climate change", "help", "fix this code" got nothing; only "build an app for my startup" got a tip. `WispController.look()` returns silently when nothing matches or during the 8 s cooldown. To a newcomer that looks broken.
Fix (demo only): after a look with no tip, toast: *"Looks clear to me. I only speak up when a tip would change the answer. Try a scenario to see one."* During cooldown: *"I just gave a tip, so I'm holding off for a few seconds."*

**2. Phone: the composer starts below the fold. High.**
At 390x844 the textarea starts at y=898 (`phone-01-first.png`): the first screen shows scenario chips but not where anything happens.
Fix (`@media (max-width: 900px)`): `.scenarios { flex-wrap: nowrap; overflow-x: auto; }` and `.chat-card { height: 460px; }`, which puts the composer on the first screen.

**3. Phone: the tip's title is clipped when the keyboard is up. High.**
With a 390x450 visible area (keyboard simulated), the bubble's top is at -100 px: title and "what I noticed" are off-screen (`phone-kbd-450-tip.png`). `.bubble` caps height with `70vh`, which doesn't shrink for the keyboard.
Fix: add `interactive-widget=resizes-content` to the viewport meta; set `--vvh` from `visualViewport.height` on resize and use `max-height: min(calc(var(--vvh, 100dvh) - 140px), 520px)`; on open, call `bubble.scrollIntoView({ block: "nearest" })`.

**4. Screen readers probably never hear the tip; Escape does nothing. High (for AT users).**
`.bubble` is `role="dialog" aria-live="polite"`, but content is written while `visibility: hidden` (the 900 ms peek), then revealed by a `data-state` change, so it's likely never announced. A dialog that never takes focus is also the wrong role. Escape leaves the tip open. (Good: focus stays in the textarea; Tab reaches ×, chips, mute and Got it with a visible outline.)
Fix: `role="region" aria-label="Wisp tip"`, drop `aria-live` from the bubble; add a sibling `<div class="sr" role="status">` and, once state is `open`, set it to *"Wisp tip: {title}. Its buttons come right after Send."* Escape in the textarea or bubble = "Got it."

**5. Dark mode: Send button text fails contrast. High.**
White on dark `--accent` `#6f9dff` = **2.64:1** (`desk-dark-05-orb.png`).
Fix: `#send { background: var(--me); }` gives white on `#2f6bea` = 4.76:1 (light) and on `#3b6fe0` = 4.63:1 (dark).

**6. Light mode: scenario chips, links and the placeholder fall just under AA. Medium.**
`#2f6bea` on `#eef4ff` (scenario chips, 13 px) = **4.31:1**; links on `#f5f7fb` = 4.44:1; the placeholder (Chrome's `#757575`) = 4.30:1 light, **3.99:1** dark.
Fix: light `--accent: #2558d6` (5.52:1 on `--accent-soft`, 5.68:1 on `--bg`, white text on it 6.09:1); `textarea::placeholder { color: var(--muted); }` (5.32:1 light, 8.09:1 dark).

**7. The faintest text on the tip is the instruction for what to do next. Medium.**
A clicked chip turns into "✓ Added: type over the ___" at `opacity: .6`, so it's **2.81:1** (`desk-04-chip.png`). Also, the textarea border `#e3e7f0` is 1.15:1 on `--bg` (1.4.11 needs 3:1).
Fix (`wisp-css.ts`): `.chip:disabled { opacity: 1; background: transparent; border-color: var(--line); color: var(--muted); }` (5.71:1 on the white bubble). `demo.css`: textarea `border-color: #848da3` light (3.10:1), `#5a6482` dark (3.14:1).

**8. The orb is unexplained and sits on the Send button; the controls are duplicated. Medium.**
At 55% opacity the orb overlaps Send's top-right corner (`desk-01-first.png`). Nothing says the ghost *is* Wisp. Its panel repeats the sidebar's stats and toggle, worded differently ("Forget everything Wisp remembers" vs "Reset Wisp's memory"; "Personalize tips with AI" vs "…(Gemini)"). The accuracy table shows raw ids (`vague-fix`, `paste-no-ask`) while the table above it uses names.
Fix: `.wisp.contained { bottom: 120px; }`; use one label everywhere ("Forget everything Wisp remembers"); map ids through `TIP_NAMES` in `#eval-body`.

## 2. Proposed first run (first 10 seconds)

Goal: within 10 seconds, see one tip and click one add-on.

- Chat pill: *"Practice chat · replies are placeholders, Wisp is the real part"*.
- The empty state replaces the current sentence:
  > **Meet Wisp, the little ghost by the Send button.** Pause while typing and it reads your draft, then suggests one fix you can click to add.
  > [ **Show me** ] *(runs "Vague project")*
  > Or type your own. Wisp stays quiet when a prompt is already clear.
- On load the orb plays its `peek` state once (1.5 s).
- The first time a tip opens, a one-line hint sits above the chips: *"Click a + to add it to your prompt."* Hide it after the first chip click (keep it in `sessionStorage`).

## 3. What NOT to change

- **Silence by default.** The page's held-out numbers justify rules deciding when Wisp speaks. Issue 1 explains silence; it adds no tips.
- **Honest labels** ("Built-in tip", fallback reasons, "a check, not proof"): they are the page's credibility.
- **Peek-then-speak and no focus stealing.** Never interrupts typing.
- **Add-ons append and select the first `___`.** The core interaction works.
- **Shadow-root isolation, the dismiss/mute/Got it trio, the scenario set.**
- **`--muted` tokens** already pass (light 5.05–5.71:1, dark 6.3–8.1:1).
