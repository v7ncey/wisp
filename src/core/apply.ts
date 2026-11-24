import type { BlankKind, Chip } from "./types";

/**
 * Appends an add-on to a draft the way Wisp's demo and extension do: one space after the
 * draft, with a period first if the draft doesn't already end a sentence.
 */
export function appendAddOn(draft: string, addOn: string): string {
  const v = draft.trimEnd();
  if (!v) return addOn;
  return `${v}${/[.!?:]$/.test(v) ? "" : "."} ${addOn}`;
}

export type Details = Partial<Record<BlankKind, string>>;

/**
 * The add-on text after the user fills its blanks. Returns null when a needed detail is
 * missing, so callers never send a prompt with "___" left in it by accident.
 */
export function fillChip(chip: Chip, details: Details): string | null {
  const kinds = chip.fill ?? [];
  if (!kinds.length) return chip.insert;
  const values = kinds.map((k) => details[k]?.trim());
  if (values.some((v) => !v)) return null;
  const blanks = chip.insert.split("___");
  if (blanks.length > 1) {
    if (blanks.length - 1 !== values.length) return null;
    return blanks.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ""), "");
  }
  // A trailing-colon add-on: the user's detail goes after it.
  return `${chip.insert.trimEnd()} ${values.join(" ")}`;
}

/** A draft with every add-on of a tip applied and filled in, as a user following the tip fully would send it. */
export function applyChips(draft: string, chips: Chip[], details: Details): string | null {
  let out = draft;
  for (const chip of chips) {
    const text = fillChip(chip, details);
    if (text === null) return null;
    out = appendAddOn(out, text);
  }
  return out;
}

export const BLANK = "___";

/** Where the first unfilled blank is in a draft, so the editor can select it for the user to type over. */
export function firstBlank(text: string, from = 0): { start: number; end: number } | null {
  const start = text.indexOf(BLANK, from);
  return start === -1 ? null : { start, end: start + BLANK.length };
}
