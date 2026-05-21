# Dichrome

Experimental local Chrome/Chromium extension for routing selected webpage text into an already-open assistant workspace, then reflecting the assistant response in an extension side panel.

This is intentionally UI-driven. It does not use the OpenAI API, does not require a hosted backend, and is not structured as a public product. The prototype exists to test whether a personal, non-API browser workflow can be made reliable enough for local use.

## Current Workflow

1. Highlight text on a normal webpage.
2. Use the selection context menu:
   - `Ask assistant about this`
   - `Define this word or phrase`
   - `Summarize this selection`
3. The background service worker opens the extension side panel for the source tab.
4. The worker resolves the canonical ChatGPT automation target and applies debugger focus emulation for background modes.
5. If project routing is enabled, the ChatGPT content script selects the configured project or creates it before sending.
6. Normal requests start from a fresh chat by default; follow-ups continue the active ChatGPT tab conversation.
7. If model selection is enabled, the content script tries to select the configured model label.
8. The content script inserts the generated prompt into the visible composer and clicks the send button.
9. The content script tracks the newest assistant message and streams formatted updates back to the side panel.
10. The original webpage stays focused unless you explicitly open the ChatGPT tab from the panel.

## Files

- `manifest.json` - MV3 manifest, permissions, side panel entry, ChatGPT host permissions, debugger permission, offscreen permission, and the DNR host-access permission used for hidden iframe frame-policy overrides.
- `shared/contracts.js` - shared request states, message strings, visibility modes, automation target constants, content script order, and response-rendering allowlists.
- `shared/response-formatting.js` - response normalization, markdown-ish rendering, HTML sanitization, and deterministic local math rendering.
- `background/service-worker.js` - small manifest-loaded entrypoint for the background runtime.
- `background/runtime/*` - listener orchestration, runtime message routing, request control, and settings repositories.
- `background/runtime/project-history-controller.js` - project-scoped conversation history list/load/open routing through the canonical automation target.
- `background/debug/debug-dump-collector.js` - debug dump assembly across background, content, offscreen, and tab state.
- `background/automation/settings.js` - stored ChatGPT project-routing, visibility, and model-selection settings.
- `background/automation/session.js` - canonical automation target/session storage and migration from the legacy remembered tab.
- `background/automation/tab-target.js` - single inactive tab reuse, visible sidecar routing, and follow-up conversation navigation.
- `background/automation/offscreen-target.js` - hidden offscreen target capability probe, frame bridge, and fallback reason tracking.
- `background/automation/offscreen-frame-policy.js` - session-scoped ChatGPT subframe header override for local hidden-internal probing.
- `background/automation/source-focus.js` - source-tab selection, source-focus restoration, and screenshot capture helpers.
- `background/requests/store.js` - request history, attachment payload storage, event appends, and panel update broadcasts.
- `background/focus-emulation.js` - Chrome debugger focus emulation for background streaming.
- `background/state-machine.js` - request states and prompt profiles.
- `background/adapter-repair.js` - optional local-model repair prompt, response parsing, and mapping validation.
- `content/chatgpt/*` - ordered injected ChatGPT-side automation entrypoints.
- `content/chatgpt/runtime/*` - ChatGPT-side runtime layers for contracts, messaging, URL/frame decisions, errors, adapter heuristics, response extraction, and the automation runner.
- `content/chatgpt/runtime/history/project-history.js` - project-scoped history listing and selected conversation loading through ChatGPT's signed-in web session.
- `sidepanel/*` - side panel HTML/CSS and entrypoint.
- `sidepanel/runtime/*` - side panel client, DOM lookup, state helpers, response view, response animation, and app orchestration.
- `docs/module-map.md` - maintainer map for module ownership and future extraction boundaries.
- `docs/hidden-internal-invariants.md` - hidden internal mode behaviors that must not regress.
- `docs/manual-smoke-tests.md` - manual validation scenarios for browser-dependent behavior.
- `assets/icon.svg` and `icons/*` - source and generated Chrome toolbar icons.
- `scripts/validate-extension.mjs` - dependency-free static validation.
- `scripts/generate-icons.mjs` - dependency-free icon generator.

## Load Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository directory.
5. Sign in to ChatGPT in a normal browser tab before testing selection relay.

## Validation

Run:

```bash
npm run check
npm test
```

No install step is required; both scripts only use Node built-ins.

Regenerate icons after editing `assets/icon.svg` or `scripts/generate-icons.mjs`:

```bash
npm run icons
```

## Design Notes

The automation is split deliberately:

- The background worker owns request state and tab routing.
- The ChatGPT content script owns deterministic DOM interaction.
- The side panel owns display and operator controls.
- Optional local repair only suggests structured selector or semantic hints. It does not rewrite extension code.

The ChatGPT adapter avoids whole-page scraping for response extraction. It looks for assistant message containers using semantic attributes first, then bounded conversation-area fallbacks. Once a candidate response is selected, the observer only tracks that message's content. Completion requires several signals: response stability, no visible stop-generation control, an enabled send button, and no detected error UI.

The content runtime is layered under `content/chatgpt/runtime/`: `adapter/` owns ChatGPT DOM heuristics, `response/` owns response extraction and observation, `history/` owns project-scoped conversation history loading, `network/` owns main-world response capture, `offscreen/` owns the hidden iframe bridge, `page/` owns visibility checks, `debug/` owns content-side dumps and event payloads, and `runner/` owns the request lifecycle. `runtime/app.js` composes those modules and registers Chrome message listeners.

The side panel stores plain text as the canonical response payload and renders final HTML through `shared/response-formatting.js`. The renderer preserves common generated formatting such as paragraphs, lists, task lists, tables, ChatGPT writing blocks, blockquotes, inline code, code blocks, strikethrough, and common local math expressions while removing scripts, forms, buttons, iframes, event attributes, and unsafe links. If a math expression cannot be parsed confidently, it is shown as escaped source in a styled fallback instead of malformed HTML.

## Automation Target Mode

`Hidden internal` is the default mode. It first installs a session-scoped `declarativeNetRequest` rule for ChatGPT subframe responses, then creates a Chrome offscreen document that hosts a ChatGPT iframe. The rule removes `X-Frame-Options` and `Content-Security-Policy` from ChatGPT subframe responses so the local/unpacked prototype can test true hidden iframe automation. The rule is scoped to non-tab ChatGPT subframe requests when Chrome accepts `tabIds: [chrome.tabs.TAB_ID_NONE]`; if that scoped rule is rejected, or if it installs but the offscreen ChatGPT bridge still never connects, the extension falls back to a ChatGPT-subframe-only rule. The rule is removed when hidden automation is closed or when the probe records hidden automation as unsupported.

The ChatGPT automation content script is registered for all ChatGPT frames at `document_start`; when Chrome can inject it into that offscreen iframe, the frame opens a runtime port back to the service worker and accepts automation commands through that port. The frame bridge reconnects if the MV3 service worker restarts while the offscreen document survives, and the background probe reloads the iframe once with a cache-busting probe URL if the host reports that ChatGPT loaded but the bridge still did not connect. If ChatGPT blocks cookies, frame-script injection, account/session access, or background streaming after that recovery path, the extension records the reason and falls back to one inactive reusable ChatGPT tab.

Chrome cannot make a normal `chrome.tabs.create({ active: false })` tab completely internal. If offscreen automation is unavailable, the best UI-driven fallback is exactly one real, non-selected ChatGPT tab in the tab strip. The extension reuses that tab across requests, marks it non-discardable during automation, and recreates one replacement only after the stored tab is confirmed deleted or no longer points to ChatGPT.

Background modes require the Chrome `debugger` permission so the extension can use DevTools Protocol focus emulation. Without it, Chrome can keep the ChatGPT page at `visibilityState: hidden`, and ChatGPT may not render streaming response DOM until the tab is selected.

`One background tab` skips the offscreen probe and always uses the reusable inactive tab. `Visible side window` keeps the separate popup/window shape for debugging or visual inspection, but still uses debugger focus emulation for streaming. `Focus ChatGPT` skips debugger focus emulation and keeps the ChatGPT automation window focused until the request completes, then restores the source tab.

The side panel includes target status in the routing settings and `Dump Debug` for debugging stale responses or unexpected focus movement. Debug dumps include current settings, the canonical automation session, active focus-emulation sessions, offscreen host/bridge state, the installed frame-policy override status, request state, tab/window summaries, and a ChatGPT-page DOM snapshot when the content script can be reached.

## Project Routing

Project routing is enabled by default and uses the extension name as the project name. Before a normal prompt is sent, the ChatGPT content script tries to:

1. Detect whether the current ChatGPT page is already scoped to the configured project.
2. Select the project from the ChatGPT sidebar if it exists.
3. Create the project through the visible ChatGPT UI if it is missing and `Create if missing` is enabled.

If project routing is enabled and the project cannot be selected or created, the request fails before the prompt is sent. That is intentional because sending outside the project would create the main-history clutter this feature is meant to avoid.

The project picker avoids sidebar overflow/menu controls and clicks the left side of the project navigation row. This is important because ChatGPT exposes a separate three-dot project menu beside each project.

The side panel loads project history automatically for the configured project. Loading history resolves and remembers the concrete ChatGPT project id from open project tabs, saved project URLs, or the current automation target before falling back to name-based project routing with project creation disabled. It then lists conversations returned by project-scoped history endpoints, regular history responses that explicitly match that project id, or real project conversation links already exposed on the project page. It does not click guessed project-page rows and does not create a new browser tab just to load history; if hidden history loading is unavailable, it uses an existing automation target or fails clearly. Selecting a conversation fetches its backend conversation mapping, renders the newest messages first, and reveals earlier messages in batches as the side-panel chat scrolls upward. Sending while a loaded history conversation is active continues that conversation URL; pressing `New` clears the loaded conversation and starts a separate fresh chat on the next send.

## Conversation Mode

`Start a new chat by default` is enabled by default. Normal context-menu and manual requests create a fresh ChatGPT conversation after project routing succeeds, inside the canonical automation target. The side panel also includes a follow-up box; follow-up requests force `startNewChat: false`, reopen the saved parent conversation URL in the same automation target when needed, and fail clearly if the previous conversation cannot be reopened.

## Model Selection

Model selection is optional until a model label is entered. Enter or choose the visible ChatGPT model/mode label from your account, such as `Auto`, `Instant`, `Thinking`, `Extended`, `Pro`, or another label shown in your picker. Choosing a label automatically enables model selection, and the side panel saves the current routing/model form before each send, follow-up, screenshot request, or retry so the next request uses the visible selector value.

When a model label is requested, model-selection failure stops the request before the prompt is sent. This avoids accidentally sending with whatever model ChatGPT last had selected. With `Require exact match` off, the selector may use known aliases such as `Fast answers` for `Instant`; with it on, it only accepts the requested label text as a standalone match.

## Local DOM Repair

Local repair is disabled by default. When enabled, failed DOM adapter runs can send a bounded candidate snapshot to an Ollama-compatible local endpoint such as:

```text
http://localhost:11434/api/generate
```

The model must return strict JSON with `hints`. The extension validates target names, strategies, selector shape, string lengths, and confidence values before showing them or allowing a retry with hints. The model is not trusted to change extension source code.

## Screenshot Status

The side panel includes an experimental visible-screenshot request. It uses `chrome.tabs.captureVisibleTab`, so Chrome requires host access to the visible page or a valid `activeTab` grant. In side-panel workflows, `activeTab` grants can be unreliable, so this local/unpacked prototype requests optional `<all_urls>` host access the first time you use visible screenshot capture. It captures the visible viewport, not a stitched full-page screenshot. Full-page screenshot support would need a separate scroll-and-stitch flow.

## Known Constraints

- ChatGPT UI changes can break composer, send-button, or message detection.
- ChatGPT Projects and model picker controls are UI-driven and can change independently from this extension.
- Login screens, account gates, and modal dialogs require manual handling in the ChatGPT tab.
- Multiple simultaneous requests are isolated by request id, but a single ChatGPT tab can only run one automation at a time.
- Attachment upload through the ChatGPT web UI is best effort and depends on the page exposing a file input compatible with scripted `FileList` assignment.
- Screenshot capture requests optional `<all_urls>` host access for deterministic visible-page screenshots, and local repair can reach the configured Ollama-compatible endpoint when enabled. Background automation modes require Chrome's high-privilege `debugger` permission for the ChatGPT tab.
- Fully hidden automation depends on Chrome offscreen iframe capability, the local session-scoped frame-policy override, ChatGPT account/session behavior in an embedded frame, and successful content-script execution inside the ChatGPT iframe. If any of those are blocked, the supported fallback is one inactive reusable browser tab.
