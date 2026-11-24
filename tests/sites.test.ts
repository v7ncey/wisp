import { describe, it } from "node:test";
import { expect } from "./expect";
import {
  ADAPTERS,
  adapterFor,
  clearedAfterSend,
  connectionLine,
  isChatPage,
  isSameChat,
  isSendKey,
  pickComposer,
  shouldShowNotice,
  HEALTH_GRACE_MS,
  type EditorCandidate,
  type HealthState,
} from "../src/extension/sites";

const VH = 800;
const cand = (over: Partial<EditorCandidate>): EditorCandidate => ({
  kind: "contenteditable",
  role: null,
  label: "",
  visible: true,
  top: 700,
  height: 48,
  width: 600,
  ...over,
});

describe("fallback chat box finder", () => {
  it("prefers a contenteditable with role=textbox", () => {
    const pick = pickComposer([cand({ kind: "textarea", label: "Message ChatGPT" }), cand({ role: "textbox" })], VH);
    expect(pick).toEqual({ index: 1, strategy: "role-textbox" });
  });

  it("then a labeled textarea or contenteditable, ignoring search boxes", () => {
    const pick = pickComposer(
      [cand({ kind: "textarea", label: "Search chats", top: 10 }), cand({ kind: "textarea", label: "Ask anything" })],
      VH,
    );
    expect(pick).toEqual({ index: 1, strategy: "labeled" });
    expect(pickComposer([cand({ role: "textbox", label: "Search chats" })], VH)).toBeNull();
  });

  it("then the largest editable in the bottom half of the viewport", () => {
    const pick = pickComposer(
      [cand({ top: 50, width: 900, height: 200 }), cand({ width: 200 }), cand({ width: 700, height: 60 })],
      VH,
    );
    expect(pick).toEqual({ index: 2, strategy: "largest-bottom" });
  });

  it("skips hidden or tiny elements and gives up when nothing is left", () => {
    expect(pickComposer([cand({ role: "textbox", visible: false }), cand({ width: 10, height: 10 })], VH)).toBeNull();
    expect(pickComposer([cand({ top: 20 })], VH)).toBeNull();
    expect(pickComposer([], VH)).toBeNull();
  });

  it("breaks ties toward the lowest element on the page", () => {
    const pick = pickComposer([cand({ role: "textbox", top: 300 }), cand({ role: "textbox", top: 720 })], VH);
    expect(pick?.index).toBe(1);
  });
});

describe("send detection fallback", () => {
  it("treats Enter without Shift, outside IME composition, as send", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(isSendKey({ key: "a", shiftKey: false })).toBe(false);
  });

  it("counts a send only when a non-empty draft was cleared", () => {
    expect(clearedAfterSend("build me a website", "")).toBe(true);
    expect(clearedAfterSend("build me a website", "build me a website")).toBe(false);
    expect(clearedAfterSend("", "")).toBe(false);
    expect(clearedAfterSend("hi", " \n ")).toBe(true);
  });
});

describe("health check", () => {
  const base: HealthState = {
    now: 100_000,
    missingSince: 100_000 - HEALTH_GRACE_MS,
    lastTypedAt: 0,
    noticeShownThisPage: false,
    tipOpen: false,
    onChatPage: true,
  };

  it("shows the notice once the chat box has been missing for the grace period", () => {
    expect(shouldShowNotice(base)).toBe(true);
    expect(shouldShowNotice({ ...base, missingSince: base.now - 2_000 })).toBe(false);
    expect(shouldShowNotice({ ...base, missingSince: null })).toBe(false);
  });

  it("shows it at most once per page, never while typing, over a tip, or off chat pages", () => {
    expect(shouldShowNotice({ ...base, noticeShownThisPage: true })).toBe(false);
    expect(shouldShowNotice({ ...base, lastTypedAt: base.now - 500 })).toBe(false);
    expect(shouldShowNotice({ ...base, tipOpen: true })).toBe(false);
    expect(shouldShowNotice({ ...base, onChatPage: false })).toBe(false);
  });

  it("knows which pages should have a chat box", () => {
    expect(isChatPage("chatgpt", "/")).toBe(true);
    expect(isChatPage("chatgpt", "/uc/abc")).toBe(true);
    expect(isChatPage("chatgpt", "/gpts")).toBe(false);
    expect(isChatPage("claude", "/new")).toBe(true);
    expect(isChatPage("claude", "/chat/abc")).toBe(true);
    expect(isChatPage("claude", "/settings/profile")).toBe(false);
  });

  it("describes the connection in the stats panel", () => {
    expect(connectionLine("primary")).toBe("Connected to the chat box");
    expect(connectionLine("largest-bottom")).toBe("Using a backup way to find the chat box");
    expect(connectionLine(null)).toContain("tips are paused");
  });
});

// URL shapes seen in Chrome on 2026-11-05.
describe("site adapters", () => {
  it("reads ChatGPT chat ids, signed in (/c/) and signed out (/uc/)", () => {
    const id = ADAPTERS["chatgpt.com"].chatId;
    expect(id("/c/68f0-abc")).toBe("68f0-abc");
    expect(id("/uc/6aed2f2f-c510-83ea-b38b-fba4f41ae5e2")).toBe("6aed2f2f-c510-83ea-b38b-fba4f41ae5e2");
    expect(id("/")).toBe(null);
  });

  it("reads Claude chat ids and treats /new as no id yet", () => {
    const id = ADAPTERS["claude.ai"].chatId;
    expect(id("/chat/74210090-7b9b-4475-91a2-242078c3bd66")).toBe("74210090-7b9b-4475-91a2-242078c3bd66");
    expect(id("/new")).toBe(null);
  });

  it("matches hosts and subdomains only", () => {
    expect(adapterFor("chatgpt.com")?.site).toBe("chatgpt");
    expect(adapterFor("www.claude.ai")?.site).toBe("claude");
    expect(adapterFor("notclaude.ai")).toBe(null);
  });

  it("keeps a new chat's draft when it gets its id on first send, but not on a real switch", () => {
    expect(isSameChat(null, "abc")).toBe(true);
    expect(isSameChat("abc", "abc")).toBe(true);
    expect(isSameChat("abc", "def")).toBe(false);
    expect(isSameChat("abc", null)).toBe(false);
  });
});
