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
- `PROJECT_READY`
- `CONVERSATION_READY`
- `MODEL_SELECTED`
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

## Visibility Mode

The default runtime mode keeps the source page focused and automates ChatGPT in an inactive browser tab:

```json
{
  "visibility": {
    "schemaVersion": 4,
    "mode": "seamless",
    "windowWidth": 520,
    "windowHeight": 760
  }
}
```

`mode: "seamless"` uses the Chrome debugger permission to attach to the ChatGPT tab and enable DevTools Protocol focus emulation. The worker sends `Emulation.setFocusEmulationEnabled` and `Page.setWebLifecycleState` before the content script starts the run. This keeps ChatGPT lifecycle-visible for streaming DOM updates without switching the user away from the source tab.

The first seamless run may create one inactive ChatGPT tab if no reusable ChatGPT tab exists. That tab is required because this prototype drives the real ChatGPT web UI; it is not an API client. The tab is created with `active: false`, and the source page remains focused.

The automation tab id is persisted in local extension storage and can also be recovered from recent request history. The worker prefers that remembered tab over creating a new one. Fresh unrelated requests create a new ChatGPT conversation inside the remembered tab when `conversation.startNewChat` is true.

`mode: "sidecar"` keeps the older separate popup/window shape for visual inspection, but still uses debugger focus emulation for response streaming. `mode: "focused"` skips debugger focus emulation, focuses ChatGPT while generating, then restores the source tab after `RESPONSE_COMPLETE` or `ERROR_STATE`.

The content script checks `document.visibilityState` at key run stages. In seamless and sidecar modes, a hidden ChatGPT page is treated as a focus-emulation failure and does not trigger local DOM repair. Visibility settings include a schema version. Older stored boolean visibility settings are migrated to `mode: "focused"` when `focusDuringRun` was true, otherwise to `mode: "seamless"`.

## Project Routing

Project routing is stored in local extension storage:

```json
{
  "project": {
    "enabled": true,
    "name": "ChatGPT Page Relay Prototype",
    "createIfMissing": true
  }
}
```

The content script treats routing as a pre-send invariant. If routing is enabled, it must establish project context before file upload, prompt insertion, or send. The adapter checks for current project context, then tries a sidebar project item, then optionally opens the ChatGPT project creation UI.

Project navigation deliberately rejects overflow/menu buttons, including controls labelled as more, options, menu, share, rename, delete, archive, or ellipsis. When clicking a project row, the adapter dispatches the click near the left side of the navigation target so it does not hit the three-dot project menu.

This is intentionally fail-closed. If a project cannot be selected or created, the request enters `ERROR_STATE` without sending the prompt.

## Conversation Mode

Conversation mode is stored in local extension storage:

```json
{
  "conversation": {
    "startNewChat": true
  }
}
```

Normal requests start a fresh ChatGPT conversation after project routing succeeds. Follow-up requests set `startNewChat` to false and reuse the ChatGPT tab associated with the previous request.

## Model Selection

Model selection is also stored in local extension storage:

```json
{
  "model": {
    "enabled": false,
    "label": "Thinking",
    "requireExact": false
  }
}
```

The content script looks for the visible model picker and selects a matching visible option. Model availability is account and plan dependent, so failures are warnings by default. If `requireExact` is enabled, selection failure stops the request before prompt insertion.

## DOM Adapter Strategy

The ChatGPT adapter looks for:

- Project controls: current project indicators, sidebar project links, and New project dialogs using visible labels and ARIA roles.
- Model controls: visible model-picker buttons and menu/listbox options matching the configured model label.
- Composer: editable textbox-like elements with message/prompt semantics, preferably inside `main` or `form`.
- Send button: enabled button-like elements with send semantics, prioritized near the composer.
- Stop button: visible stop/cancel/interrupt generation controls.
- Assistant response: explicit `data-message-author-role="assistant"` containers first, then bounded conversation-area fallbacks.
- File input: `input[type=file]` accepting image files for screenshot attachment attempts.

Response tracking is deliberately scoped. The script selects the newest assistant message after the send action and extracts content only from that message container. It does not stream arbitrary page text. The content script emits both plain text and sanitized HTML fragments so the side panel can show basic formatting such as lists, tables, blockquotes, code blocks, and inline code.

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
