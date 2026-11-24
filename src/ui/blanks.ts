import { BLANK, firstBlank } from "../core/apply";

/**
 * Selects the first "___" in a text box so the user can type straight over it. Works for a
 * <textarea> and for a contenteditable editor (ProseMirror on ChatGPT and Claude).
 * Returns false when there's no blank.
 */
export function selectFirstBlank(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) {
    const b = firstBlank(el.value);
    if (!b) return false;
    el.focus();
    el.setSelectionRange(b.start, b.end);
    return true;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const b = firstBlank(node.textContent ?? "");
    if (!b) continue;
    const range = document.createRange();
    range.setStart(node, b.start);
    range.setEnd(node, b.end);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return true;
  }
  return false;
}

export const hasBlank = (text: string) => text.includes(BLANK);
