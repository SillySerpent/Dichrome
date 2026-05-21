# Hidden Internal Invariants

Hidden internal mode is the highest-risk path in this extension. These invariants must hold before and after refactors.

## Manifest And Injection

- ChatGPT content scripts must run on both `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- ChatGPT content scripts must keep `run_at: "document_start"`.
- ChatGPT content scripts must keep `all_frames: true`.
- Manifest content script order must match `CHATGPT_CONTENT_SCRIPT_FILES` in `shared/contracts.js`.
- The offscreen iframe bridge port name must match `OFFSCREEN_FRAME_PORT_NAME` in `shared/contracts.js`.
- `content/chatgpt/main-world-capture.js` must remain web-accessible to ChatGPT pages.

## Offscreen Frame Selection

- A normal top-level ChatGPT tab must not open the offscreen frame bridge.
- Nested utility frames must not claim the bridge.
- ChatGPT frames under `/backend-api/`, `/api/`, `/auth/`, and paths containing `/sentinel/` must be rejected as automation frames.
- The accepted hidden frame is the direct ChatGPT app iframe hosted by the extension offscreen document.
- The frame bridge must reconnect after port disconnects because MV3 can restart the service worker while the offscreen document survives.
- Stale frame ports must not let late disconnects fail the current connected frame.

## Frame Policy Override

- The frame-policy override is session-scoped and only exists to test local hidden iframe automation.
- The narrow non-tab ChatGPT subframe rule must be attempted first.
- If Chrome rejects the non-tab rule, the fallback rule must remain scoped to ChatGPT subframes.
- The rule must be removed when hidden automation is closed or when hidden support is recorded as unsupported.

## Hidden-Only Routing

- If hidden internal probing fails, the extension must surface a bounded error instead of opening or controlling a visible ChatGPT automation tab.
- The only visible ChatGPT page allowed in the normal product is the explicit user-triggered sign-in/setup handoff.
- Hidden workspace failures must include a useful failure reason and normalized error code.
- Stored legacy visibility values must sanitize to hidden before request orchestration.

## Visibility

- Offscreen-frame mode uses its own internal visibility mode because offscreen documents cannot be focused.
- A hidden workspace visibility failure should produce an actionable sign-in/setup or unavailable-workspace error.

## Request And Conversation Behavior

- Normal requests start a new chat by default after project routing succeeds.
- Follow-ups force `startNewChat: false` and reopen the saved parent conversation URL in the hidden workspace when needed.
- If a follow-up conversation URL cannot be reopened, the request must fail clearly rather than silently starting a new conversation.
- Project routing must complete before file attachment, prompt insertion, and send.
- If project routing is enabled and the project cannot be selected or created, the prompt must not be sent.

## Response Completion

- The response observer must track the newest assistant message created after send.
- Completion must require stable response text and no visible stop-generation control.
- An idle composer can count as the completion signal when ChatGPT hides the send button after generation.
- Backend/network response capture can replace low-confidence DOM text, but plain text is the canonical payload.
- Final HTML rendering and sanitization should happen in the side panel.

## Internal Diagnostics

- Diagnostic summaries belong in `background/debug-dump.js` and must stay internal-only unless a separate developer surface is added.
- Content-side frame dumps should include location, visibility state, focus state, ready state, active run, composer/send/stop summaries, and network capture state.
- The normal side panel must not expose diagnostic controls or automation-mode selectors.
