# Heuristic UX review (no user research)

2026-11-24 · Scope: the demo page (`public/index.html`, `public/demo.css`, `src/demo/main.ts`, `src/ui/*`). Method: one reviewer walking the page against usability heuristics and WCAG 2.2 AA in Playwright/Chromium on a local build (AI personalization fails locally, so tips show the labeled built-in fallback). No users were observed; nothing here is a test result. Screenshots: `scratchpad/ux/*.png` (1280x800 and 390x844, DPR 1).

## 1. Top 8 issues, ranked by impact on a first-time visitor

**1. Your own prompt usually gets silence, with no sign Wisp looked. High.**
I typed five prompts of my own: "make me a logo", "write an essay about climate change", "help", "fix this code" got nothing; only "build an app for my startup" got a tip. `WispController.look()` returns silently when there's no suggestion (and during the 8 s demo cooldown). A visitor reads that as "broken."
Fix (demo only; the extension keeps its silence): after a look with no tip, show a toast: *"Looks clear to me. I only speak up when a tip would change the answer. Try a scenario to see one."* During cooldown: *"I just gave a tip, so I'm holding off for a few seconds."*

**2. Phone: the composer starts below the fold. High.**
At 390x844 the chat card starts at y=440 and the textarea at y=898 (`phone-01-first.png`). The first screen shows scenario chips but not where anything happens.
Fix (`@media (max-width: 900px)`): `.scenarios { flex-wrap: nowrap; overflow-x: auto; }` and `.chat-card { height: 460px; }`, which puts the composer on the first screen.

**3. Phone: the tip's title is clipped when the keyboard is up. High.**
Simulating the keyboard with a 390x450 visible area, the bubble's top sits at -100 px: title and "what I noticed" are off-screen; only the chips show (`phone-kbd-450-tip.png`). `.bubble` caps height with `70vh`, which doesn't shrink for the keyboard.
Fix: add `interactive-widget=resizes-content` to the viewport meta; set `--vvh` from `visualViewport.height` on resize and use `max-height: min(calc(var(--vvh, 100dvh) - 140px), 520px)`; on open, call `bubble.scrollIntoView({ block: "nearest" })`.

**4. Screen readers probably never hear the tip; Escape does nothing. High (for AT users).**
`.bubble` is `role="dialog" aria-live="polite"`, but its content is written while it's `visibility: hidden` (the 900 ms peek) and then revealed by a `data-state` change, not a DOM mutation, so it's likely never announced. A non-modal "dialog" that never takes focus is also the wrong role. Pressing Escape left the tip open (verified). Focus correctly stays in the textarea, and Tab goes Send → × → chips → mute → Got it, all with a visible outline.
Fix: `role="region" aria-label="Wisp tip"`, drop `aria-live` from the bubble; add a sibling `<div class="sr" role="status">` and, once state is `open`, set it to *"Wisp tip: {title}. Its buttons come right after Send."* Escape in the textarea or bubble = "Got it."

**5. Dark mode: Send button text fails contrast. High.**
White on dark `--accent` `#6f9dff` = **2.64:1** (`desk-dark-05-orb.png`).
Fix: `#send { background: var(--me); }` gives white on `#2f6bea` = 4.76:1 (light) and on `#3b6fe0` = 4.63:1 (dark).

**6. Light mode: scenario chips, links and the placeholder fall just under AA. Medium.**
`#2f6bea` on `#eef4ff` (scenario chips, 13 px) = **4.31:1**; links on `#f5f7fb` = 4.44:1; the placeholder (Chrome's `#757575`) = 4.30:1 light, **3.99:1** dark.
Fix: light `--accent: #2558d6` (5.52:1 on `--accent-soft`, 5.68:1 on `--bg`, white text on it 6.09:1); `textarea::placeholder { color: var(--muted); }` (5.32:1 light, 8.09:1 dark).

**7. The faintest text on the tip is the instruction for what to do next. Medium.**
A clicked chip turns into "✓ Added: type over the ___" at `opacity: .6`, so it's **2.81:1** (`desk-04-chip.png`). Separately, the textarea border `#e3e7f0` is 1.15:1 against `--bg` (WCAG 1.4.11 needs 3:1 for field edges).
Fix (`wisp-css.ts`): `.chip:disabled { opacity: 1; background: transparent; border-color: var(--line); color: var(--muted); }` (5.71:1 on the white bubble). `demo.css`: textarea `border-color: #848da3` light (3.10:1), `#5a6482` dark (3.14:1).

**8. The orb is unexplained and sits on the Send button; the controls are duplicated. Medium.**
At 55% opacity the orb overlaps Send's top-right corner (`desk-01-first.png`). Nothing on the page says the ghost *is* Wisp. Its panel repeats the sidebar stats and toggle with different words ("Forget everything Wisp remembers" vs "Reset Wisp's memory"; "Personalize tips with AI" vs "…(Gemini)"). The accuracy table shows raw ids (`vague-fix`, `paste-no-ask`) while the table above it uses names.
Fix: `.wisp.contained { bottom: 120px; }`; use one label everywhere ("Forget everything Wisp remembers"); map ids through `TIP_NAMES` in `#eval-body`.

## 2. Proposed first run (first 10 seconds)

Goal: in 10 seconds the visitor sees one tip and clicks one add-on.

- Chat pill: *"Practice chat · replies are placeholders, Wisp is the real part"*.
- The empty state replaces the current sentence:
  > **Meet Wisp, the little ghost by the Send button.** Pause while typing and it reads your draft, then suggests one fix you can click to add.
  > [ **Show me** ] *(runs "Vague project")*
  > Or type your own. Wisp stays quiet when a prompt is already clear.
- On page load the orb plays its existing `peek` state once (1.5 s) so the eye finds it.
- The first time a tip opens, a one-line hint sits above the chips: *"Click a + to add it to your prompt."* Hide it after the first chip click (keep it in `sessionStorage`).
- After the first chip click, the existing toast flow continues as it does now.

## 3. What NOT to change

- **Silence by default.** Rules decide when Wisp speaks; the page's own held-out numbers are why. Issue 1 adds feedback about the silence, not more tips.
- **Honest labels.** "Built-in tip", "Personalized by Gemini", the fallback reasons and the "a check, not proof" captions are the page's credibility.
- **Peek-then-speak and no focus stealing.** The tip never interrupts typing, and focus stays in the textarea.
- **Add-ons append and select the first `___`.** It's the core interaction and it works.
- **Shadow-root isolation, the × / "Don't show this tip again" / "Got it" trio, and the scenario set.**
- **Dark-mode muted text** (`#a3acc2`, 6.3–8.1:1) and light `--muted` `#5d6680` (5.05–5.71:1) already pass.
