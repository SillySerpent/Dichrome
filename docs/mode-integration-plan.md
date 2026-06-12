# Mode Integration Plan

## Current State

Dichrome now ships as one Chrome/Chromium MV3 extension with two side-panel modes behind a shared shell.

- **Mode 2 - ChatGPT Sidebar** is the first-run default. It embeds ChatGPT in the side panel, prepares copyable prompts from selected webpage text, captures visible screenshots into the embedded ChatGPT composer with copy/download fallback controls, and can open a user-triggered ChatGPT companion popup window.
- **Mode 1 - Original Dichrome Beta** is the original Dichrome hidden-automation UI. It remains available from root side-panel settings after the user acknowledges the early beta warning.
- **Shared shell** is the single extension identity, manifest, service worker entrypoint, mode setting, shared screenshot capture, shared source-tab tracking, shared context-menu entrypoints, shared selection popover, and mode switcher.

The standalone prototype source folder has been removed from the shipping workspace. Mode 2 runtime code now lives under `background/mode2/`, `content/mode2/`, and `sidepanel/mode2/`.

## Product Contract

Fresh installs open Mode 2. Existing local installs that already contain original Dichrome settings/session state migrate to Mode 1 so the user's previous workflow is not hidden unexpectedly.

Mode switching lives in the root side-panel settings UI and is reachable through a compact floating control over both mode apps. Switching modes changes the iframe-loaded side-panel surface without requiring a browser extension reload.

Switching into Mode 1 shows this warning and requires acknowledgement:

```text
Original Dichrome (Mode 1) is an early beta.

It uses hidden ChatGPT automation for project routing, model selection, attachments, streaming responses, and project history. ChatGPT UI changes can break this mode. You can switch back to the Mode 2 sidebar at any time from settings.
```

Switching away from Mode 1 while a Mode 1 request is active is blocked unless the user explicitly checks `Cancel the active Mode 1 request before switching.` Cancellation failures must block the switch rather than being swallowed.

## Architecture

Chrome only supports one extension background service worker and one side-panel default path. Dichrome therefore uses one manifest and one service worker, then routes mode-specific behavior through explicit controllers.

```text
manifest.json
-> background/service-worker.js
-> background/runtime/app.js
   -> shared mode/status routing
   -> shared context-menu and screenshot routing
   -> background/mode2/companion-controller.js
   -> original Mode 1 request/project/history controllers

sidepanel/sidepanel.html
-> sidepanel/shell.js
   -> sidepanel/mode2/sidepanel.html by default
   -> sidepanel/mode1.html after explicit switch
```

Mode ownership is separated:

- Shared shell owns active mode, public mode labels, mode switching, switch guards, toolbar opening, and iframe loading.
- Shared background routing owns context-menu creation, selected-text entrypoints, keyboard screenshot/selection shortcuts, source-tab selection, and visible screenshot capture.
- Mode 2 owns embedded-frame UI, frame URL state, fallback popup-window state, selected-text prompt-copy records, screenshot records, screenshot attachment handoff into the embedded ChatGPT composer, copy/download fallback controls, and simple ChatGPT companion controls.
- Mode 1 owns hidden workspace automation, project routing, model selection, project history, request records, response extraction, file/screenshot attachment upload, follow-up routing, response rendering, and sign-in handoff.

Mode 1 and Mode 2 must not import each other's UI or storage internals. Shared services should be extracted only when both modes genuinely need the same browser-source behavior.

## Storage

Shared active mode:

```text
dichrome.activeMode = "mode2" | "mode1"
```

Mode 2 keys:

```text
dichrome.mode2.chatGptFrameUrl
dichrome.mode2.chatGptWindowId
dichrome.mode2.latestNotice
dichrome.mode2.latestPrompt
dichrome.mode2.latestScreenshot
```

Mode 1 keeps the original automation settings/session/request/history/attachment storage contracts. Existing keys are intentionally not renamed in the same integration pass because the original beta path already has migration and test coverage around those records.

Migration rules:

- Missing `dichrome.activeMode` defaults to Mode 2.
- Missing `dichrome.activeMode` plus legacy original Dichrome state migrates to Mode 1.
- Unsupported stored mode values normalize back to Mode 2 behavior through the public mode helpers.

## Shared Source Actions

These entrypoints are unified:

- Toolbar and `Alt+Shift+D` side-panel opening.
- Source tab tracking and source-focus restoration before screenshot capture.
- Visible-tab screenshot capture through `tabs.captureVisibleTab`.
- Selection context-menu actions.
- Selection popover actions on normal webpages.
- Keyboard screenshot, summarize-selection, and explain-selection shortcuts.

Mode routing behavior:

- In Mode 2, selected-text actions create a copyable prompt record, open Mode 2, and expose copy/open controls.
- In Mode 1, selected-text actions start an original Dichrome request through the existing request orchestrator.
- In Mode 2, screenshot actions capture and store an image, then the side panel asks the extension-hosted ChatGPT iframe to attach the recent screenshot into the composer. Copy/download remains available as fallback when the frame or ChatGPT upload UI cannot accept it.
- In Mode 1, screenshot actions capture and attach the image to a hidden ChatGPT request.

Unified user-facing menu actions:

- `Open ChatGPT companion window`
- `Capture visible screenshot`
- `Ask with Dichrome about "%s"`
- `Summarize with Dichrome`
- `Explain with Dichrome`
- `Rewrite with Dichrome`
- `Define with Dichrome`

The selected mode controls the outcome, not the menu title.

## Manifest

The root `manifest.json` is the only manifest. Required mode integration points:

- `side_panel.default_path` stays `sidepanel/sidepanel.html`, now the root shell.
- The shared selection popover is registered on `<all_urls>` and exits early on non-HTTP(S) and ChatGPT hosts.
- Mode 1 ChatGPT automation content scripts keep the `shared/contracts.js` order, `document_start`, and `all_frames: true`.
- Mode 2's ChatGPT frame theme script is registered separately for ChatGPT hosts with `document_start` and `all_frames: true`, but it only runs in direct extension-hosted ChatGPT iframes.
- `clipboardWrite` supports Mode 2 prompt/image copy controls.
- `windows` supports the Mode 2 fallback ChatGPT companion popup.
- `frame-src` allows ChatGPT/OpenAI frame hosts for the embedded Mode 2 frame.
- Non-Chromium packages are intentionally out of scope.

## Frame Policy

Both modes can need a local ChatGPT subframe header override:

- Mode 1 uses hidden Chrome offscreen ChatGPT iframes for automation.
- Mode 2 uses a visible embedded ChatGPT iframe in the side panel.

The shared frame-policy module keeps the existing narrow preference:

- Try non-tab ChatGPT subframes first when Chrome accepts that scope.
- Fall back only to ChatGPT `sub_frame` requests.
- Never broaden the rule to all resource types or non-ChatGPT domains.

Mode 2 must continue to present a clear fallback when the embedded frame is unavailable. The project should not claim embedded ChatGPT is guaranteed.

## Testing Plan

Static and unit coverage that must stay in the root runner:

- `scripts/test-modes.mjs` covers default Mode 2, legacy Mode 1 migration, explicit switching, and invalid mode rejection.
- `scripts/test-mode-shell.mjs` covers the shell iframe, Mode 1 beta warning, active-request switch guard, Mode 2 files, Mode 2 content script registration, `clipboardWrite`, and `windows`.
- Manifest validation covers the shared shell path, Mode 2 required files, `clipboardWrite`, `windows`, ChatGPT frame CSP, and command names.
- Existing Mode 1 tests continue to cover hidden automation, project history, request records, response extraction, attachments, and response formatting.
- Source-focus and screenshot tests continue to guard activation before `tabs.captureVisibleTab`.

Manual smoke tests are tracked in `docs/manual-smoke-tests.md` and must include:

- Fresh install opens Mode 2 with `Alt+Shift+D`.
- Mode 2 embedded ChatGPT iframe loads or shows fallback controls clearly.
- Mode 2 selected-text context menu and selection popover create prompt records.
- Mode 2 screenshot captures, copies, and downloads.
- Switching to Mode 1 shows and enforces the early beta warning.
- Mode 1 selected-text context menu starts an original Dichrome request.
- Mode 1 screenshot attaches to a hidden ChatGPT request.
- Switching from Mode 1 back to Mode 2 is immediate when no Mode 1 request is active.
- Switching from Mode 1 back to Mode 2 is blocked or explicitly cancels when a request is active.
- Chrome package validates.

Validation gates:

```bash
npm run check
npm test
git diff --check
npm run package
```

## Cleanup And Maintenance Plan

Keep these follow-up rules in place:

- Do not reintroduce alternate-browser manifests, sidebar-host automation, or non-Chrome extension-origin bridge support.
- Do not restore a standalone duplicate Mode 2 package inside the shipping workspace.
- Do not add direct Mode 1 imports to Mode 2 UI code or direct Mode 2 imports to Mode 1 request/rendering code.
- Keep shared behavior limited to source-tab lookup, screenshot capture, context-menu/popover entrypoints, mode state, and browser permission/error handling.
- Keep Chrome Web Store notes and privacy policy synchronized when permissions, screenshot behavior, embedded ChatGPT behavior, or storage keys change.

## Definition Of Done

This integration is considered complete when:

- Fresh installs open Mode 2 by default.
- Existing original Dichrome local state migrates to Mode 1.
- Users can switch to Mode 1 from settings after seeing and acknowledging the early beta warning.
- Users can switch back to Mode 2 from Mode 1 settings.
- Active Mode 1 requests cannot be orphaned by a mode switch.
- Mode 1 and Mode 2 state are isolated in storage.
- Shared screenshot, context-menu, selection-popover, and keyboard shortcut entrypoints route through the active mode.
- Mode 1 hidden automation tests still pass.
- Mode 2 frame/shell tests pass from the root test runner.
- Docs and store-review notes describe the new default mode and Mode 1 beta status.
- Non-Chromium support code and docs remain removed.
