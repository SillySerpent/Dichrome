# Dichrome

Local-first Chrome/Chromium extension with two side-panel modes for working with the user's signed-in ChatGPT browser session.

Mode 2 is the default ChatGPT sidebar companion. It embeds ChatGPT in the side panel, prepares copyable prompts from selected webpage text, captures visible screenshots into the embedded ChatGPT prompt box when available, and can open a ChatGPT companion window when the embedded frame is unavailable.

Mode 1 is the original Dichrome automation UI. It is available from the root side-panel settings as `Mode 1 - Original Dichrome Beta` and must be treated as early beta because it drives ChatGPT's web UI through hidden internal automation for project routing, model selection, file/screenshot attachments, streaming responses, follow-ups, and project history.

Dichrome is intentionally UI-driven. It does not use the OpenAI API and does not require a hosted backend. The extension depends on the user's signed-in ChatGPT browser session and uses packaged extension code only.

## Current Workflow

1. Open a normal webpage and open Dichrome from the toolbar or with `Alt+Shift+D`.
2. Fresh installs open Mode 2 by default. The side panel loads the embedded ChatGPT sidebar and exposes compact screenshot, reload, fallback-window, prompt-copy, and screenshot fallback controls.
3. Highlight text on a normal webpage and use either the shared selection popover or right-click menu:
   - `Ask with Dichrome about "%s"`
   - `Summarize with Dichrome`
   - `Explain with Dichrome`
   - `Rewrite with Dichrome`
   - `Define with Dichrome`
4. In Mode 2, Dichrome prepares a copyable prompt from the selected text, stores it under Mode 2 state, opens the side panel for the source tab, and leaves the user in control of the embedded ChatGPT frame or fallback ChatGPT window.
5. In Mode 2, screenshots capture the visible source tab and are attached to the embedded ChatGPT composer when the frame accepts image uploads. Copy/download remains available as a local fallback. Mode 2 does not press ChatGPT's send button.
6. Use root side-panel `Settings` to switch modes. Switching into Mode 1 requires acknowledging the early beta warning. Switching away from Mode 1 is blocked while a Mode 1 request is active unless the user explicitly chooses to cancel that request.
7. In Mode 1, the same context-menu, selection-popover, screenshot, and selected-text shortcut entrypoints route into the original Dichrome hidden-automation pipeline.
8. Mode 1 resolves the hidden internal ChatGPT workspace, optionally routes to a configured project, optionally selects a configured model, inserts the prompt and attachments, sends it, and streams the newest assistant response back into the Mode 1 panel.

## Files

- `manifest.json` - Chrome MV3 source manifest, permissions, side-panel entry, side-panel shortcut command, all-sites screenshot host access, ChatGPT host permissions, offscreen permission, and the DNR host-access permission used for hidden iframe frame-policy overrides.
- `shared/contracts.js` - shared request states, message strings, hidden workspace constants, content script order, and response-rendering allowlists.
- `shared/modes.js` - active mode storage, default Mode 2 behavior, existing Mode 1 install migration, public mode labels, and mode-switch message constants.
- `shared/response-formatting.js` - response normalization, markdown-ish rendering, HTML sanitization, and deterministic local math rendering.
- `shared/response/*` - internal escaping and sanitizer helpers kept behind the public response-formatting facade.
- `shared/error-messages.js` - centralized user-facing error titles, details, and action labels.
- `background/service-worker.js` - small manifest-loaded entrypoint for the background runtime.
- `background/runtime/*` - listener composition, side-panel state, workspace readiness, request orchestration, automation event recording, runtime message routing, request control, and settings repositories.
- `background/runtime/context-menu.js` - shared context-menu and screenshot/selection routing into the currently active mode.
- `background/mode2/*` - Mode 2 prompt-copy, screenshot state, embedded-frame policy setup, and fallback ChatGPT companion-window control.
- `background/runtime/project-history-controller.js` - project-scoped conversation history list/load routing through the hidden internal workspace.
- `background/debug-dump.js` - internal diagnostic summarization kept out of the normal side-panel UI.
- `background/automation/settings.js` - stored ChatGPT project-routing, visibility, and model-selection settings.
- `background/automation/session.js` - hidden workspace session storage and cleanup of obsolete visible-tab session storage.
- `background/automation/offscreen-target.js` - hidden internal target capability probe, frame bridge, Chrome offscreen host routing, and failure reason tracking.
- `background/automation/offscreen-frame-policy.js` - session-scoped ChatGPT subframe header override for local hidden-internal probing.
- `background/automation/source-focus.js` - source-tab selection, source-focus restoration, and screenshot capture helpers.
- `background/requests/store.js` - request history, attachment payload storage, event appends, and panel update broadcasts.
- `background/state-machine.js` - request states and prompt profiles.
- `content/chatgpt/*` - ordered injected ChatGPT-side automation entrypoints.
- `content/chatgpt/runtime/*` - ChatGPT-side runtime layers for contracts, messaging, URL/frame decisions, errors, adapter heuristics, response extraction, and the automation runner.
- `content/chatgpt/runtime/history/project-history-data.js` and `project-history.js` - project-scoped history data normalization, listing, and selected conversation loading through ChatGPT's signed-in web session.
- `content/shared/selection-popover.js` - shared selected-text quick-action toolbar on normal webpages.
- `content/mode2/chatgpt-frame-theme.js` - Mode 2 embedded ChatGPT frame styling/link normalization, frame URL persistence, and screenshot attachment handoff.
- `sidepanel/sidepanel.html`, `shell.css`, and `shell.js` - root side-panel shell, mode iframe, and mode switcher.
- `sidepanel/mode2/*` - default Mode 2 ChatGPT sidebar companion UI.
- `sidepanel/mode1.html`, `sidepanel/sidepanel.css`, and `sidepanel/sidepanel.js` - original Dichrome Mode 1 beta UI.
- `sidepanel/runtime/*` - side panel client, DOM lookup, state helpers, attachment handling, message-card rendering, response view, response animation, settings dialog, status formatting, and app orchestration.
- `docs/setup-and-usage.md` - setup, permission, and day-to-day usage instructions.
- `docs/module-map.md` - maintainer map for module ownership and future extraction boundaries.
- `docs/hidden-internal-invariants.md` - hidden internal mode behaviors that must not regress.
- `docs/manual-smoke-tests.md` - manual validation scenarios for browser-dependent behavior.
- `assets/icon.svg` and `icons/*` - source and generated browser toolbar icons.
- `scripts/validate-extension.mjs` - dependency-free static validation.
- `scripts/manifest-targets.mjs` - Chrome package-target manifest normalization used by validation and packaging.
- `scripts/generate-icons.mjs` - dependency-free icon generator.

## Load Locally

Chrome/Chromium:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository directory.
5. Accept the extension permissions. Dichrome requests all-sites host access so visible screenshot capture works on normal web tabs without a temporary `activeTab` grant.
6. Open Dichrome from the toolbar or with `Alt+Shift+D`. Fresh installs open Mode 2 by default.
7. Sign in to ChatGPT in a normal browser tab before testing the embedded sidebar, fallback ChatGPT window, or Mode 1 hidden automation.

No separate non-Chromium package is built; this project targets Chrome/Chromium side panels only. Firefox support is no longer considered because Firefox provides a GPT sidebar by default, and removing Firefox-specific code keeps Dichrome's extension runtime simpler.

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

The Chrome ZIP is written to `.dist/chrome/dichrome-<version>-chrome.zip`.

Build one browser package at a time when needed:

```bash
npm run package:chrome
```

Regenerate icons after editing `assets/icon.svg` or `scripts/generate-icons.mjs`:

```bash
npm run icons
```

## Design Notes

The extension is split deliberately:

- The root side-panel shell owns active mode display, mode switching, and the Mode 1 beta acknowledgement.
- Shared background routing owns context menus, selected-text actions, source-tab selection, and visible screenshot capture.
- Mode 2 owns the embedded ChatGPT companion surface, copyable prompt state, screenshot-to-composer handoff with copy/download fallback state, and fallback ChatGPT companion window.
- Mode 1 owns request state, hidden workspace routing, project/model automation, attachments, response streaming, follow-ups, and project history.
- The ChatGPT content script owns deterministic DOM interaction for Mode 1 and narrowly scoped embedded-frame behavior for Mode 2.
- Internal diagnostics are kept out of the normal sidebar UI; obsolete fallback automation experiments are no longer part of the product build.

The ChatGPT adapter avoids whole-page scraping for response extraction. It looks for assistant message containers using semantic attributes first, then bounded conversation-area fallbacks. Once a candidate response is selected, the observer only tracks that message's content. Completion requires several signals: response stability, no visible stop-generation control, an enabled send button, and no detected error UI.

The content runtime is layered under `content/chatgpt/runtime/`: `adapter/` owns ChatGPT DOM heuristics, `response/` owns response extraction and observation, `history/` owns project-scoped conversation history loading, `network/` owns main-world response capture, `offscreen/` owns the hidden iframe bridge for Chrome offscreen hosts, `page/` owns visibility checks, `debug/` owns content-side dumps and event payloads, and `runner/` owns the request lifecycle. `runtime/app.js` composes those modules and registers extension message listeners.

Mode 1 stores plain text as the canonical response payload and renders final HTML through `shared/response-formatting.js`. The renderer preserves common generated formatting such as paragraphs, lists, task lists, tables, ChatGPT writing blocks, blockquotes, inline code, code blocks, strikethrough, and common local math expressions including accents, primes, fractions, roots, matrices, matrix products, and cases while removing scripts, forms, buttons, iframes, event attributes, and unsafe links. If a math expression cannot be parsed confidently, it is shown as escaped source in a styled fallback instead of malformed HTML.

## Mode 2 Sidebar

Mode 2 is the first-run default. It enables the local ChatGPT subframe policy, loads ChatGPT in an extension side-panel iframe, remembers the last valid ChatGPT frame URL under `dichrome.mode2.chatGptFrameUrl`, and keeps prompt/screenshot records under `dichrome.mode2.*` session state. Selected-text actions prepare a prompt for the user to copy or paste. Screenshot actions capture the visible source tab, ask the embedded ChatGPT frame to attach the image to the composer, and keep copy/download controls as a fallback if the frame or ChatGPT upload UI rejects the handoff. Mode 2 does not press ChatGPT's send button.

If ChatGPT does not work reliably inside the embedded frame, Mode 2 can open or refocus a separate ChatGPT companion popup window. The popup window id is stored locally under Mode 2 state.

## Mode 1 Hidden Automation

Mode 1 is the original Dichrome beta flow. It first installs a session-scoped `declarativeNetRequest` rule for ChatGPT subframe responses. Chrome then creates an offscreen document with separate ChatGPT iframes for chat automation and project-history refreshes. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT subframe responses so Dichrome can test hidden iframe automation. The rule is scoped to non-tab ChatGPT subframe requests when Chrome accepts `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that scoped rule is rejected, or if it installs but the ChatGPT bridge still never connects, the extension falls back to a ChatGPT-subframe-only rule. The rule is removed when hidden automation is closed or when the probe records hidden automation as unsupported.

The ChatGPT automation content script is registered for all ChatGPT frames at `document_start`; when the browser can inject it into an extension-hosted ChatGPT iframe, the frame opens a runtime port back to the background runtime and accepts role-scoped automation commands through that port. Chrome routes prompt sends, follow-ups, and cancellation to the chat frame, while project-history list/load commands hard-reload and use the history frame. The frame bridge reconnects if the background runtime restarts while the host document survives, and the background probe reloads the chat iframe once with a cache-busting probe URL if the host reports that ChatGPT loaded but the chat bridge still did not connect.

If ChatGPT blocks cookies, frame-script injection, account/session access, or background streaming after that recovery path, Mode 1 fails the request with a user-facing error instead of opening or controlling a visible ChatGPT automation tab. The Mode 1 panel offers an explicit `Open ChatGPT to sign in` action for authentication/setup only.

## Project Routing

Project routing is a Mode 1 beta feature. It is enabled by default and uses the extension name as the project name. Before a normal Mode 1 prompt is sent, the ChatGPT content script tries to:

1. Detect whether the current ChatGPT page is already scoped to the configured project.
2. Select the project from the ChatGPT sidebar if it exists.
3. Create the project through the visible ChatGPT UI if it is missing and `Create if missing` is enabled.

If project routing is enabled and the project cannot be selected or created, the request fails before the prompt is sent. That is intentional because sending outside the project would create the main-history clutter this feature is meant to avoid.

The project picker avoids sidebar overflow/menu controls and clicks the left side of the project navigation row. This is important because ChatGPT exposes a separate three-dot project menu beside each project.

The Mode 1 panel loads project history automatically for the configured project. In Chrome, each history load first hard-reloads the dedicated hidden history frame to the saved project URL when available, or ChatGPT home when the project id is not yet known. Loading history resolves and remembers the concrete ChatGPT project id from saved project URLs or the hidden workspace before falling back to name-based project routing with project creation disabled. It then lists conversations returned by project-scoped history endpoints, regular history responses that explicitly match that project id, or real project conversation links already exposed on the project page. It does not click guessed project-page rows and does not create a browser tab just to load history; if hidden history loading is unavailable, it fails clearly. Selecting a conversation fetches its backend conversation mapping, renders the newest messages first, and reveals earlier messages in batches as the side-panel chat scrolls upward. Sending while a loaded history conversation is active continues that conversation URL; pressing `New` clears the loaded conversation and starts a separate fresh chat on the next send.

## Conversation Mode

Normal Mode 1 context-menu and manual requests create a fresh ChatGPT conversation after project routing succeeds, inside the hidden workspace. Follow-up requests force `startNewChat: false`, reopen the saved parent conversation URL in the hidden workspace when needed, and fail clearly if the previous conversation cannot be reopened.

## Model Selection

Mode 1 model selection is optional until a model label is entered. Enter or choose the visible ChatGPT model/mode label from your account, such as `Auto`, `Instant`, `Thinking`, `Extended`, `Pro`, or another label shown in your picker. Choosing a label automatically enables model selection, and the Mode 1 panel saves the current model form before each send, follow-up, screenshot request, or retry so the next request uses the visible selector value.

When a model label is requested, model-selection failure stops the request before the prompt is sent. This avoids accidentally sending with whatever model ChatGPT last had selected. With `Require exact match` off, the selector may use known aliases such as `Fast answers` for `Instant`; with it on, it only accepts the requested label text as a standalone match.

## Screenshot Status

Both modes use the same visible screenshot capture service. It uses the browser `tabs.captureVisibleTab` API, so the manifest requests required `<all_urls>` host access instead of relying on a transient `activeTab` grant or a side-panel runtime permission prompt. Before capture, the background worker activates the resolved source tab so the browser captures the intended visible viewport.

In Mode 2, screenshots are attached to the embedded ChatGPT composer when the frame is loaded and ChatGPT exposes a compatible image upload input; copy/download controls remain as a local fallback. In Mode 1, screenshots are attached to the hidden ChatGPT request. The capture is the visible viewport, not a stitched full-page screenshot. Browsers can still block restricted surfaces such as `chrome://` pages, the Chrome Web Store, and other extension pages. Full-page screenshot support would need a separate scroll-and-stitch flow.

## Chrome Web Store Review

Chrome Web Store submission notes, permission justifications, reviewer test steps, and the privacy policy draft live in `docs/chrome-web-store-submission.md` and `docs/privacy-policy.md`. Keep those files synchronized with the uploaded build and the Developer Dashboard privacy fields.

## Known Constraints

- Mode 2 depends on ChatGPT being usable inside an extension-hosted iframe or fallback popup window. The embedded frame is not guaranteed by ChatGPT.
- Mode 1 is an early beta hidden-automation mode. ChatGPT UI changes can break composer, send-button, upload, project, model, history, or message detection.
- ChatGPT Projects and model picker controls are UI-driven and can change independently from this extension.
- Login screens, account gates, and modal dialogs require the explicit sign-in handoff.
- Multiple simultaneous Mode 1 assistant requests are isolated by request id, but the hidden chat frame can only run one prompt automation at a time.
- Mode 1 attachment upload through the ChatGPT web UI is best effort and depends on the page exposing a file input compatible with scripted `FileList` assignment.
- Screenshot capture uses required `<all_urls>` host access for deterministic visible-page screenshots on normal web tabs, but browsers may still block browser-internal pages, store pages, or other extension pages.
- Fully hidden Mode 1 automation depends on Chrome offscreen iframe capability, the local session-scoped frame-policy override, ChatGPT account/session behavior in embedded frames, and successful content-script execution inside the ChatGPT iframe. If any of those are blocked, the request fails with an actionable sidebar error.
