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
4. The worker finds an existing ChatGPT tab or opens `https://chatgpt.com/` in the background.
5. A ChatGPT content script inserts the generated prompt into the visible composer and clicks the send button.
6. The content script tracks the newest assistant message and streams updates back to the side panel.
7. The original webpage stays focused unless you explicitly open the ChatGPT tab from the panel.

## Files

- `manifest.json` - MV3 manifest, permissions, side panel entry, and ChatGPT host permissions.
- `background/service-worker.js` - context menus, request state, tab discovery, injection, retries, screenshot capture, local repair routing.
- `background/state-machine.js` - request states and prompt profiles.
- `background/adapter-repair.js` - optional local-model repair prompt, response parsing, and mapping validation.
- `content/chatgpt-automation.js` - ChatGPT-side DOM adapter and automation state transitions.
- `sidepanel/*` - side panel UI for request state, streaming response, logs, retries, and repair settings.
- `scripts/validate-extension.mjs` - dependency-free static validation.

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
```

No install step is required; the script only uses Node built-ins.

## Design Notes

The automation is split deliberately:

- The background worker owns request state and tab routing.
- The ChatGPT content script owns deterministic DOM interaction.
- The side panel owns display and operator controls.
- Optional local repair only suggests structured selector or semantic hints. It does not rewrite extension code.

The ChatGPT adapter avoids whole-page scraping for response extraction. It looks for assistant message containers using semantic attributes first, then bounded conversation-area fallbacks. Once a candidate response is selected, the observer only tracks that message's text. Completion requires several signals: response text stability, no visible stop-generation control, an enabled send button, and no detected error UI.

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
- Login screens, account gates, and modal dialogs require manual handling in the ChatGPT tab.
- Multiple simultaneous requests are isolated by request id, but a single ChatGPT tab can only run one automation at a time.
- Attachment upload through the ChatGPT web UI is best effort and depends on the page exposing a file input compatible with scripted `FileList` assignment.
- This prototype intentionally keeps host permissions limited to ChatGPT plus optional local Ollama.
