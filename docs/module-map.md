# Module Map

This repository is intentionally build-free. Browser-loaded files must stay as plain JavaScript modules or classic content scripts that Chrome can load directly from the packaged manifest.

No separate non-Chromium package is built; keep platform-specific code scoped to Chrome/Chromium side-panel and offscreen APIs. Firefox support is no longer considered because Firefox provides a GPT sidebar by default, so Firefox-specific manifests, sidebar hosts, and bridge origins should stay out of the repository.

## Shared

- `shared/contracts.js` owns wire-level constants: request states, terminal/streaming helpers, hidden workspace modes, runtime message names, ChatGPT content script order, storage keys, ChatGPT hosts, offscreen frame port name and roles, and response-rendering allowlists.
- `shared/modes.js` owns the active mode contract: default Mode 2 behavior, legacy Mode 1 migration, mode labels, mode-switch message names, and public mode listing.
- `shared/response-formatting.js` owns response text normalization, markdown-ish rendering, ChatGPT writing-block rendering, HTML sanitization, structured ChatGPT reference stripping, and deterministic local math rendering.
- `shared/response/escaping.js` and `shared/response/sanitizer.js` own helper internals that remain re-exported through `shared/response-formatting.js`.

Future cross-surface constants and formatting rules belong here first. Do not duplicate message strings or state strings in background, content, side panel, or tests.

## Background

- `background/service-worker.js` is the manifest entrypoint and only imports `background/runtime/app.js`.
- `background/runtime/app.js` composes runtime controllers and registers extension listeners.
- `background/runtime/automation-events.js` owns content-side automation event recording, terminal-state cleanup, debug event appends, hidden bridge disconnect errors, and request error persistence.
- `background/runtime/context-menu.js` owns shared context menu creation plus active-mode dispatch for selected-text and visible-screenshot actions.
- `background/runtime/error-classification.js` owns request error-code classification and coded error creation.
- `background/runtime/message-router.js` maps runtime message types to injected handlers.
- `background/runtime/project-history-controller.js` owns panel-facing project-history list/load commands. Chrome commands hard-reload and route through the hidden history frame; all history commands fail clearly instead of creating tabs.
- `background/runtime/request-controller.js` owns panel-facing request actions: manual request, screenshot request, follow-up, retry, cancel, and opening ChatGPT only for sign-in/setup.
- `background/runtime/request-orchestrator.js` owns request record creation, automation setting resolution, hidden-workspace readiness checks, fresh/follow-up navigation, and chat-frame run dispatch.
- `background/runtime/settings-repository.js` owns stored automation settings access.
- `background/runtime/side-panel-state.js` owns Chrome side-panel open/close tracking.
- `background/runtime/workspace-readiness.js` owns hidden workspace probing retries and readiness presentation.
- `background/debug-dump.js` owns internal diagnostic summarization for packaged runtime status events.
- `background/requests/store.js` owns request records, attachment payload persistence, event appends, and panel broadcasts.
- `background/state-machine.js` owns request profiles, prompt construction, request records, and request-state re-exports.
- `background/automation/*` owns hidden workspace session storage, Chrome offscreen probing, role-scoped offscreen frame ports, frame-policy override, source-tab helpers, and automation settings migration.
- `background/mode2/companion-controller.js` owns Mode 2 prompt-copy records, screenshot records, embedded-frame policy setup, selected-text prompt construction, keyboard command helpers, and fallback ChatGPT companion-window control.

Keep shared browser API orchestration in background runtime modules. Keep Mode 1 target-specific behavior in `background/automation/`. Keep Mode 2 companion behavior in `background/mode2/`. Keep stored request shape changes in `background/requests/store.js` and update tests before changing storage contracts.

## Source Page Content

- `content/shared/selection-popover.js` owns the shared selected-text quick-action toolbar on normal webpages. It sends shared action messages only; the background runtime decides whether Mode 1 or Mode 2 handles the action.
- The shared popover must stay off ChatGPT hosts, extension pages, browser-internal pages, and non-HTTP(S) documents.

## ChatGPT Content Runtime

Manifest order is the contract:

1. `content/chatgpt/00-namespace.js`
2. `content/chatgpt/runtime/contracts.js`
3. `content/chatgpt/runtime/messaging/messages.js`
4. `content/chatgpt/runtime/url/chatgpt-url.js`
5. `content/chatgpt/runtime/errors/errors.js`
6. `content/chatgpt/runtime/dom/utils.js`
7. `content/chatgpt/runtime/async/wait.js`
8. `content/chatgpt/runtime/adapter/options.js`
9. `content/chatgpt/runtime/adapter/scoring.js`
10. `content/chatgpt/runtime/adapter/base.js`
11. `content/chatgpt/runtime/adapter/project-routing.js`
12. `content/chatgpt/runtime/adapter/conversation.js`
13. `content/chatgpt/runtime/adapter/model-selection.js`
14. `content/chatgpt/runtime/adapter/composer-controls.js`
15. `content/chatgpt/runtime/adapter/assistant-response.js`
16. `content/chatgpt/runtime/response/extraction.js`
17. `content/chatgpt/runtime/history/project-history-data.js`
18. `content/chatgpt/runtime/history/project-history.js`
19. `content/chatgpt/runtime/network/capture-client.js`
20. `content/chatgpt/runtime/offscreen/bridge.js`
21. `content/chatgpt/runtime/page/visibility.js`
22. `content/chatgpt/runtime/debug/dump.js`
23. `content/chatgpt/runtime/response/observer.js`
24. `content/chatgpt/runtime/runner/automation-runner.js`
25. `content/chatgpt/runtime/app.js`
26. `content/chatgpt/90-bootstrap.js`

Ownership:

- `content/chatgpt/runtime/contracts.js` mirrors the shared constants needed by classic content scripts.
- `content/chatgpt/runtime/messaging/messages.js` owns content-script runtime message names and safe fire-and-forget sends.
- `content/chatgpt/runtime/url/chatgpt-url.js` owns ChatGPT URL allow/reject logic, conversation keys, non-automation frame rejection, and project URL normalization.
- `content/chatgpt/runtime/errors/errors.js` owns content-side error classes and error serialization.
- `content/chatgpt/runtime/dom/utils.js` owns generic DOM predicates, writable text helpers, element descriptions, response-node cleanup, hint resolution, candidate collection, and file conversion helpers.
- `content/chatgpt/runtime/async/wait.js` owns cancellation-aware wait helpers and small timing utilities.
- `content/chatgpt/runtime/adapter/options.js` owns adapter option normalization for projects, conversations, and model selection.
- `content/chatgpt/runtime/adapter/scoring.js` owns adapter scoring and text-matching helpers for project routing, project creation, new chat, model picker, and model option candidates.
- `content/chatgpt/runtime/adapter/base.js` owns the `ChatGptDomAdapter` class shell, app-shell wait, blocking UI detection, debug snapshots, and repair-hint lookup.
- `content/chatgpt/runtime/adapter/project-routing.js` owns project detection, project sidebar routing, project creation, project dialog actions, and left-side project row click behavior.
- `content/chatgpt/runtime/adapter/conversation.js` owns fresh-chat and continue-conversation decisions.
- `content/chatgpt/runtime/adapter/model-selection.js` owns model picker discovery, model option selection, and exact-match failure policy.
- `content/chatgpt/runtime/adapter/composer-controls.js` owns `ChatGptDomAdapter` composer, send-button, stop-button, and file-input methods.
- `content/chatgpt/runtime/adapter/assistant-response.js` owns `ChatGptDomAdapter` assistant-message discovery, assistant text/html extraction, response error detection, and conversation API response fetch.
- `content/chatgpt/runtime/response/extraction.js` owns backend conversation-data response extraction, full conversation message normalization, low-confidence DOM response scoring, backend-vs-DOM preference, and backend completion-status detection.
- `content/chatgpt/runtime/history/project-history-data.js` owns project-history payload normalization, project membership checks, conversation URL normalization, pagination cursors, and DOM project-link conversion.
- `content/chatgpt/runtime/history/project-history.js` owns project-scoped conversation listing, selected conversation loading, project id validation, backend/API coordination, and project-page navigation. It may read backend history data and real conversation links, but it must not click guessed project-page rows as a discovery mechanism.
- `content/chatgpt/runtime/network/capture-client.js` owns main-world response-capture injection, capture event state, access-token caching, and network capture debug state.
- `content/chatgpt/runtime/offscreen/bridge.js` owns hidden iframe bridge connection, role-aware ready announcements, reconnect timers, direct-app-frame detection, Chrome extension-ancestor checks, and hidden frame command forwarding.
- `content/chatgpt/runtime/page/visibility.js` owns hidden workspace visibility normalization and visibility assertions.
- `content/chatgpt/runtime/debug/dump.js` owns content-side event/debug emission, conversation metadata, error payloads, and DOM debug dump assembly.
- `content/chatgpt/runtime/response/observer.js` owns assistant response streaming, DOM/backend/network response selection, completion detection, and response completion events.
- `content/chatgpt/runtime/runner/automation-runner.js` owns the request lifecycle from app-shell readiness through project routing, conversation setup, model selection, attachment upload, prompt send, and response observation handoff.
- `content/chatgpt/runtime/app.js` owns top-level dependency wiring, adapter method composition, extension message registration, active-run/history locking, and module startup.
- `content/chatgpt/90-bootstrap.js` stays a small marker/entrypoint after runtime modules have loaded.
- `content/chatgpt/main-world-capture.js` runs in the page world and emits plain text as the canonical response payload. Final HTML rendering and sanitization belongs in the side panel through `shared/response-formatting.js`.
- `content/mode2/chatgpt-frame-theme.js` runs only in direct extension-hosted ChatGPT iframes. It owns Mode 2 frame dark-theme hints, same-frame ChatGPT link behavior, and `dichrome.mode2.chatGptFrameUrl` persistence. It must not take over top-level ChatGPT tabs.

Future content-runtime changes should usually land in the concern-specific module above. Keep `runtime/app.js` as wiring only unless a change genuinely crosses module boundaries.

## Side Panel

- `sidepanel/sidepanel.html`, `sidepanel/shell.css`, and `sidepanel/shell.js` are the root side-panel shell. The shell owns mode iframe loading, active mode labels, mode settings, the Mode 1 beta acknowledgement, and active Mode 1 request switch guarding.
- `sidepanel/mode2/sidepanel.html`, `sidepanel/mode2/sidepanel.css`, and `sidepanel/mode2/sidepanel.js` own the default Mode 2 ChatGPT sidebar companion UI.
- `sidepanel/mode1.html` hosts the original Dichrome Mode 1 beta app.
- `sidepanel/sidepanel.js` is the Mode 1 HTML entrypoint and imports `sidepanel/runtime/app.js`.
- `sidepanel/runtime/app.js` owns panel initialization, event binding, panel state loading, request actions, project-history UI state, sign-in handoff, and top-level rendering.
- `sidepanel/runtime/settings-dialog.js` owns the routing/model settings popup form, summary label, and settings payload collection.
- `sidepanel/runtime/attachment-limits.js` owns pending attachment count, image count, and total-byte caps before request payloads are stored or sent.
- `sidepanel/runtime/attachments.js` owns screenshot permission prompts, visible-tab screenshot attachment construction, user file attachment normalization, and explicit pasted/dropped image-URL attachment construction.
- `sidepanel/runtime/pending-attachments.js` owns pending attachment normalization and attachment-chip rendering.
- `sidepanel/runtime/drop-content.js` owns drag-and-drop payload normalization for files, selected text, links, and webpage image descriptors before they enter the composer.
- `sidepanel/runtime/message-cards.js` owns empty-chat, loaded-history, sent-user, and assistant message-card rendering.
- `sidepanel/runtime/selection-context.js` owns selected-webpage-text normalization, dismissal, replacement, and empty-selection state transitions.
- `sidepanel/runtime/dom.js` owns DOM id lookup.
- `sidepanel/runtime/client.js` owns checked `chrome.runtime.sendMessage` calls.
- `sidepanel/runtime/project-history-state.js` owns project-history side-panel state creation, local persistence, and project-key normalization.
- `sidepanel/runtime/state.js` owns panel-facing running/streaming helpers using shared request-state contracts.
- `sidepanel/runtime/status-formatting.js` owns request status labels, auth-required checks, compact history dates, and legacy ready-state display normalization.
- `sidepanel/runtime/response-view.js` owns sanitized response insertion, auto-scroll state, copyable code/math blocks, and clipboard writes.
- `sidepanel/runtime/response-animation.js` owns the streaming typewriter animation.

Keep side-panel DOM ids stable unless the HTML/CSS are changed in the same pass. Mode 1 response HTML must flow through `shared/response-formatting.js` and `response-view.js`, not one-off renderers. Mode 2 must keep prompt/screenshot records under `dichrome.mode2.*` keys and avoid importing Mode 1 request rendering modules.

## Scripts And Tests

- `scripts/validate-extension.mjs` validates required files, manifest shape, content script order, PNG signatures, and JavaScript syntax.
- `scripts/manifest-targets.mjs` validates the supported Chrome package target.
- `scripts/package-extension.mjs` builds the Chrome ZIP from runtime extension files after validation.
- `scripts/test.mjs` is the test aggregator.
- `scripts/test-contracts.mjs` guards shared constants and manifest content script order.
- `scripts/test-modes.mjs` guards active mode defaults, legacy Mode 1 migration, explicit switches, and invalid modes.
- `scripts/test-mode-shell.mjs` guards the root shell, Mode 1 beta warning, active-request switch guard, Mode 2 side-panel files, Mode 2 content scripts, and Mode 2 permissions.
- `scripts/test-response-formatting.mjs` guards response rendering, sanitizer behavior, structured writing/task-list/table cases, and math fallback behavior.
- `scripts/test-content-runtime-url.mjs` guards ChatGPT URL allow/reject logic.
- `scripts/test-composer-upload-error-detection.mjs` and `scripts/test-composer-attachment-upload-status.mjs` guard ChatGPT-side upload-error detection, file-input compatibility, and accepted-attachment readiness before send.
- `scripts/test-sidepanel-attachment-limits.mjs`, `scripts/test-sidepanel-attachments.mjs`, `scripts/test-sidepanel-pending-attachments.mjs`, `scripts/test-sidepanel-drop-content.mjs`, and `scripts/test-sidepanel-selection-context.mjs` guard attachment caps, image-URL attachment construction, pending-chip rendering, drag/drop composer insertion, and selected-text state transitions.
- `scripts/test-sidepanel-message-cards.mjs` and `scripts/test-sidepanel-status-formatting.mjs` guard extracted side-panel render/status modules.
- `scripts/test-utils/*` contains reusable dependency-free fakes for tests.
- Other `scripts/test-*.mjs` files cover settings, request records, automation session storage, target manifests, offscreen frame policy, bridge origin checks, and hidden target behavior.

Add narrowly scoped Node tests when extracting pure logic. Add manual smoke-test notes when behavior depends on browser APIs, ChatGPT UI state, login state, or Chrome offscreen document behavior.
