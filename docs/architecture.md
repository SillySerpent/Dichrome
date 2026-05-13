# Architecture

## Surfaces

The prototype has three extension surfaces:

- Background service worker: deterministic orchestration, state machine, tab selection, content-script injection, request history, repair calls.
- ChatGPT content script: page-local DOM adapter, prompt insertion, send action, response observer, adapter snapshot collection.
- Side panel: request display, streaming response, manual request entry, retry controls, local repair settings.

The source webpage does not receive an always-on content script. Selection text comes from the Chrome context menu event, which avoids broad page reads.

## State Machine

The request lifecycle uses these states:

- `IDLE`
- `SELECTED_TEXT_RECEIVED`
- `CHATGPT_TAB_READY`
- `PROMPT_INSERTED`
- `PROMPT_SENT`
- `WAITING_FOR_ASSISTANT_MESSAGE`
- `STREAMING_RESPONSE`
- `RESPONSE_COMPLETE`
- `ERROR_STATE`

The background worker stores request history in `chrome.storage.session` when available. The content script emits state transitions with `chrome.runtime.sendMessage`; the worker records the transition and broadcasts panel updates.

## Tab Selection

The worker searches existing tabs for `chatgpt.com` or `chat.openai.com`, preferring tabs in the same window as the source page and tabs that are not busy. If no candidate exists, it opens `https://chatgpt.com/` with `active: false`.

The extension does not intentionally switch away from the source tab during the normal relay workflow.

## DOM Adapter Strategy

The ChatGPT adapter looks for:

- Composer: editable textbox-like elements with message/prompt semantics, preferably inside `main` or `form`.
- Send button: enabled button-like elements with send semantics, prioritized near the composer.
- Stop button: visible stop/cancel/interrupt generation controls.
- Assistant response: explicit `data-message-author-role="assistant"` containers first, then bounded conversation-area fallbacks.
- File input: `input[type=file]` accepting image files for screenshot attachment attempts.

Response tracking is deliberately scoped. The script selects the newest assistant message after the send action and extracts text only from that message container. It does not stream arbitrary page text.

## Local Repair Boundary

On adapter failure, the content script can send a bounded snapshot of candidate inputs, buttons, and message containers. The background worker may pass that snapshot to a local Ollama-compatible model if enabled.

The local model is constrained to return JSON mapping hints:

```json
{
  "hints": [
    {
      "target": "composer",
      "strategy": "aria",
      "ariaLabelIncludes": "Message",
      "confidence": 0.85,
      "rationale": "Visible textbox near composer controls"
    }
  ]
}
```

The worker validates hints before storing them. A retry can pass validated hints back to the content script, where they are still checked against runtime element predicates before use.
