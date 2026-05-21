# Architecture

## Surfaces

Dichrome has these extension surfaces:

- Background service worker: deterministic orchestration, state machine transitions, message dispatch, and hidden workspace command routing.
- Automation modules: settings migration, hidden workspace session storage, offscreen capability probing, source-tab lookup, and screenshot capture helpers.
- Request modules: request history, attachment payload storage, serialized panel updates, and normalized error metadata.
- ChatGPT content script: page-local DOM adapter, project routing, model selection, prompt insertion, send action, response observer, and internal snapshot collection.
- Side panel: project history, streaming response display, composer, attachments, retry/cancel, model choice, and explicit sign-in handoff.

The source webpage does not receive an always-on content script. Selection text comes from the Chrome context menu event or a user-triggered active-tab read.

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

`CHATGPT_TAB_READY` is retained as a wire-level legacy state name for now. Product-facing text renders it as hidden workspace readiness. Request records also carry an optional `errorCode`, such as `AUTH_REQUIRED`, `HIDDEN_FRAME_UNAVAILABLE`, `PROJECT_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `UPLOAD_REJECTED`, `RATE_LIMITED`, or `CHATGPT_UNAVAILABLE`.

The background worker stores request history in `chrome.storage.session` when available. The content script emits state transitions with `chrome.runtime.sendMessage`; the worker records the transition and broadcasts panel updates.

## Hidden Workspace Selection

The worker stores a hidden workspace session in local extension storage:

```json
{
  "schemaVersion": 1,
  "targetType": "offscreen-frame",
  "tabId": null,
  "windowId": null,
  "offscreenDocumentUrl": "chrome-extension://<id>/offscreen/automation-host.html",
  "currentConversationUrl": "https://chatgpt.com/c/example",
  "currentConversationKey": "example",
  "activeRequestId": null,
  "lastKnownUrl": "https://chatgpt.com/c/example",
  "lastHealthyAt": "2026-05-21T00:00:00.000Z",
  "offscreenCapability": {
    "supported": true,
    "checkedAt": "2026-05-21T00:00:00.000Z",
    "failureReason": null
  }
}
```

Legacy stored visible-tab session data is ignored during migration. The only normal automation route is hidden internal:

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

`mode: "hidden"` probes `chrome.offscreen` with an extension-bundled host page and a ChatGPT iframe. Before creating or reusing the offscreen document, the worker installs a session `declarativeNetRequest` rule through `background/automation/offscreen-frame-policy.js`. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT `sub_frame` responses. Chrome gets the narrowest rule first: `requestDomains: ["chatgpt.com", "chat.openai.com"]`, `resourceTypes: ["sub_frame"]`, and `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that non-tab scope is rejected, or if it installs but no offscreen frame bridge appears after reload, the broader rule still stays limited to ChatGPT subframes.

The ChatGPT content script is registered with `all_frames: true` and `document_start`; if Chrome can inject it into the offscreen ChatGPT iframe, that frame opens a long-lived runtime port to the service worker. The worker sends automation commands through that port instead of using a visible tab as the normal route.

The bridge is deliberately reconnectable. MV3 can restart the background service worker while Chrome keeps the offscreen document alive, which invalidates the worker's in-memory `Port` reference even though the ChatGPT iframe remains loaded. The frame content script reconnects after `Port` disconnects, the worker replaces stale frame ports without letting stale disconnects fail active commands, notifies the offscreen host about bridge connect/disconnect state, and the probe reloads the iframe once with a cache-busted URL when the host load event succeeds but no frame bridge appears.

Chrome offscreen documents cannot directly load arbitrary remote pages as the document URL, so the remote ChatGPT page must still live inside the extension-hosted iframe. The frame-policy override only targets embedding headers; it does not guarantee third-party cookie/session access, ChatGPT app compatibility inside an iframe, frame-script execution, or background streaming. If probing fails, the worker records the failure reason and returns a normalized error. A visible ChatGPT page is allowed only for explicit user-triggered authentication/setup.

## Project Routing

Project routing is stored in local extension storage:

```json
{
  "project": {
    "enabled": true,
    "name": "Dichrome",
    "createIfMissing": true
  }
}
```

The content script treats routing as a pre-send invariant. If routing is enabled, it must establish project context before file upload, prompt insertion, or send. The adapter checks for current project context, then tries a sidebar project item, then optionally opens the ChatGPT project creation UI.

Project navigation deliberately rejects overflow/menu buttons, including controls labelled as more, options, menu, share, rename, delete, archive, or ellipsis. When clicking a project row, the adapter dispatches the click near the left side of the navigation target so it does not hit the three-dot project menu.

This is intentionally fail-closed. If a project cannot be selected or created, the request enters `ERROR_STATE` without sending the prompt.

## Conversation Mode

Normal requests start a fresh ChatGPT conversation after project routing succeeds. Follow-up requests set `mode: "continue"` and `startNewChat: false` regardless of the stored default.

Requests store conversation metadata:

```json
{
  "parentRequestId": "request-parent",
  "conversationMode": "followup",
  "chatConversationUrl": "https://chatgpt.com/c/example",
  "chatConversationKey": "example",
  "automationTargetType": "offscreen-frame"
}
```

The content script emits conversation URL/key metadata on conversation-ready, prompt-sent, streaming, and complete events. A follow-up uses the hidden workspace as the target. If the old conversation URL cannot be reopened in the hidden workspace, the request fails instead of silently starting a new chat.

Project history uses a separate panel command path from request history. The side panel starts a history refresh automatically after settings load, and the manual control is only a refresh affordance. The background worker sends list/load commands to the hidden workspace and first resolves/persists the concrete ChatGPT project id from saved project URLs or the current hidden session. History list/load commands are read-only with respect to browser tab creation: they use the hidden offscreen frame or fail clearly.

The content runtime uses the project id directly when available; otherwise it falls back to name-based project routing with `createIfMissing: false`. History only returns conversations scoped to that project id, including backend project/history results, regular history results that explicitly match the project id, and real project conversation links already exposed on the project page. It does not click guessed project-page rows to discover a conversation id because ChatGPT may treat those clicks as normal navigation. Selecting a history conversation loads the backend conversation mapping and the side panel renders recent messages first, expanding earlier messages in fixed batches when the reader scrolls upward. Sending from a loaded history conversation starts a follow-up request against that conversation URL; pressing `New` clears the loaded history conversation so the next send starts fresh.

## Model Selection

Model selection is stored in local extension storage:

```json
{
  "model": {
    "enabled": false,
    "label": "Thinking",
    "requireExact": false
  }
}
```

The side panel treats a non-empty model label as an enabled model-selection request and silently persists the current model form immediately before each send, follow-up, screenshot request, or retry. The content script then looks for the visible model or composer-mode picker and selects a matching visible option. Detection covers header model controls plus composer-level controls such as `Instant`, `Thinking`, and `Extended`, while avoiding whole popover/menu containers that merely contain several model names. If the requested model cannot be found or confirmed, selection failure stops the request before prompt insertion.

## DOM Adapter Strategy

The ChatGPT adapter looks for:

- Project controls: current project indicators, sidebar project links, and New project dialogs using visible labels and ARIA roles.
- Model controls: visible model-picker buttons and menu/listbox options matching the configured model label.
- Composer: editable textbox-like elements with message/prompt semantics, preferably inside `main` or `form`.
- Send button: enabled button-like elements with send semantics, prioritized near the composer.
- Stop button: visible stop/cancel/interrupt generation controls.
- Assistant response: explicit `data-message-author-role="assistant"` containers first, then bounded conversation-area fallbacks.
- File input: `input[type=file]` accepting user-selected attachment files.
- Fresh hidden project chats: prefer ChatGPT's visible `New chat` control when available, but fall back to direct navigation from `/g/<project>/c/<conversation>` to `/g/<project>/project` when the control is hidden or responsive-layout dependent.
- Screenshot capture: the side panel uses `chrome.tabs.captureVisibleTab` through the user-triggered active-tab capture path. If Chrome has not granted capture access for the active site, the side panel requests optional site access for that active origin only. Browser-internal pages are rejected with a clear error.

Response tracking is deliberately scoped. The script selects the newest assistant message after the send action and extracts content only from that message container. It does not stream arbitrary page text. Plain text is the canonical response payload; final HTML rendering, sanitization, markdown-ish formatting, and local math rendering are centralized in `shared/response-formatting.js` and applied by the side panel.

## Diagnostics Boundary

Internal debug event handling remains limited to packaged runtime status events. Obsolete fallback automation experiments have been removed from the repository and are not available as alternate routes.
