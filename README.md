# ChatGPT Page Relay Prototype

Experimental local Chrome/Chromium extension for routing selected webpage text into an already-open ChatGPT tab, then reflecting the assistant response in an extension side panel.

This is intentionally UI-driven. It does not use the OpenAI API, does not require a hosted backend, and is not structured as a public product. The prototype exists to test whether a personal, non-API browser workflow can be made reliable enough for local use.

## Current Workflow

1. Highlight text on a normal webpage.
2. Use the selection context menu:
   - `Ask assistant about this`
   - `Define this word or phrase`
   - `Summarize this selection`
3. The background service worker opens the extension side panel for the source tab.
4. The worker finds or opens an inactive ChatGPT automation tab and applies debugger focus emulation in seamless mode.
5. If project routing is enabled, the ChatGPT content script selects the configured project or creates it before sending.
6. Normal requests start from a fresh chat by default; follow-ups continue the active ChatGPT tab conversation.
7. If model selection is enabled, the content script tries to select the configured model label.
8. The content script inserts the generated prompt into the visible composer and clicks the send button.
9. The content script tracks the newest assistant message and streams formatted updates back to the side panel.
10. The original webpage stays focused unless you explicitly open the ChatGPT tab from the panel.

## Files

- `manifest.json` - MV3 manifest, permissions, side panel entry, ChatGPT host permissions, and debugger permission.
- `background/service-worker.js` - context menus, request state, tab discovery, injection, retries, screenshot capture, local repair routing.
- `background/automation-settings.js` - stored ChatGPT project-routing, visibility, and model-selection settings.
- `background/focus-emulation.js` - Chrome debugger focus emulation for seamless background streaming.
- `background/state-machine.js` - request states and prompt profiles.
- `background/adapter-repair.js` - optional local-model repair prompt, response parsing, and mapping validation.
- `content/chatgpt-automation.js` - ChatGPT-side DOM adapter and automation state transitions.
- `sidepanel/*` - side panel UI for request state, streaming response, logs, retries, and repair settings.
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

The side panel stores plain text and sanitized HTML fragments for responses. The HTML path preserves basic generated formatting such as paragraphs, lists, tables, blockquotes, inline code, and code blocks while removing scripts, forms, buttons, iframes, event attributes, and unsafe links.

## Visibility Mode

`Seamless background` is the default automation mode. It keeps the source page focused and drives ChatGPT in an inactive browser tab. This mode requires the Chrome `debugger` permission so the extension can use DevTools Protocol focus emulation; without that, Chrome can keep the ChatGPT page at `visibilityState: hidden` and ChatGPT may not render streaming response DOM until the tab is selected.

The first run may create one non-selected ChatGPT tab if no reusable ChatGPT tab exists. That tab is still required because the prototype automates the real ChatGPT web UI rather than using the OpenAI API.

The worker remembers the last ChatGPT automation tab in local extension storage and recovers tab ids from recent request history, so new unrelated requests reuse the same ChatGPT tab when possible. `Start a new chat by default` creates a new conversation inside that reused tab; it does not intentionally create a new browser tab for each request.

`Visible side window` keeps the separate popup/window shape for debugging or visual inspection, but still uses debugger focus emulation for streaming. `Focus ChatGPT` skips debugger focus emulation and keeps the ChatGPT automation window focused until the request completes, then restores the source tab. That mode is more intrusive, but remains available when debugger focus emulation cannot be used.

The side panel includes `Dump Debug` for debugging stale responses or unexpected focus movement. It writes a structured dump to the side panel console and the extension service-worker console, including current settings, active focus-emulation sessions, request state, tab/window summaries, and a ChatGPT-page DOM snapshot when the content script can be reached.

## Project Routing

Project routing is enabled by default and uses the extension name as the project name. Before a normal prompt is sent, the ChatGPT content script tries to:

1. Detect whether the current ChatGPT page is already scoped to the configured project.
2. Select the project from the ChatGPT sidebar if it exists.
3. Create the project through the visible ChatGPT UI if it is missing and `Create if missing` is enabled.

If project routing is enabled and the project cannot be selected or created, the request fails before the prompt is sent. That is intentional because sending outside the project would create the main-history clutter this feature is meant to avoid.

The project picker avoids sidebar overflow/menu controls and clicks the left side of the project navigation row. This is important because ChatGPT exposes a separate three-dot project menu beside each project.

## Conversation Mode

`Start a new chat by default` is enabled by default. Normal context-menu and manual requests create a fresh ChatGPT conversation after project routing succeeds. The side panel also includes a follow-up box; follow-up requests reuse the associated ChatGPT tab conversation instead of creating a new chat.

## Model Selection

Model selection is optional and disabled by default. Enter the visible ChatGPT model label from your account, such as `Auto`, `Thinking`, `Pro`, or another label shown in your model picker. Available labels vary by plan and current ChatGPT rollout.

When `Require exact match` is off, model selection failures are logged and the request continues with the current ChatGPT model. When it is on, a model-selection failure stops the request before the prompt is sent.

## Local DOM Repair

Local repair is disabled by default. When enabled, failed DOM adapter runs can send a bounded candidate snapshot to an Ollama-compatible local endpoint such as:

```text
http://localhost:11434/api/generate
```

The model must return strict JSON with `hints`. The extension validates target names, strategies, selector shape, string lengths, and confidence values before showing them or allowing a retry with hints. The model is not trusted to change extension source code.

## Screenshot Status

The side panel includes an experimental visible-screenshot request. It uses `chrome.tabs.captureVisibleTab`, so Chrome may only allow it after a recent extension gesture. It captures the visible viewport, not a stitched full-page screenshot. Full-page screenshot support would need a separate scroll-and-stitch flow and additional per-page host access decisions.

## Known Constraints

- ChatGPT UI changes can break composer, send-button, or message detection.
- ChatGPT Projects and model picker controls are UI-driven and can change independently from this extension.
- Login screens, account gates, and modal dialogs require manual handling in the ChatGPT tab.
- Multiple simultaneous requests are isolated by request id, but a single ChatGPT tab can only run one automation at a time.
- Attachment upload through the ChatGPT web UI is best effort and depends on the page exposing a file input compatible with scripted `FileList` assignment.
- Host permissions remain limited to ChatGPT plus optional local Ollama, but seamless mode requires Chrome's high-privilege `debugger` permission for the ChatGPT tab.
