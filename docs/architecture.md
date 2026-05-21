# Architecture

## Surfaces

The prototype has three extension surfaces:

- Background service worker: deterministic orchestration, state machine transitions, content-script injection, message dispatch, repair calls.
- Automation modules: settings migration, canonical target session storage, offscreen capability probing, source-focus restoration, and debugger focus emulation.
- Request modules: request history, attachment payload storage, serialized panel updates.
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

## Automation Target Selection

The worker stores a canonical automation session in local extension storage:

```json
{
  "schemaVersion": 1,
  "targetType": "single-tab",
  "tabId": 123,
  "windowId": 456,
  "offscreenDocumentUrl": null,
  "currentConversationUrl": "https://chatgpt.com/c/example",
  "currentConversationKey": "example",
  "activeRequestId": null,
  "lastKnownUrl": "https://chatgpt.com/c/example",
  "lastHealthyAt": "2026-05-14T00:00:00.000Z",
  "offscreenCapability": {
    "supported": false,
    "checkedAt": "2026-05-14T00:00:00.000Z",
    "failureReason": "iframe blocked"
  }
}
```

The old `chatGptAutomationWindowState` is still read once as a migration source. After migration, request history is not the primary source of truth for target reuse.

The default runtime mode attempts a hidden internal target first and otherwise keeps the source page focused while automating exactly one inactive ChatGPT browser tab:

```json
{
  "visibility": {
    "schemaVersion": 5,
    "mode": "hidden",
    "windowWidth": 520,
    "windowHeight": 760
  }
}
```

`mode: "hidden"` probes `chrome.offscreen` with an extension-bundled host page and a ChatGPT iframe. Before creating or reusing the offscreen document, the worker installs a session `declarativeNetRequest` rule through `background/automation/offscreen-frame-policy.js`. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT `sub_frame` responses. Chrome gets the narrowest rule first: `requestDomains: ["chatgpt.com", "chat.openai.com"]`, `resourceTypes: ["sub_frame"]`, and `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that non-tab scope is rejected, or if it installs but no offscreen frame bridge appears after reload, the fallback rule still stays limited to ChatGPT subframes.

The ChatGPT content script is registered with `all_frames: true` and `document_start`; if Chrome can inject it into the offscreen ChatGPT iframe, that frame opens a long-lived runtime port to the service worker. The worker sends automation commands through that port instead of using `chrome.scripting.executeScript` or `tabs.sendMessage`.

The bridge is deliberately reconnectable. MV3 can restart the background service worker while Chrome keeps the offscreen document alive, which invalidates the worker's in-memory `Port` reference even though the ChatGPT iframe remains loaded. The frame content script reconnects after `Port` disconnects, the worker replaces stale frame ports without letting stale disconnects fail active commands, notifies the offscreen host about bridge connect/disconnect state, and the probe reloads the iframe once with a cache-busted URL when the host load event succeeds but no frame bridge appears.

Chrome offscreen documents cannot directly load arbitrary remote pages as the document URL, so the remote ChatGPT page must still live inside the extension-hosted iframe. The frame-policy override only targets embedding headers; it does not guarantee third-party cookie/session access, ChatGPT app compatibility inside an iframe, frame-script execution, or background streaming. If any probe step fails, the worker records the failure reason, removes the frame-policy override, and falls back to `single-tab` behavior.

`mode: "single-tab"` uses the canonical session tab if it still exists and points at ChatGPT. If the stored tab was deleted or navigated away from ChatGPT, only the session target fields are cleared and the next request lazily creates one replacement tab with `active: false`. The worker does not create a duplicate because a ping or content-script probe failed.

Tab-backed background modes use the Chrome debugger permission to attach to the ChatGPT tab and enable DevTools Protocol focus emulation. The worker sends `Emulation.setFocusEmulationEnabled` and `Page.setWebLifecycleState` before the content script starts the run. This keeps ChatGPT lifecycle-visible for streaming DOM updates without switching the user away from the source tab.

`mode: "sidecar"` keeps the older separate popup/window shape for visual inspection, but still uses debugger focus emulation for response streaming. `mode: "focused"` skips debugger focus emulation, focuses ChatGPT while generating, then restores the source tab after `RESPONSE_COMPLETE` or `ERROR_STATE`.

The content script checks `document.visibilityState` at key run stages. In single-tab and sidecar modes, a hidden ChatGPT page is treated as a focus-emulation failure and does not trigger local DOM repair. Offscreen-frame runs use a separate internal visibility mode because offscreen documents cannot be focused. Older stored boolean visibility settings are migrated to `mode: "focused"` when `focusDuringRun` was true, otherwise to `mode: "hidden"`; legacy `mode: "seamless"` also migrates to `hidden`.

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

Normal requests start a fresh ChatGPT conversation after project routing succeeds when this flag is true. Follow-up requests set `mode: "continue"` and `startNewChat: false` regardless of the stored default.

Requests store conversation metadata:

```json
{
  "parentRequestId": "request-parent",
  "conversationMode": "followup",
  "chatConversationUrl": "https://chatgpt.com/c/example",
  "chatConversationKey": "example",
  "automationTargetType": "single-tab"
}
```

The content script emits conversation URL/key metadata on conversation-ready, prompt-sent, streaming, and complete events. A follow-up uses the canonical automation session as the target. If the target tab is alive but on the wrong URL, the worker navigates that same tab back to the parent conversation URL before sending. If the tab was deleted, the worker creates one replacement target and navigates it to the parent conversation URL. If the old conversation URL cannot be reopened, the request fails instead of silently starting a new chat.

Project history uses a separate panel command path from request history. The side panel starts a history refresh automatically after routing settings load, and the manual control is only a refresh affordance. The background worker sends list/load commands to the canonical automation target used for normal requests, but first resolves and persists the concrete ChatGPT project id from open project tabs, saved project URLs, or the current automation session. History list/load commands are read-only with respect to browser tab creation: they can use the hidden offscreen frame or an existing automation tab, but they fail clearly instead of creating a new ChatGPT tab. The explicit `Open workspace` action remains the only project-history path that may focus or create a browser tab.

The content runtime uses the project id directly when available; otherwise it falls back to name-based project routing with `createIfMissing: false`. History only returns conversations scoped to that project id, including backend project/history results, regular history results that explicitly match the project id, and real project conversation links already exposed on the project page. It does not click guessed project-page rows to discover a conversation id because ChatGPT may treat those clicks as normal navigation. Selecting a history conversation loads the backend conversation mapping and the side panel renders recent messages first, expanding earlier messages in fixed batches when the reader scrolls upward. Sending from a loaded history conversation starts a follow-up request against that conversation URL; pressing `New` clears the loaded history conversation so the next send starts fresh.

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

The side panel treats a non-empty model label as an enabled model-selection request and silently persists the current routing/model form immediately before each send, follow-up, screenshot request, or retry. The content script then looks for the visible model or composer-mode picker and selects a matching visible option. Detection covers header model controls plus composer-level controls such as `Instant`, `Thinking`, and `Extended`, while avoiding whole popover/menu containers that merely contain several model names. Model availability is account and plan dependent, so failures are warnings by default. If `requireExact` is enabled, selection failure stops the request before prompt insertion. Follow-up requests keep the saved model setting active while forcing conversation continuation.

## DOM Adapter Strategy

The ChatGPT adapter looks for:

- Project controls: current project indicators, sidebar project links, and New project dialogs using visible labels and ARIA roles.
- Model controls: visible model-picker buttons and menu/listbox options matching the configured model label.
- Composer: editable textbox-like elements with message/prompt semantics, preferably inside `main` or `form`.
- Send button: enabled button-like elements with send semantics, prioritized near the composer.
- Stop button: visible stop/cancel/interrupt generation controls.
- Assistant response: explicit `data-message-author-role="assistant"` containers first, then bounded conversation-area fallbacks.
- File input: `input[type=file]` accepting image files for screenshot attachment attempts.
- Fresh hidden project chats: prefer ChatGPT's visible `New chat` control when available, but fall back to direct navigation from `/g/<project>/c/<conversation>` to `/g/<project>/project` when the control is hidden or responsive-layout dependent.
- Screenshot capture: the local/unpacked prototype requests optional `<all_urls>` host access from the side panel so `chrome.tabs.captureVisibleTab` does not depend on a transient `activeTab` grant for normal web pages.

Response tracking is deliberately scoped. The script selects the newest assistant message after the send action and extracts content only from that message container. It does not stream arbitrary page text. Plain text is the canonical response payload; final HTML rendering, sanitization, markdown-ish formatting, and local math rendering are centralized in `shared/response-formatting.js` and applied by the side panel.

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
