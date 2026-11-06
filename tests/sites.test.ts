import { describe, it } from "node:test";
import { expect } from "./expect";
import { ADAPTERS, adapterFor, isSameChat } from "../src/extension/sites";

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
