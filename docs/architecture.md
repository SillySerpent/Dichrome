# Architecture

## Surfaces

Dichrome has these extension surfaces:

- Root side-panel shell: active mode display, iframe loading for the selected mode, mode switching, Mode 1 beta acknowledgement, and active Mode 1 request switch guarding.
- Mode 2 side panel: embedded ChatGPT sidebar, screenshot copy/download controls, copyable selected-text prompt state, embedded-frame reload, and fallback ChatGPT companion-window control.
- Mode 1 side panel: project history, streaming response display, composer, attachments, retry/cancel, model choice, and explicit sign-in handoff.
- Background runtime: deterministic orchestration, active-mode message dispatch, shared context-menu routing, side panel opening, Mode 2 companion control, state machine transitions, and Mode 1 hidden workspace command routing.
- Automation modules: settings migration, hidden workspace session storage, Chrome offscreen capability probing, source-tab lookup, and shared screenshot capture helpers.
- Request modules: request history, attachment payload storage, serialized panel updates, and normalized error metadata.
- ChatGPT content scripts: Mode 1 page-local DOM adapter, project routing, model selection, prompt insertion, send action, response observer, and internal snapshot collection; Mode 2 embedded-frame styling/link normalization and URL persistence.
- Source-page content script: shared selected-text quick-action popover on normal `http:` and `https:` webpages, excluding ChatGPT hosts.

The source webpage receives only the shared selection popover content script. The background runtime still treats source-tab lookup and visible screenshot capture as shared services so Mode 1 and Mode 2 do not own separate browser-source logic.

## Mode System

The active mode is stored under `dichrome.activeMode` by `shared/modes.js`.

```json
{
  "dichrome.activeMode": "mode2"
}
```

Fresh installs default to `mode2`. Existing local installs that contain legacy original Dichrome state keys migrate to `mode1` so a previous Mode 1 workflow is not hidden by the new default.

Mode labels are intentionally user-facing:

- `Mode 2 - ChatGPT Sidebar`
- `Mode 1 - Original Dichrome Beta`

The root side-panel page is `sidepanel/sidepanel.html`. It loads `sidepanel/mode2/sidepanel.html` or `sidepanel/mode1.html` in an extension iframe and keeps the mode switcher available above both mode apps. Switching into Mode 1 requires acknowledging the early beta copy. Switching away from Mode 1 is blocked while `chatGptAutomationSession.activeRequestId` is set unless the user explicitly asks to cancel that active request.

Mode state is intentionally separated:

- Shared: active mode, source-tab memory, context-menu dispatch, screenshot capture.
- Mode 2: `dichrome.mode2.chatGptFrameUrl`, `dichrome.mode2.chatGptWindowId`, `dichrome.mode2.latestNotice`, `dichrome.mode2.latestPrompt`, and `dichrome.mode2.latestScreenshot`.
- Mode 1: original automation settings/session/request/history/attachment state.

## State Machine

The request lifecycle uses these states:

- `IDLE`
- `SELECTED_TEXT_RECEIVED`
- `WORKSPACE_READY`
- `PROJECT_READY`
- `CONVERSATION_READY`
- `MODEL_SELECTED`
- `PROMPT_INSERTED`
- `PROMPT_SENT`
- `WAITING_FOR_ASSISTANT_MESSAGE`
- `STREAMING_RESPONSE`
- `RESPONSE_COMPLETE`
- `ERROR_STATE`

`WORKSPACE_READY` is the emitted hidden-workspace readiness state. Older stored request records that still contain `CHATGPT_TAB_READY` are normalized to `WORKSPACE_READY` when panel state is read. Request records also carry an optional `errorCode`, such as `AUTH_REQUIRED`, `HIDDEN_FRAME_UNAVAILABLE`, `PROJECT_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `UPLOAD_REJECTED`, `RATE_LIMITED`, or `CHATGPT_UNAVAILABLE`.

The background worker stores request history in `chrome.storage.session` when available. The content script emits state transitions with `chrome.runtime.sendMessage`; the worker records the transition and broadcasts panel updates.

## Mode 1 Hidden Workspace Selection

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
    "schemaVersion": 6,
    "mode": "hidden"
  }
}
```

`mode: "hidden"` probes an extension-owned host page with embedded ChatGPT iframes. Chrome uses `chrome.offscreen` and `offscreen/automation-host.html`, which hosts separate `chat` and `history` frames. Before creating or reusing the host, the worker installs a session `declarativeNetRequest` rule through `background/automation/offscreen-frame-policy.js`. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT `sub_frame` responses. Chrome gets the narrowest rule first: `requestDomains: ["chatgpt.com", "chat.openai.com"]`, `resourceTypes: ["sub_frame"]`, and `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that non-tab scope is rejected, or if it installs but no hidden frame bridge appears after reload, the broader rule still stays limited to ChatGPT subframes.

The ChatGPT content script is registered with `all_frames: true` and `document_start`; if Chrome can inject it into an extension-hosted ChatGPT iframe, that frame opens a long-lived runtime port to the background runtime. Frame ports are registered by role: the chat frame receives prompt automation, fresh/follow-up navigation, and cancellation; the history frame receives project-history list/load commands.

The bridge is deliberately reconnectable. MV3 can restart the background runtime while the Chrome offscreen document remains alive, which invalidates the worker's in-memory `Port` reference even though the ChatGPT iframe remains loaded. The frame content script reconnects after `Port` disconnects, the worker replaces stale frame ports per role without letting stale disconnects fail active commands for the current port, notifies the host about role bridge connect/disconnect state, and the probe reloads the chat iframe once with a cache-busted URL when the host load event succeeds but no chat bridge appears.

Chrome offscreen documents cannot directly load arbitrary remote pages as the document URL, so the remote ChatGPT page must still live inside an extension-hosted iframe. The frame-policy override only targets embedding headers; it does not guarantee third-party cookie/session access, ChatGPT app compatibility inside an iframe, frame-script execution, or background streaming. If probing fails, the worker records the failure reason and returns a normalized error. A visible ChatGPT page is allowed only for explicit user-triggered authentication/setup.

Non-Chromium packages are out of scope for this project.

## Mode 2 ChatGPT Sidebar

Mode 2 uses the same local ChatGPT subframe header override as the hidden automation probe, but for a visible extension side-panel iframe instead of background automation. It requests the frame-policy setup before loading the embedded ChatGPT frame, stores the last valid ChatGPT frame URL locally, and rewrites embedded ChatGPT links to remain inside the frame where possible.

Mode 2 deliberately does not insert prompts or click ChatGPT's send button. Its selected-text actions produce a local prompt record:

```json
{
  "action": "summarize",
  "prompt": "Summarize the selected text below...",
  "selectedText": "..."
}
```

The user can copy that prompt or interact directly with the embedded ChatGPT frame. When embedding is unavailable or unreliable, Mode 2 opens a focused ChatGPT popup window through the `windows` permission.

## Project Routing

Mode 1 project routing is stored in local extension storage:

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

## Mode 1 Conversation Mode

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

Project history uses a separate panel command path from request history. The side panel starts a history refresh automatically after settings load, and the manual control is only a refresh affordance. In Chrome, every history list/load first hard-reloads the dedicated history frame to the saved project URL when available, otherwise to ChatGPT home. The background worker then sends list/load commands to that frame and first resolves/persists the concrete ChatGPT project id from saved project URLs or the current hidden session. History list/load commands are read-only with respect to browser tab creation: they use the hidden internal frame or fail clearly.

The content runtime uses the project id directly when available; otherwise it falls back to name-based project routing with `createIfMissing: false`. History only returns conversations scoped to that project id, including backend project/history results, regular history results that explicitly match the project id, and real project conversation links already exposed on the project page. It does not click guessed project-page rows to discover a conversation id because ChatGPT may treat those clicks as normal navigation. Selecting a history conversation loads the backend conversation mapping and the side panel renders recent messages first, expanding earlier messages in fixed batches when the reader scrolls upward. Sending from a loaded history conversation starts a follow-up request against that conversation URL; pressing `New` clears the loaded history conversation so the next send starts fresh.

## Mode 1 Model Selection

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

## Mode 1 DOM Adapter Strategy

The ChatGPT adapter looks for:

- Project controls: current project indicators, sidebar project links, and New project dialogs using visible labels and ARIA roles.
- Model controls: visible model-picker buttons and menu/listbox options matching the configured model label.
- Composer: editable textbox-like elements with message/prompt semantics, preferably inside `main` or `form`.
- Send button: enabled button-like elements with send semantics, prioritized near the composer.
- Stop button: visible stop/cancel/interrupt generation controls.
- Assistant response: explicit `data-message-author-role="assistant"` containers first, then bounded conversation-area fallbacks.
- File input: `input[type=file]` accepting user-selected attachment files.
- Fresh hidden project chats: prefer ChatGPT's visible `New chat` control when available, but fall back to direct navigation from `/g/<project>/c/<conversation>` to `/g/<project>/project` when the control is hidden or responsive-layout dependent.
- Screenshot capture: the manifest requests required `<all_urls>` host access so `tabs.captureVisibleTab` does not depend on a transient `activeTab` grant or side-panel runtime permission prompt for normal web pages. The background worker activates the resolved source tab immediately before capture because the browser captures the active visible tab in the requested window. Browser-internal pages are rejected with a clear error when the browser blocks capture.

Response tracking is deliberately scoped. The script selects the newest assistant message after the send action and extracts content only from that message container. It does not stream arbitrary page text. Plain text is the canonical response payload; final HTML rendering, sanitization, markdown-ish formatting, and local math rendering are centralized in `shared/response-formatting.js` and applied by the Mode 1 side panel.

## Shared Source Actions

Context menus, the source-page selection popover, visible screenshot capture, and keyboard screenshot/selection shortcuts enter a shared routing layer first.

- In Mode 2, selected-text actions create a Mode 2 prompt record and screenshots create a Mode 2 screenshot record.
- In Mode 1, selected-text actions start the matching original Dichrome request profile and screenshots start the Mode 1 visible-screenshot attachment request.
- Source-tab focus restoration before `tabs.captureVisibleTab` is shared across both modes.
- Restricted browser pages still fail with the common screenshot error path.

## Diagnostics Boundary

Internal debug event handling remains limited to packaged runtime status events. Obsolete fallback automation experiments have been removed from the repository and are not available as alternate routes.
