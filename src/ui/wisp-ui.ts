import type { Chip, Suggestion } from "../core/types";
import type { WispMemory } from "../core/storage";
import { FALLBACK_LABEL, type PersonalizeOutcome } from "../core/personalize-client";
import { WISP_CSS } from "./wisp-css";

export interface ShowHandlers {
  onChip(chip: Chip, aiWritten: boolean): void;
  onDismiss(): void;
  onMute(): void;
}

export interface PanelInfo {
  memory: WispMemory;
  personalizeOn: boolean;
  personalizeNote: string;
  onTogglePersonalize(on: boolean): void;
  onReset?(): void;
}

const AVATAR = `
<svg class="orb" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <radialGradient id="wisp-glow" cx="45%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#b9e6ff"/>
      <stop offset="100%" stop-color="#6aa8ff" stop-opacity="0.9"/>
    </radialGradient>
  </defs>
  <path class="tail" d="M14 46 C 6 52, 4 58, 10 61 C 8 56, 14 54, 20 50 Z" fill="#9fd4ff" opacity="0.7"/>
  <circle cx="32" cy="32" r="22" fill="url(#wisp-glow)"/>
  <g class="eyes">
    <ellipse cx="25" cy="31" rx="3.2" ry="4.4" fill="#1d2a44"/>
    <ellipse cx="39" cy="31" rx="3.2" ry="4.4" fill="#1d2a44"/>
    <circle cx="26" cy="29.5" r="1" fill="#fff"/>
    <circle cx="40" cy="29.5" r="1" fill="#fff"/>
  </g>
</svg>`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Wisp's on-screen presence. Lives in a shadow root so host-page styles can't break it
 * (and it can't break the host page).
 */
export class WispUI {
  private root: ShadowRoot;
  private wrap: HTMLDivElement;
  private bubble: HTMLDivElement;
  private current: Suggestion | null = null;
  private peekTimer: number | undefined;
  private panelProvider: (() => Promise<PanelInfo>) | null = null;

  constructor(host: HTMLElement, opts: { mode: "fixed" | "contained" }) {
    this.root = host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${WISP_CSS}</style>
      <div class="wisp ${opts.mode}" data-state="idle">
        <div class="bubble" role="dialog" aria-live="polite" aria-label="Wisp tip"></div>
        <button class="orb-btn" type="button" aria-label="Wisp: open stats and settings" title="Wisp">${AVATAR}</button>
      </div>`;
    this.wrap = this.root.querySelector(".wisp")!;
    this.bubble = this.root.querySelector(".bubble")!;
    this.root.querySelector(".orb-btn")!.addEventListener("click", () => this.toggleOrb());
  }

  /** What the orb shows when clicked with no tip open. */
  setPanelProvider(fn: () => Promise<PanelInfo>) {
    this.panelProvider = fn;
  }

  get isOpen() {
    return this.wrap.dataset.state !== "idle";
  }

  get currentTip() {
    return this.current;
  }

  /** Peek first, then speak. */
  show(s: Suggestion, h: ShowHandlers, opts: { personalizing?: boolean; peekMs?: number } = {}) {
    this.current = s;
    clearTimeout(this.peekTimer);
    this.render(s, h, opts.personalizing ? { state: "loading" } : { state: "built-in" });
    this.wrap.dataset.state = "peek";
    this.peekTimer = window.setTimeout(() => {
      if (this.current === s) this.wrap.dataset.state = "open";
    }, opts.peekMs ?? 900);
  }

  /** Apply the result of AI personalization to the tip that's showing. */
  applyPersonalization(s: Suggestion, h: ShowHandlers, outcome: PersonalizeOutcome) {
    if (this.current !== s) return;
    if (outcome.source === "gemini") {
      this.render({ ...s, noticed: outcome.noticed, why: outcome.why }, h, { state: "gemini", aiChip: outcome.chip });
    } else {
      this.render(s, h, { state: "fallback", reason: outcome.reason });
    }
  }

  hide() {
    clearTimeout(this.peekTimer);
    this.current = null;
    this.wrap.dataset.state = "idle";
  }

  /** A short message that isn't a tip (e.g. "you did it yourself"). */
  toast(text: string, ms = 3500) {
    if (this.current) return;
    this.bubble.innerHTML = `<p class="toast">${esc(text)}</p>`;
    this.wrap.dataset.state = "open";
    window.setTimeout(() => {
      if (!this.current) this.wrap.dataset.state = "idle";
    }, ms);
  }

  /** Eyes glance toward the text box while the user types. */
  glance(on: boolean) {
    this.wrap.classList.toggle("glancing", on);
  }

  private async toggleOrb() {
    if (this.isOpen && !this.current) {
      this.wrap.dataset.state = "idle";
      return;
    }
    if (this.current) return; // tip already open
    if (!this.panelProvider) return;
    const info = await this.panelProvider();
    this.renderPanel(info);
    this.wrap.dataset.state = "open";
  }

  private renderPanel(info: PanelInfo) {
    const totals = { shown: 0, chipClicks: 0, dismissed: 0, learned: 0 };
    for (const s of Object.values(info.memory.stats)) {
      if (!s) continue;
      totals.shown += s.shown;
      totals.chipClicks += s.chipClicks;
      totals.dismissed += s.dismissed;
      totals.learned += s.learned;
    }
    this.bubble.innerHTML = `
      <header><strong>Wisp is watching quietly</strong><button class="x" aria-label="Close">×</button></header>
      <dl class="stats">
        <div><dt>Tips shown</dt><dd>${totals.shown}</dd></div>
        <div><dt>Add-ons used</dt><dd>${totals.chipClicks}</dd></div>
        <div><dt>Dismissed</dt><dd>${totals.dismissed}</dd></div>
        <div><dt>Did it yourself</dt><dd>${totals.learned}</dd></div>
      </dl>
      <label class="toggle"><input type="checkbox" ${info.personalizeOn ? "checked" : ""}/> Personalize tips with AI</label>
      <p class="fine">${esc(info.personalizeNote)}</p>
      ${info.memory.muted.length ? `<p class="fine">Muted tips: ${info.memory.muted.length}</p>` : ""}
      ${info.onReset ? `<button class="link reset" type="button">Forget everything Wisp remembers</button>` : ""}`;
    this.bubble.querySelector(".x")!.addEventListener("click", () => (this.wrap.dataset.state = "idle"));
    this.bubble.querySelector<HTMLInputElement>(".toggle input")!.addEventListener("change", (e) =>
      info.onTogglePersonalize((e.target as HTMLInputElement).checked),
    );
    this.bubble.querySelector(".reset")?.addEventListener("click", () => {
      info.onReset?.();
      this.wrap.dataset.state = "idle";
    });
  }

  private render(
    s: Suggestion,
    h: ShowHandlers,
    label:
      | { state: "loading" | "built-in" }
      | { state: "gemini"; aiChip?: Chip }
      | { state: "fallback"; reason: string },
  ) {
    const chips: Array<{ chip: Chip; ai: boolean }> = s.chips.map((chip) => ({ chip, ai: false }));
    if (label.state === "gemini" && label.aiChip) chips.push({ chip: label.aiChip, ai: true });
    const sourceLine =
      label.state === "loading"
        ? `<span class="src loading">Personalizing with AI…</span>`
        : label.state === "gemini"
          ? `<span class="src ai">Personalized by Gemini</span>`
          : label.state === "fallback"
            ? `<span class="src">${esc(FALLBACK_LABEL[label.reason] ?? FALLBACK_LABEL.error)}</span>`
            : `<span class="src">Built-in tip</span>`;

    this.bubble.innerHTML = `
      <header><strong>${esc(s.title)}</strong><button class="x" aria-label="Dismiss tip">×</button></header>
      ${s.seenBefore ? `<p class="seen">${esc(s.seenBefore.line)}</p>` : ""}
      <p>${esc(s.noticed)}</p>
      <p class="why"><b>Why it helps:</b> ${esc(s.why)}</p>
      ${
        chips.length
          ? `<div class="chips" role="group" aria-label="Add to your prompt">${chips
              .map(
                ({ chip, ai }, i) =>
                  `<button class="chip${ai ? " ai" : ""}" type="button" data-i="${i}" title="${esc(chip.insert)}">+ ${esc(chip.label)}${ai ? ' <small>AI-written</small>' : ""}</button>`,
              )
              .join("")}</div>`
          : ""
      }
      ${
        s.features.length
          ? `<ul class="features">${s.features
              .map(
                (f) =>
                  `<li><b>${esc(f.name)}</b>: ${esc(f.howTo)}${f.note ? ` <span class="fine">${esc(f.note)}</span>` : ""} <a href="${esc(f.url)}" target="_blank" rel="noopener">Help</a></li>`,
              )
              .join("")}</ul>`
          : ""
      }
      <footer>${sourceLine}<span class="actions"><button class="link mute" type="button">Don't show this tip again</button><button class="got" type="button">Got it</button></span></footer>`;

    this.bubble.querySelector(".x")!.addEventListener("click", () => {
      h.onDismiss();
      this.hide();
    });
    this.bubble.querySelector(".got")!.addEventListener("click", () => {
      h.onDismiss();
      this.hide();
    });
    this.bubble.querySelector(".mute")!.addEventListener("click", () => {
      h.onMute();
      this.hide();
    });
    this.bubble.querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) =>
      btn.addEventListener("click", () => {
        const { chip, ai } = chips[Number(btn.dataset.i)];
        h.onChip(chip, ai);
        btn.disabled = true;
        btn.innerHTML = `✓ Added`;
      }),
    );
  }
}
