import type { Coach } from "../core/engine";
import type { PersonalizeOutcome } from "../core/personalize-client";
import type { CoachContext, Suggestion } from "../core/types";
import { TIPS } from "../core/library";
import type { WispUI } from "./wisp-ui";

export interface Editor {
  getDraft(): string;
  /** Append an add-on to the draft. Returns false if the host page refused the insert. */
  insert(text: string): boolean;
}

export interface ControllerDeps {
  coach: Coach;
  ui: WispUI;
  editor: Editor;
  context(): CoachContext;
  /** Undefined = personalization off. */
  personalize?: (draft: string, s: Suggestion) => Promise<PersonalizeOutcome>;
  /** How long the user must stop typing before Wisp looks. */
  pauseMs?: number;
}

/** Glue between a text box, the coach and the pop-up. Shared by the demo page and the extension. */
export class WispController {
  private timer: number | undefined;
  private forceNext = false;
  private pauseMs: number;

  constructor(private d: ControllerDeps) {
    this.pauseMs = d.pauseMs ?? 1500;
  }

  setPersonalize(fn: ControllerDeps["personalize"]) {
    this.d.personalize = fn;
  }

  /** Call on every keystroke. Wisp waits for a pause; it never interrupts mid-typing. */
  onInput() {
    clearTimeout(this.timer);
    this.d.ui.glance(true);
    this.timer = window.setTimeout(() => {
      this.d.ui.glance(false);
      void this.look();
    }, this.pauseMs);
  }

  /** Next look skips the cooldown (used by explicit "try this" actions in the demo). */
  forceNextLook() {
    this.forceNext = true;
  }

  async look() {
    const draft = this.d.editor.getDraft();
    if (!draft.trim() || this.d.ui.isOpen) return;
    const force = this.forceNext;
    this.forceNext = false;
    const s = await this.d.coach.check(draft, this.d.context(), { force });
    if (!s) return;

    const handlers = {
      onChip: (chip: { insert: string }, _ai: boolean) => {
        if (this.d.editor.insert(chip.insert)) void this.d.coach.chipClicked(s.tipId);
      },
      onDismiss: () => void this.d.coach.dismissed(s.tipId),
      onMute: () => void this.d.coach.mute(s.tipId),
    };
    // Personalize only draft-level tips; memory tips are about the user's history, not this text.
    const canPersonalize = !!this.d.personalize && TIPS[s.tipId].chips.length > 0;
    this.d.ui.show(s, handlers, { personalizing: canPersonalize });
    if (canPersonalize) {
      const outcome = await this.d.personalize!(draft, s);
      this.d.ui.applyPersonalization(s, handlers, outcome);
    }
  }

  /** Call when the user sends a message. */
  async onSend(text: string) {
    clearTimeout(this.timer);
    this.d.ui.glance(false);
    if (this.d.ui.currentTip) this.d.ui.hide();
    const { learned } = await this.d.coach.recordSend(text, this.d.context());
    if (learned.length) {
      this.d.ui.toast(`You did "${TIPS[learned[0]].title.toLowerCase()}" on your own. That's the goal.`);
    }
  }
}
