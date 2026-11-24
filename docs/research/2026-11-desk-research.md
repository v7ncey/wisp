# Desk research (no user research)

**Date:** 2026-11-24 · **Method:** web search plus the pages we could fetch. No interviews, surveys or participants. Only Anthropic's docs could be fetched in full. openai.com/platform.openai.com, ai.google.dev and arxiv.org were blocked by the network allowlist, so claims from those sites rest on search-result snippets and are marked that way. Quotes are verbatim where marked "fetched".

## 1. Do OpenAI, Anthropic and Google recommend Wisp's habits?

| Wisp habit | Anthropic | OpenAI | Google | Confidence |
|---|---|---|---|---|
| Clarifying questions / plan first | Claude Code: "Use plan mode to separate exploration from execution" [A3] | No official "ask me clarifying questions" tip found. A K-12 Academy sample asks for "2 follow-up questions" [O3] | Not found. Workspace guide frames a prompt as the start of a conversation [G2] | Medium. Plan-first is official at Anthropic for coding. Asking the user for questions is not explicit in any general guide we found |
| Exact error / expected vs actual | Not stated directly. "Brilliant but new employee who lacks context" (fetched) [A1] | Generic: "provide necessary context" [O2] | Generic: give context [G1, G2] | Low. Only the general "give context" advice applies. Better support comes from bug-report research (Section 2) |
| Feedback goal / audience | "Providing context or motivation behind your instructions" (fetched) [A1] | "identify the task clearly, provide necessary context" [O2] | Persona / task / context / format [G2] | High that context and goal are recommended. Audience is implied |
| Sources + flag uncertainty | "Allow Claude to say 'I don't know'", "Verify with citations" (fetched) [A2] | Reference text helps answers "with fewer fabrications" [O1, 2023-24 copy] | Not found | High for Anthropic. Medium for OpenAI (old snippet). Note: both apply to documents you *supply*, not to the model's memory |
| Example / set length | Examples are "one of the most reliable ways to steer Claude's output format, tone" (fetched) [A1] | "Specify the desired length of the output" [O1] | "always include few-shot examples in your prompts" [G1] | High. All three vendors agree |

## 2. Evidence that these prompt changes improve answers

- **Clarify first.** Ambig-SWE: on underspecified SWE-bench issues, letting the agent ask questions raised performance "by up to 74%" over no interaction. Models "default to non-interactive behavior without explicit encouragement" [P1]. That supports a chip that *tells* the model to ask. Laban et al.: on underspecified multi-turn tasks, performance dropped by an average of 39% because models make early assumptions and "do not recover" [P2]. Caveats: the studies use agents or benchmarks with simulated users, not novices in a chat. CLAMBER finds that LLMs are weak at spotting ambiguity themselves [P3]. One 2026 preprint finds that more questions often stop helping [P4]. Confidence: medium.
- **Exact error / steps.** Developers rate steps to reproduce and stack traces as the most useful parts of a bug report [P5]. This is human-to-human evidence; we found no LLM study that measures it. Confidence: medium by analogy.
- **Examples.** Few-shot prompting is a core, well-established technique [P6]. Min et al. show that the format and input distribution of the examples matter, not just correct labels [P7]. Neither study is on style imitation in chat. Confidence: medium.
- **Sources / uncertainty.** "According to…" prompting improved grounding in quotes [P8]. OpenAI's 2025 paper argues that models hallucinate partly because training rewards guessing over saying "I don't know" [P9]. **Risk:** asking for sources without web search can yield fabricated citations. One study found 55% of GPT-3.5 and 18% of GPT-4 citations fabricated [P10]. Confidence: high that the risk is real for older models; newer models are untested here.
- **Novices.** Non-experts prompt opportunistically and carry over human-conversation habits [P11]. This supports coaching, but it is not evidence that coaching works.

## 3. LLM-as-a-judge for "answer with vs without add-on"

- **Position bias:** it exists and varies by judge and task [J2]. Run both orders and count a win only if the judge picks the same answer both times; otherwise call it a tie. This follows Zheng et al. [J1]; we recall the both-orders rule from the paper but couldn't verify it from text we could fetch. A 2026 preprint says position bias is now small and style bias dominates [J5]. That is a single preprint. Confidence: medium.
- **Pairwise vs rubric:** pairwise judging is better at spotting small differences. Single-answer scoring scales better [J1, J2]. Verbosity bias favors longer answers [J4]. Our add-ons ("list 3 changes", "sources") change length, so control for it.
- **Self-preference:** judges favor their own outputs [J3]. Use a judge from a different model family than the generator [J4]. Confidence: high.
- **Small N:** report standard errors. Compare paired per-prompt differences rather than two averages [J6]. With about 40 prompts, only large effects will show up. Confidence: high.
- **Wisp-specific:** the "ask me clarifying questions" chip makes the first reply *questions*. A single-turn judge will mark it worse. Comparing it fairly needs a simulated user answering, as in [P1, P2].

## 4. Prompt-improvement tools: published evidence

| Tool | Type | Published evidence that answers improve? |
|---|---|---|
| Anthropic Console prompt improver [T1] | Developer rewrite | Yes, self-reported: +30% (relative) accuracy on one 500-item classification test with Claude 3 Haiku, and 100% word-count adherence on 10 articles. Responses get longer and slower. No independent replication |
| OpenAI Playground "Optimize" [T2] | Developer rewrite | None found. The dataset-backed version is deprecated |
| Vertex AI prompt optimizer [T3] | Developer, zero-shot or data-driven | Built around your own eval metrics; no public figures found |
| Microsoft 365 Copilot Prompt Coach [T4] | Enterprise agent that asks clarifying questions | None found |
| Chrome "enhance prompt" extensions (GreatPrompt, PromptUp, Prompthance, Frompt, etc.) [T5] | One-click rewrite | None. Store listings are marketing copy |
| Native buttons in the consumer ChatGPT / Claude / Gemini apps | — | Search found none (low confidence; check release notes) |

Takeaway: almost every tool *rewrites* the prompt; Microsoft's Prompt Coach is the only one found that *coaches* (by asking questions). None publishes evidence about novices' answers or learning. Wisp's teach-then-measure angle ("did it yourself") looks uncontested, and so does its evaluation gap.

## 5. Extension resilience on ChatGPT/Claude

- **Breakage is routine.** ChatGPT Exporter broke after the Nov 2023 UI change. AIPRM broke after a Sept 2023 update. Several extensions lost access when the site moved to chatgpt.com because their host permissions were missing [E1, E2, E3]. In each case the fix was a new release, which means a store-review delay.
- **The ChatGPT composer has changed form.** Userscripts carry fallback chains such as `#prompt-textarea.ProseMirror`, `[data-testid='prompt-textarea']` and `div[contenteditable][role=textbox]` [E4]. Wisp's `sites.ts` already notes a 2026-11 switch to `textarea[name="prompt"]`.
- **Common patterns:** ordered selector fallbacks that log when the primary one fails [E5]. Prefer `data-*`, ARIA roles and IDs over classes [E6]. A debounced MutationObserver (about 600 ms) on chat sites [E7]. Accessibility-tree role lookups as a last resort [E8]. We found no published source for the "largest visible contenteditable" heuristic or for runtime health checks. They are reasonable, but untested here.

## Sources

- [A1] Anthropic, Prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- [A2] Anthropic, Reduce hallucinations: https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations
- [A3] Claude Code best practices: https://code.claude.com/docs/en/best-practices
- [O1] OpenAI prompt engineering guide (2023-24 copy): https://www.scribd.com/document/763527365/Prompt-engineering-Guide-OpenAI-API
- [O2] OpenAI Help, How to create a good prompt: https://help.openai.com/en/articles/4936848-chatgpt-how-to-create-a-good-prompt
- [O3] OpenAI Academy, K-12 Mastering your prompts: https://academy.openai.com/public/blogs/k-12-mastering-your-prompts
- [G1] Google, Prompt design strategies: https://ai.google.dev/gemini-api/docs/prompting-strategies
- [G2] Google Workspace Prompting Guide 101: https://services.google.com/fh/files/misc/gemini-for-google-workspace-prompting-guide-101.pdf
- [P1] Ambig-SWE: https://arxiv.org/abs/2502.13069
- [P2] Laban et al., LLMs Get Lost in Multi-Turn Conversation: https://arxiv.org/abs/2505.06120
- [P3] CLAMBER (ACL 2024): https://aclanthology.org/2024.acl-long.578
- [P4] Asking What Matters (2026): https://arxiv.org/abs/2604.14624
- [P5] Bettenburg et al., What Makes a Good Bug Report?: https://www.st.cs.uni-saarland.de/publications/details/bettenburg-tr-2008
- [P6] Schulhoff et al., The Prompt Report: https://arxiv.org/abs/2406.06608
- [P7] Min et al., Rethinking the Role of Demonstrations: https://aclanthology.org/2022.emnlp-main.759
- [P8] Weller et al., "According to…": https://arxiv.org/abs/2305.13252
- [P9] OpenAI, Why language models hallucinate: https://openai.com/index/why-language-models-hallucinate/
- [P10] Walters & Wilder, Sci. Reports 2023: https://www.nature.com/articles/s41598-023-41032-5
- [P11] Zamfirescu-Pereira et al., Why Johnny Can't Prompt: https://people.eecs.berkeley.edu/~bjoern/papers/zamfirescu-johnny-chi2023.pdf
- [J1] Zheng et al., Judging LLM-as-a-Judge: https://arxiv.org/abs/2306.05685
- [J2] Shi et al., Judging the Judges (position bias): https://arxiv.org/abs/2406.07791
- [J3] Panickssery et al., LLM Evaluators Favor Their Own Generations: https://arxiv.org/abs/2404.13076
- [J4] A Survey on LLM-as-a-Judge: https://arxiv.org/abs/2411.15594
- [J5] Judging the Judges (2026 preprint): https://arxiv.org/abs/2604.23178
- [J6] Miller, Adding Error Bars to Evals: https://www.anthropic.com/research/statistical-approach-to-model-evals
- [T1] Anthropic prompt improver: https://www.anthropic.com/news/prompt-improver
- [T2] OpenAI prompt optimizer: https://developers.openai.com/api/docs/guides/prompt-optimizer
- [T3] Vertex AI prompt optimizer: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/prompt-optimizer
- [T4] Microsoft Prompt Coach: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-template-prompt-coach
- [T5] Example listing (GreatPrompt): https://chromewebstore.google.com/detail/greatprompt/kecbjcjhnjehhaogibhboimaliibpebo
- [E1] ChatGPT Exporter discussion: https://greasyfork.org/scripts/456055-chatgpt-exporter
- [E2] AIPRM not working (Dataconomy): https://dataconomy.com/2023/09/18/aiprm-for-chatgpt-not-working-fix
- [E3] Superpower ChatGPT thread: https://community.openai.com/t/superpower-for-chatgpt-is-no-longer-working-at-all/659858
- [E4] OpenAI forum, composer focus fix: https://community.openai.com/t/fix-found-chatgpt-composer-not-automatically-focusing-when-typing-brave-chrome/1405092
- [E5] Future-proofing scrapers: https://dev.to/anderecit/future-proofing-your-scrapers-strategies-for-resilient-dom-selection-1j4f
- [E6] Why CSS selectors keep breaking: https://dev.to/bd73/css-selectors-keep-breaking-why-it-happens-and-how-to-fix-it-4h7d
- [E7] Extension watching ChatGPT/Claude/Gemini: https://dev.to/juliedechili/5-things-i-learned-building-a-chrome-extension-that-watches-chatgpt-claude-gemini-4a4i
- [E8] ego-browser selectors: https://instagit.com/citrolabs/ego-lite/ego-browser-implement-site-specific-selectors-survive-dom-changes/
