# AI Help Assistant + Gemini Provider — Design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Overview

Add an "ask the app how to do things" help assistant to Beam, grounded in a
hardcoded knowledge base of the app's features. The assistant lives inside the
existing Help drawer as an **Ask box** above the browsable FAQ. Answers are
produced by an LLM that is given the entire knowledge base in its system prompt
and instructed to answer **only** from it.

As part of this, generalize the AI layer from Claude-only to a small provider
abstraction and add **Google Gemini** (free tier) as a peer provider, with an
auto-selection rule that prefers Gemini when its key is present.

### Goals
- One hardcoded knowledge base (KB) that is the single source of truth for both
  the browsable FAQ and the AI grounding.
- Natural-language Q&A grounded in the KB, in the existing Help drawer.
- Google Gemini support alongside Claude, reusing the same `{data}`/`{error}`
  contract; all existing copilot features gain Gemini support for free.
- The FAQ remains fully browsable offline; only the Ask box requires a key.

### Non-goals (YAGNI)
- No RAG / embeddings / vector store. The KB fits in a single prompt; stuff it.
- No conversational memory / multi-turn chat history. Each ask is independent.
- No streaming responses. A single response render is sufficient.
- No new "general knowledge" assistant — the model answers about Beam only.
- No automatic migration of the existing copilot UI to a provider dropdown
  (it inherits the auto rule transparently).

## Section 1 — Knowledge base as single source of truth

Create `src/shared/help-knowledge.js` — pure data, no Electron imports (same
pattern as `src/shared/render-model.js`), so both the renderer and the main
process can import it.

```js
export const HELP_KB = [
  {
    id: 'timeline',
    title: 'Timeline & Trimming',
    items: [
      {
        q: 'How do I trim the start or end of my recording?',
        a: 'Drag the handles at either end of the Screen track in the Timeline tab…',
        keywords: ['trim', 'cut', 'shorten', 'handles']
      }
      // …
    ]
  }
  // …more sections
]
```

- **Shape:** array of sections `{ id, title, items[] }`; each item
  `{ q, a, keywords[] }`. `q`/`a` are plain text. `keywords` aid the FAQ's
  client-side filter and give the model extra matching hints.
- **Consumers:**
  - `HelpDrawer.jsx` renders `HELP_KB` as the browsable FAQ, replacing its
    current inline hardcoded Q&A (removes the duplication).
  - `ai.js` flattens `HELP_KB` into a single text block for the system prompt.
- **Content scope:** port the existing HelpDrawer sections **and expand** to
  cover current features the FAQ misses:
  - Multi-clip timeline (the **+ Clip** button, the Clips strip, multi-clip
    export behavior and current limitations).
  - Transcript panel: transcribe, click-to-seek, cut-by-selection, filler-word
    removal, and the AI copilot actions.
  - Export: formats (mp4/hevc/webm/gif/png/mp3/m4a), quality, resolution cap,
    social-media presets, loudness normalization.
  - Settings: API keys, Whisper engine status.
  - Captions vs transcript distinction.
- A small helper `flattenKbForPrompt()` (in the same module) returns a stable
  text rendering used by the system prompt, so the prompt format is tested
  independently of the LLM.

## Section 2 — Provider abstraction (add Gemini)

Refactor `src/main/ai.js` from Claude-only into a provider layer. Keep the
existing exported feature functions (`generateMetadata`, `generateChapters`,
`suggestHighlights`, `editByPrompt`) and their `{data}`/`{error}` contract; only
their internal call path changes.

### Files
- `src/main/ai/providers/claude.js` — the current `fetch` to
  `https://api.anthropic.com/v1/messages` (model `claude-fable-5`,
  `anthropic-version: 2023-06-01`), moved out of `ai.js` largely unchanged.
- `src/main/ai/providers/gemini.js` — `fetch` to
  `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}`.
  - Default model: `gemini-2.0-flash` (free tier). Model id kept in one const.
  - Request maps `{ system, content, maxTokens }` →
    `{ systemInstruction: { parts:[{text:system}] }, contents:[{role:'user',parts:[{text:content}]}], generationConfig:{ maxOutputTokens } }`.
  - Response text read from `data.candidates[0].content.parts[0].text`,
    defensively. Surface `promptFeedback.blockReason` as a `REFUSAL`-style error.
- `src/main/ai/index.js` (or keep `ai.js` as the entry) exposes:
  - `callLLM({ system, content, maxTokens })` — selects a provider and returns
    its assistant text (or throws with a `.code`).
  - The four feature functions, now calling `callLLM` instead of `callClaude`.

### Provider selection (auto rule)
```
if (geminiApiKey set)  → Gemini
else if (claudeApiKey set) → Claude
else → NO_API_KEY error
```
A single `getActiveProvider()` returns `{ name, call }`. The error/`code`
vocabulary (`NO_API_KEY`, `BAD_KEY`, `NETWORK`, `API_ERROR`, `REFUSAL`,
`EMPTY`) is shared across providers so the UI handling stays uniform.

### Keys & preferences
- Add `geminiApiKey: { type: 'string', default: '' }` to
  `src/main/preferences.js` alongside `claudeApiKey`.
- Env fallbacks: `ANTHROPIC_API_KEY` (existing) and `GEMINI_API_KEY` (new).
- `ai-get-key` / `ai-set-key` generalize to report/set per provider. Proposed:
  `ai-get-keys` → `{ claude:{hasKey,hint}, gemini:{hasKey,hint}, active:'gemini'|'claude'|null }`,
  and `ai-set-key` takes `{ provider, key }`. Keep the old single-key handlers
  working (default provider = claude) to avoid breaking the current copilot
  until it is updated, OR update the copilot's key calls in the same change.
  **Decision for the plan:** generalize and update the copilot's two key calls
  in the same PR (small, localized) rather than maintaining a shim.

### Settings UI
In `src/renderer/src/views/Settings.jsx`, add a second key row under
"AI & Captions":
- "Google Gemini API key" with hint "Optional. Free tier available — used for
  AI help and copilot features." `type="password"`, bound to
  `prefs.geminiApiKey`.
- Keep the existing Claude key row. Optionally show which provider is active
  (a small chip) — nice-to-have, not required.

## Section 3 — The "Ask" UI in the Help drawer

Modify `src/renderer/src/components/HelpDrawer.jsx` to add an **Ask box** pinned
at the top of the drawer, above the FAQ sections.

### Behavior
- Text input ("Ask how to do something…") + Send button (and Enter to submit).
- Submit → `window.electronAPI.aiHelpAsk(question)` → IPC `ai-help-ask` →
  main builds the system prompt from `flattenKbForPrompt()` + guardrail, calls
  `callLLM`, returns `{ data: answerText }` or `{ error, code }`.
- The answer renders in a panel directly under the input (plain text /
  light markdown), above the FAQ. A "Clear" affordance dismisses it.
- The model is instructed to **name the relevant feature/section** so the user
  can scroll to it in the FAQ below.
- **Busy state:** disable Send and show "Thinking…" while in flight, mirroring
  the copilot's `aiBusy` pattern.

### Key gating
- **No key set (neither provider):** FAQ stays fully browsable. The Ask box is
  visible but shows an inline note: "Add a free Google Gemini key in Settings to
  ask questions," linking to Settings. Send is disabled.
- **Key set:** Ask box is active.
- Drawer fetches key status on open (reusing `ai-get-keys`).

### System prompt (grounding)
A fixed system prompt that:
1. States the assistant only answers questions about **Beam**, using the
   provided knowledge base.
2. Includes the flattened KB.
3. Instructs: if the answer isn't in the KB, say it's not something Beam does
   (or that you're not sure) rather than inventing features; keep answers short
   and reference the relevant feature by name; never fabricate keyboard
   shortcuts or menus.

## Data flow

```
HelpDrawer (renderer)
  │  question text
  ▼
window.electronAPI.aiHelpAsk(question)         [preload]
  ▼
ipcMain 'ai-help-ask'                           [main/index.js]
  ▼
ai.askHelp(question)                            [main/ai]
  ├─ system = HELP_SYSTEM_PROMPT + flattenKbForPrompt(HELP_KB)
  ├─ callLLM({ system, content: question })
  │     └─ getActiveProvider() → claude.js | gemini.js
  ▼
{ data: answerText } | { error, code }
  ▼
HelpDrawer renders answer (or key-gating / error toast)
```

Both `HelpDrawer.jsx` and `ai.js` import `HELP_KB` / `flattenKbForPrompt` from
the shared module, guaranteeing the FAQ and the AI grounding never drift.

## Error handling
- Reuse the existing `{ error, code }` contract end to end. UI maps:
  - `NO_API_KEY` → show the "add a Gemini key" inline note (not a toast).
  - `BAD_KEY` → toast "Provider rejected the API key. Check it in Settings."
  - `NETWORK` → toast "Couldn't reach the AI provider. Check your connection."
  - `REFUSAL` / `EMPTY` / `API_ERROR` → toast with the message.
- Gemini provider maps HTTP 400 with `API_KEY_INVALID` → `BAD_KEY`, 429 →
  `API_ERROR` with a rate-limit message.

## Testing
- **Unit (pure, Node):** `test/help-knowledge.test.mjs`
  - `HELP_KB` is well-formed (every item has non-empty `q`/`a`; ids unique).
  - `flattenKbForPrompt()` includes every section title and question and is
    deterministic.
- **Provider unit (mocked fetch):**
  - `getActiveProvider()` selection rule (gemini set → gemini; only claude →
    claude; none → NO_API_KEY).
  - Gemini request body shape and response/`error`-code mapping, with `fetch`
    stubbed (no network).
- **Manual/E2E:** open the Help drawer, confirm FAQ renders from `HELP_KB`;
  with a Gemini key set, ask a question and see a grounded answer; with no key,
  see the inline gating note and a browsable FAQ.

## File-by-file change list
| File | Change |
|---|---|
| `src/shared/help-knowledge.js` | **new** — `HELP_KB` + `flattenKbForPrompt()` |
| `src/main/ai/providers/claude.js` | **new** — extracted Claude `fetch` call |
| `src/main/ai/providers/gemini.js` | **new** — Gemini `fetch` call + mapping |
| `src/main/ai.js` (or `ai/index.js`) | provider abstraction, `callLLM`, `askHelp`, keep feature fns |
| `src/main/preferences.js` | add `geminiApiKey` |
| `src/main/index.js` | generalize key IPC; add `ai-help-ask` |
| `src/preload/index.js` | add `aiHelpAsk`; generalize key methods |
| `src/renderer/src/components/HelpDrawer.jsx` | render from `HELP_KB`; add Ask box + gating |
| `src/renderer/src/components/HelpDrawer.module.css` | styles for Ask box/answer |
| `src/renderer/src/views/Settings.jsx` | add Gemini key field |
| `test/help-knowledge.test.mjs` | **new** unit tests |
| `test/ai-provider.test.mjs` | **new** provider-selection + Gemini mapping tests |

## Open questions / assumptions
- Default Gemini model `gemini-2.0-flash` (free tier). If unavailable for an
  account, the error surfaces clearly; model id is a single constant to change.
- Settings already persists keys via the `prefs` object; we follow that exact
  pattern for the Gemini field (no new save mechanism).
