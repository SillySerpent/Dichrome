# Module Map

This repository is intentionally build-free. Browser-loaded files must stay as plain JavaScript modules or classic content scripts that Chrome can load directly from `manifest.json`.

## Shared

- `shared/contracts.js` owns wire-level constants: request states, terminal/streaming helpers, hidden workspace modes, runtime message names, ChatGPT content script order, storage keys, ChatGPT hosts, offscreen frame port name, and response-rendering allowlists.
- `shared/response-formatting.js` owns response text normalization, markdown-ish rendering, ChatGPT writing-block rendering, HTML sanitization, structured ChatGPT reference stripping, and deterministic local math rendering.

Future cross-surface constants and formatting rules belong here first. Do not duplicate message strings or state strings in background, content, side panel, or tests.

## Background

- `background/service-worker.js` is the manifest entrypoint and only imports `background/runtime/app.js`.
- `background/runtime/app.js` registers Chrome listeners and coordinates request lifecycle work.
- `background/runtime/context-menu.js` owns context menu creation and selected-text request handoff.
- `background/runtime/message-router.js` maps runtime message types to injected handlers.
- `background/runtime/project-history-controller.js` owns panel-facing project-history list/load commands. Commands route through hidden automation and fail clearly instead of creating tabs.
- `background/runtime/request-controller.js` owns panel-facing request actions: manual request, screenshot request, follow-up, retry, cancel, and opening ChatGPT only for sign-in/setup.
- `background/runtime/settings-repository.js` owns stored automation and repair settings access.
- `background/debug/debug-dump-collector.js` owns internal diagnostic assembly, including content dump collection and offscreen fallback collection.
- `background/requests/store.js` owns request records, attachment payload persistence, event appends, and panel broadcasts.
- `background/state-machine.js` owns request profiles, prompt construction, request records, and request-state re-exports.
- `background/automation/*` owns hidden workspace session storage, offscreen probing, frame-policy override, source-tab helpers, and automation settings migration.
- `background/focus-emulation.js` is a legacy helper kept out of the normal hidden-only route until dead-path cleanup removes it.
- `background/adapter-repair.js` owns internal repair request/response validation and is not exposed in the normal side panel.

Keep Chrome API orchestration in background runtime modules. Keep target-specific behavior in `background/automation/`. Keep stored request shape changes in `background/requests/store.js` and update tests before changing storage contracts.

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
17. `content/chatgpt/runtime/history/project-history.js`
18. `content/chatgpt/runtime/network/capture-client.js`
19. `content/chatgpt/runtime/offscreen/bridge.js`
20. `content/chatgpt/runtime/page/visibility.js`
21. `content/chatgpt/runtime/debug/dump.js`
22. `content/chatgpt/runtime/response/observer.js`
23. `content/chatgpt/runtime/runner/automation-runner.js`
24. `content/chatgpt/runtime/app.js`
25. `content/chatgpt/90-bootstrap.js`

Ownership:

- `content/chatgpt/runtime/contracts.js` mirrors the shared constants needed by classic content scripts.
- `content/chatgpt/runtime/messaging/messages.js` owns content-script runtime message names and safe fire-and-forget sends.
- `content/chatgpt/runtime/url/chatgpt-url.js` owns ChatGPT URL allow/reject logic, conversation keys, non-automation frame rejection, and project URL normalization.
- `content/chatgpt/runtime/errors/errors.js` owns content-side error classes and error serialization.
- `content/chatgpt/runtime/dom/utils.js` owns generic DOM predicates, writable text helpers, element descriptions, response-node cleanup, hint resolution, candidate collection, and file conversion helpers.
- `content/chatgpt/runtime/async/wait.js` owns cancellation-aware wait helpers and small timing utilities.
- `content/chatgpt/runtime/adapter/options.js` owns adapter option normalization for projects, conversations, model selection, and repair hints.
- `content/chatgpt/runtime/adapter/scoring.js` owns adapter scoring and text-matching helpers for project routing, project creation, new chat, model picker, and model option candidates.
- `content/chatgpt/runtime/adapter/base.js` owns the `ChatGptDomAdapter` class shell, app-shell wait, blocking UI detection, debug snapshots, and repair-hint lookup.
- `content/chatgpt/runtime/adapter/project-routing.js` owns project detection, project sidebar routing, project creation, project dialog actions, and left-side project row click behavior.
- `content/chatgpt/runtime/adapter/conversation.js` owns fresh-chat and continue-conversation decisions.
- `content/chatgpt/runtime/adapter/model-selection.js` owns model picker discovery, model option selection, and exact-match failure policy.
- `content/chatgpt/runtime/adapter/composer-controls.js` owns `ChatGptDomAdapter` composer, send-button, stop-button, and file-input methods.
- `content/chatgpt/runtime/adapter/assistant-response.js` owns `ChatGptDomAdapter` assistant-message discovery, assistant text/html extraction, response error detection, and conversation API response fetch.
- `content/chatgpt/runtime/response/extraction.js` owns backend conversation-data response extraction, full conversation message normalization, low-confidence DOM response scoring, backend-vs-DOM preference, and backend completion-status detection.
- `content/chatgpt/runtime/history/project-history.js` owns project-scoped conversation listing, selected conversation loading, project id validation, and conversion of backend conversation data into side-panel history payloads. It may read backend history data and real conversation links, but it must not click guessed project-page rows as a discovery mechanism.
- `content/chatgpt/runtime/network/capture-client.js` owns main-world response-capture injection, capture event state, access-token caching, and network capture debug state.
- `content/chatgpt/runtime/offscreen/bridge.js` owns hidden/offscreen iframe bridge connection, ready announcements, reconnect timers, direct-app-frame detection, extension-ancestor checks, and offscreen frame command forwarding.
- `content/chatgpt/runtime/page/visibility.js` owns hidden workspace visibility normalization and visibility assertions.
- `content/chatgpt/runtime/debug/dump.js` owns content-side event/debug emission, conversation metadata, error payloads, and DOM debug dump assembly.
- `content/chatgpt/runtime/response/observer.js` owns assistant response streaming, DOM/backend/network response selection, completion detection, and response completion events.
- `content/chatgpt/runtime/runner/automation-runner.js` owns the request lifecycle from app-shell readiness through project routing, conversation setup, model selection, attachment upload, prompt send, and response observation handoff.
- `content/chatgpt/runtime/app.js` owns top-level dependency wiring, adapter method composition, Chrome message registration, active-run/history locking, and module startup.
- `content/chatgpt/90-bootstrap.js` stays a small marker/entrypoint after runtime modules have loaded.
- `content/chatgpt/main-world-capture.js` runs in the page world and emits plain text as the canonical response payload. Final HTML rendering and sanitization belongs in the side panel through `shared/response-formatting.js`.

Future content-runtime changes should usually land in the concern-specific module above. Keep `runtime/app.js` as wiring only unless a change genuinely crosses module boundaries.

## Side Panel

- `sidepanel/sidepanel.js` is the HTML entrypoint and only imports `sidepanel/runtime/app.js`.
- `sidepanel/runtime/app.js` owns panel initialization, event binding, panel state loading, request actions, project-history UI state, product-facing model settings, sign-in handoff, and top-level rendering.
- `sidepanel/runtime/dom.js` owns DOM id lookup.
- `sidepanel/runtime/client.js` owns checked `chrome.runtime.sendMessage` calls.
- `sidepanel/runtime/project-history-state.js` owns project-history side-panel state creation, local persistence, and project-key normalization.
- `sidepanel/runtime/state.js` owns panel-facing running/streaming helpers using shared request-state contracts.
- `sidepanel/runtime/response-view.js` owns sanitized response insertion, auto-scroll state, copyable code/math blocks, and clipboard writes.
- `sidepanel/runtime/response-animation.js` owns the streaming typewriter animation.

Keep side-panel DOM ids stable unless the HTML/CSS are changed in the same pass. Response HTML must flow through `shared/response-formatting.js` and `response-view.js`, not one-off renderers.

## Scripts And Tests

- `scripts/validate-extension.mjs` validates required files, manifest shape, content script order, PNG signatures, and JavaScript syntax.
- `scripts/package-extension.mjs` builds the Chrome Web Store upload ZIP from runtime extension files after validation.
- `scripts/test.mjs` is the test aggregator.
- `scripts/test-contracts.mjs` guards shared constants and manifest content script order.
- `scripts/test-response-formatting.mjs` guards response rendering, sanitizer behavior, structured writing/task-list/table cases, and math fallback behavior.
- `scripts/test-content-runtime-url.mjs` guards ChatGPT URL allow/reject logic.
- Other `scripts/test-*.mjs` files cover settings, request records, automation session storage, offscreen frame policy, and offscreen target behavior.

Add narrowly scoped Node tests when extracting pure logic. Add manual smoke-test notes when behavior depends on Chrome, ChatGPT UI state, login state, or offscreen document behavior.
