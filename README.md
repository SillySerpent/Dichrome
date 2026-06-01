# Dichrome

Local-first Chrome/Chromium and Firefox extension for routing selected webpage text into an already-open assistant workspace, then reflecting the assistant response in an extension side panel.

This is intentionally UI-driven. It does not use the OpenAI API and does not require a hosted backend. Dichrome depends on the user's signed-in ChatGPT browser session and uses packaged extension code to drive the visible ChatGPT web UI.

## Current Workflow

1. Highlight text on a normal webpage.
2. Use the selection context menu:
   - `Ask assistant about this`
   - `Define this word or phrase`
   - `Summarize this selection`
3. The background service worker opens the extension side panel for the source tab.
4. The worker resolves the hidden internal ChatGPT workspace.
5. If project routing is enabled, the ChatGPT content script selects the configured project or creates it before sending.
6. Normal requests start from a fresh chat by default; follow-ups continue the active hidden workspace conversation.
7. If model selection is enabled, the content script tries to select the configured model label.
8. The content script inserts the generated prompt into the visible composer and clicks the send button.
9. The content script tracks the newest assistant message and streams formatted updates back to the side panel.
10. A visible ChatGPT page is opened only when the user explicitly chooses the sign-in handoff.

## Files

- `manifest.json` - Chrome MV3 source manifest, permissions, side-panel entry, side-panel shortcut command, all-sites screenshot host access, ChatGPT host permissions, offscreen permission, and the DNR host-access permission used for hidden iframe frame-policy overrides.
- `shared/contracts.js` - shared request states, message strings, hidden workspace constants, content script order, and response-rendering allowlists.
- `shared/response-formatting.js` - response normalization, markdown-ish rendering, HTML sanitization, and deterministic local math rendering.
- `shared/error-messages.js` - centralized user-facing error titles, details, and action labels.
- `background/service-worker.js` - small manifest-loaded entrypoint for the background runtime.
- `background/runtime/*` - listener orchestration, runtime message routing, request control, and settings repositories.
- `background/runtime/project-history-controller.js` - project-scoped conversation history list/load routing through the hidden internal workspace.
- `background/debug-dump.js` - internal diagnostic summarization kept out of the normal side-panel UI.
- `background/automation/settings.js` - stored ChatGPT project-routing, visibility, and model-selection settings.
- `background/automation/session.js` - hidden workspace session storage and migration away from legacy remembered visible-tab data.
- `background/automation/tab-target.js` - legacy visible-tab helpers kept out of the normal product route until a later dead-path pass removes them.
- `background/automation/offscreen-target.js` - hidden internal target capability probe, frame bridge, Chrome offscreen host routing, Firefox sidebar host routing, and failure reason tracking.
- `background/automation/offscreen-frame-policy.js` - session-scoped ChatGPT subframe header override for local hidden-internal probing.
- `background/automation/source-focus.js` - source-tab selection, source-focus restoration, and screenshot capture helpers.
- `background/requests/store.js` - request history, attachment payload storage, event appends, and panel update broadcasts.
- `background/focus-emulation.js` - legacy focus-emulation helper kept out of the normal hidden-only route.
- `background/state-machine.js` - request states and prompt profiles.
- `content/chatgpt/*` - ordered injected ChatGPT-side automation entrypoints.
- `content/chatgpt/runtime/*` - ChatGPT-side runtime layers for contracts, messaging, URL/frame decisions, errors, adapter heuristics, response extraction, and the automation runner.
- `content/chatgpt/runtime/history/project-history.js` - project-scoped history listing and selected conversation loading through ChatGPT's signed-in web session.
- `sidepanel/*` - side panel HTML/CSS and entrypoint.
- `sidepanel/runtime/*` - side panel client, DOM lookup, state helpers, attachment handling, Firefox internal frame host, response view, response animation, settings dialog, and app orchestration.
- `docs/setup-and-usage.md` - setup, permission, and day-to-day usage instructions.
- `docs/module-map.md` - maintainer map for module ownership and future extraction boundaries.
- `docs/hidden-internal-invariants.md` - hidden internal mode behaviors that must not regress.
- `docs/manual-smoke-tests.md` - manual validation scenarios for browser-dependent behavior.
- `assets/icon.svg` and `icons/*` - source and generated browser toolbar icons.
- `scripts/validate-extension.mjs` - dependency-free static validation.
- `scripts/manifest-targets.mjs` - Chrome and Firefox manifest transforms used by validation and packaging.
- `scripts/generate-icons.mjs` - dependency-free icon generator.

## Load Locally

Chrome/Chromium:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository directory.
5. Accept the extension permissions. Dichrome requests all-sites host access so visible screenshot capture works on normal web tabs without a temporary `activeTab` grant.
6. Open Dichrome from the toolbar or with `Alt+Shift+D`.
7. Sign in to ChatGPT in a normal browser tab before testing selection relay.

Firefox:

1. Run `npm run package:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose Load Temporary Add-on.
4. Select `.dist/firefox/package/manifest.json`.
5. Sign in to ChatGPT in a normal browser tab before testing selection relay.

See `docs/setup-and-usage.md` for the full setup and operator workflow.

## Validation

Run:

```bash
npm run check
npm test
```

No install step is required; both scripts only use Node built-ins.

Create browser upload ZIPs after validation:

```bash
npm run package
```

The Chrome ZIP is written to `.dist/chrome/dichrome-<version>-chrome.zip`. The Firefox ZIP is written to `.dist/firefox/dichrome-<version>-firefox.zip`.

Build one browser package at a time when needed:

```bash
npm run package:chrome
npm run package:firefox
```

Regenerate icons after editing `assets/icon.svg` or `scripts/generate-icons.mjs`:

```bash
npm run icons
```

## Design Notes

The automation is split deliberately:

- The background worker owns request state and hidden workspace routing.
- The ChatGPT content script owns deterministic DOM interaction.
- The side panel owns display and operator controls.
- Internal diagnostics are kept out of the normal sidebar UI; obsolete fallback automation experiments are no longer part of the product build.

The ChatGPT adapter avoids whole-page scraping for response extraction. It looks for assistant message containers using semantic attributes first, then bounded conversation-area fallbacks. Once a candidate response is selected, the observer only tracks that message's content. Completion requires several signals: response stability, no visible stop-generation control, an enabled send button, and no detected error UI.

The content runtime is layered under `content/chatgpt/runtime/`: `adapter/` owns ChatGPT DOM heuristics, `response/` owns response extraction and observation, `history/` owns project-scoped conversation history loading, `network/` owns main-world response capture, `offscreen/` owns the hidden iframe bridge shared by Chrome offscreen and Firefox sidebar hosts, `page/` owns visibility checks, `debug/` owns content-side dumps and event payloads, and `runner/` owns the request lifecycle. `runtime/app.js` composes those modules and registers extension message listeners.

The side panel stores plain text as the canonical response payload and renders final HTML through `shared/response-formatting.js`. The renderer preserves common generated formatting such as paragraphs, lists, task lists, tables, ChatGPT writing blocks, blockquotes, inline code, code blocks, strikethrough, and common local math expressions including accents, primes, fractions, roots, matrices, matrix products, and cases while removing scripts, forms, buttons, iframes, event attributes, and unsafe links. If a math expression cannot be parsed confidently, it is shown as escaped source in a styled fallback instead of malformed HTML.

## Automation Target Mode

`Hidden internal` is the default mode. It first installs a session-scoped `declarativeNetRequest` rule for ChatGPT subframe responses. Chrome then creates an offscreen document that hosts a ChatGPT iframe. Firefox does not provide Chrome's offscreen API, so the Firefox build uses the opened extension sidebar as the extension-owned hidden iframe host. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT subframe responses so Dichrome can test hidden iframe automation. The rule is scoped to non-tab ChatGPT subframe requests when Chrome accepts `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that scoped rule is rejected, or if it installs but the ChatGPT bridge still never connects, the extension falls back to a ChatGPT-subframe-only rule. The rule is removed when hidden automation is closed or when the probe records hidden automation as unsupported.

The ChatGPT automation content script is registered for all ChatGPT frames at `document_start`; when the browser can inject it into the extension-hosted ChatGPT iframe, the frame opens a runtime port back to the background runtime and accepts automation commands through that port. The frame bridge reconnects if the background runtime restarts while the host document survives, and the background probe reloads the iframe once with a cache-busting probe URL if the host reports that ChatGPT loaded but the bridge still did not connect.

If ChatGPT blocks cookies, frame-script injection, account/session access, or background streaming after that recovery path, Dichrome fails the request with a user-facing error instead of opening or controlling a visible ChatGPT automation tab. The side panel offers an explicit `Open ChatGPT to sign in` action for authentication/setup only.

## Project Routing

Project routing is enabled by default and uses the extension name as the project name. Before a normal prompt is sent, the ChatGPT content script tries to:

1. Detect whether the current ChatGPT page is already scoped to the configured project.
2. Select the project from the ChatGPT sidebar if it exists.
3. Create the project through the visible ChatGPT UI if it is missing and `Create if missing` is enabled.

If project routing is enabled and the project cannot be selected or created, the request fails before the prompt is sent. That is intentional because sending outside the project would create the main-history clutter this feature is meant to avoid.

The project picker avoids sidebar overflow/menu controls and clicks the left side of the project navigation row. This is important because ChatGPT exposes a separate three-dot project menu beside each project.

The side panel loads project history automatically for the configured project. Loading history resolves and remembers the concrete ChatGPT project id from saved project URLs or the hidden workspace before falling back to name-based project routing with project creation disabled. It then lists conversations returned by project-scoped history endpoints, regular history responses that explicitly match that project id, or real project conversation links already exposed on the project page. It does not click guessed project-page rows and does not create a browser tab just to load history; if hidden history loading is unavailable, it fails clearly. Selecting a conversation fetches its backend conversation mapping, renders the newest messages first, and reveals earlier messages in batches as the side-panel chat scrolls upward. Sending while a loaded history conversation is active continues that conversation URL; pressing `New` clears the loaded conversation and starts a separate fresh chat on the next send.

## Conversation Mode

Normal context-menu and manual requests create a fresh ChatGPT conversation after project routing succeeds, inside the hidden workspace. Follow-up requests force `startNewChat: false`, reopen the saved parent conversation URL in the hidden workspace when needed, and fail clearly if the previous conversation cannot be reopened.

## Model Selection

Model selection is optional until a model label is entered. Enter or choose the visible ChatGPT model/mode label from your account, such as `Auto`, `Instant`, `Thinking`, `Extended`, `Pro`, or another label shown in your picker. Choosing a label automatically enables model selection, and the side panel saves the current model form before each send, follow-up, screenshot request, or retry so the next request uses the visible selector value.

When a model label is requested, model-selection failure stops the request before the prompt is sent. This avoids accidentally sending with whatever model ChatGPT last had selected. With `Require exact match` off, the selector may use known aliases such as `Fast answers` for `Instant`; with it on, it only accepts the requested label text as a standalone match.

## Screenshot Status

The side panel includes a visible-screenshot attachment request. It uses the browser `tabs.captureVisibleTab` API, so the manifest requests required `<all_urls>` host access instead of relying on a transient `activeTab` grant or a side-panel runtime permission prompt. Before capture, the background worker activates the resolved source tab so the browser captures the intended visible viewport. It captures the visible viewport, not a stitched full-page screenshot. Browsers can still block restricted surfaces such as `chrome://` pages, the Chrome Web Store, and other extension pages. Full-page screenshot support would need a separate scroll-and-stitch flow.

## Chrome Web Store Review

Chrome Web Store submission notes, permission justifications, reviewer test steps, and the privacy policy draft live in `docs/chrome-web-store-submission.md` and `docs/privacy-policy.md`. Keep those files synchronized with the uploaded build and the Developer Dashboard privacy fields.

## Known Constraints

- ChatGPT UI changes can break composer, send-button, or message detection.
- ChatGPT Projects and model picker controls are UI-driven and can change independently from this extension.
- Login screens, account gates, and modal dialogs require the explicit sign-in handoff.
- Multiple simultaneous requests are isolated by request id, but the hidden workspace can only run one automation at a time.
- Attachment upload through the ChatGPT web UI is best effort and depends on the page exposing a file input compatible with scripted `FileList` assignment.
- Screenshot capture uses required `<all_urls>` host access for deterministic visible-page screenshots on normal web tabs, but browsers may still block browser-internal pages, store pages, or other extension pages.
- Fully hidden automation depends on Chrome offscreen iframe capability or the Firefox sidebar host, the local session-scoped frame-policy override, ChatGPT account/session behavior in an embedded frame, and successful content-script execution inside the ChatGPT iframe. If any of those are blocked, the request fails with an actionable sidebar error.
