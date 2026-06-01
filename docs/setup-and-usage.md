# Setup and Usage

This guide is for loading Dichrome locally and using the side-panel workflow against an already signed-in ChatGPT account.

## Requirements

- Chrome or another Chromium browser that supports Manifest V3 side panels. Chrome 116 or newer is the baseline.
- Firefox if you are testing the Firefox package built from this repository.
- A ChatGPT account signed in at `https://chatgpt.com/`.
- This repository directory available on the same machine where the browser is running.

Dichrome is local and UI-driven. It does not use the OpenAI API and does not require a hosted backend.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the repository root directory, not a subfolder.
5. Accept the permission prompt.
6. Pin or open the `Dichrome` extension from the browser toolbar, or use `Alt+Shift+D`.
7. Open `https://chatgpt.com/` in a normal tab and confirm the account is signed in.

The Chrome manifest requests access to all sites so the screenshot button can capture visible normal web tabs without relying on a temporary `activeTab` grant or repeated per-site prompts. It also requests ChatGPT automation permissions, side-panel access, storage, offscreen documents, and declarative network request access for the hidden internal ChatGPT iframe probe.

If the manifest changed while the extension was already loaded, use the reload button for Dichrome on `chrome://extensions` before testing again.

The default side-panel shortcut is `Alt+Shift+D`. It can be changed from `chrome://extensions/shortcuts`. On Chrome versions with side-panel close support, the same shortcut closes the panel when Dichrome is already open.

## Load In Firefox

1. Run `npm run package:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select `.dist/firefox/package/manifest.json`.
5. Open `https://chatgpt.com/` in a normal tab and confirm the account is signed in.

Firefox uses the extension sidebar as the hidden ChatGPT frame host because Firefox does not provide Chrome's offscreen document API.

## First Run

1. Open a normal webpage that you want to use as source context.
2. Open the Dichrome side panel from the toolbar or with `Alt+Shift+D`.
3. Confirm the settings show the intended ChatGPT project name or project URL.
4. Leave `Create if missing` enabled if Dichrome should create the project automatically.
5. Type a short message in the composer and press the send button.
6. If ChatGPT asks for sign-in, human verification, account selection, or another modal, resolve it in ChatGPT and retry.

Normal automation uses the hidden internal ChatGPT workspace. A visible ChatGPT page is opened only when you choose the explicit sign-in/setup handoff.

## Selected Text Workflow

1. Highlight text on a normal webpage.
2. Right-click the selection.
3. Choose one of the Dichrome context-menu actions:
   - `Ask assistant about this`
   - `Define this word or phrase`
   - `Summarize this selection`
4. The side panel opens for the source tab.
5. Dichrome routes the prompt into the configured ChatGPT project and streams the newest assistant response back into the panel.

The source webpage should stay focused during normal hidden-internal automation.

## Manual Messages

1. Open the side panel on a normal webpage.
2. Type into the message composer.
3. Optionally attach selected page text, files, or a screenshot.
4. Press the send button.

Normal messages start a new ChatGPT conversation by default. Press `New` when you want to clear the loaded panel conversation and make the next send start separately.

## Follow-ups

After a response completes, send another message from the active panel conversation to continue that ChatGPT conversation. Follow-ups use the saved conversation URL and fail clearly if the previous conversation target cannot be reopened.

If you selected a project-history conversation from the side panel, sending from that loaded conversation continues that selected conversation. Press `New` before sending if you want a separate fresh chat instead.

## Screenshot Attachments

1. Open the tab you want to capture.
2. Open the Dichrome side panel for that browser window.
3. Click `Screenshot` in the composer.
4. Confirm the image chip appears in the attachment tray.
5. Add any text you want and press the send button.

The screenshot is the visible viewport of the resolved source tab. It is not a stitched full-page screenshot. Dichrome activates the source tab before capture so `chrome.tabs.captureVisibleTab` captures the intended page.

Chrome can still block restricted browser surfaces such as `chrome://` pages, the Chrome Web Store, and other extension pages. Normal web tabs should work after the extension has been reloaded with the current manifest permissions.

## File Attachments

Use `Files` in the composer or drag files into the composer area. Image files are sent as image attachments where ChatGPT exposes a compatible file input. Other files are buffered and passed through the same attachment path when possible.

Attachment upload depends on the current ChatGPT web UI. If the page stops exposing a compatible file input, the request fails with a file-input error rather than pretending the attachment was sent.

## Project History

The side panel loads project history automatically for the configured project. Use the history list to open recent project conversations in the panel. The history path is read-only until you choose a conversation and send a follow-up.

If history cannot load, check:

- You are signed in to ChatGPT.
- The configured project name or project URL exists and belongs to the signed-in account.
- Hidden internal automation is healthy.
- ChatGPT has not shown an account gate or modal that needs manual handling.

## Model Selection

Choose a visible ChatGPT model or mode label from the mode dropdown, such as `Auto`, `Instant`, `Thinking`, `Extended`, or another label your account actually shows. Dichrome saves the current model setting before sends, follow-ups, screenshot sends, and retries.

If `Require exact match` is enabled, a missing model label stops the request before prompt insertion. With exact matching off, known aliases may be accepted where the ChatGPT UI uses nearby wording.

## Troubleshooting

- If screenshot capture fails after pulling or editing the manifest, reload Dichrome on `chrome://extensions`.
- If the keyboard shortcut does not fire, check `chrome://extensions/shortcuts`; Chrome may leave a shortcut unassigned if another extension already claimed it.
- If a screenshot captures the wrong page, click the intended source tab and open the side panel from that same browser window before retrying.
- If requests stall at ChatGPT, use the sign-in/setup handoff and check for sign-in, account, cookie, or modal prompts.
- If project routing fails, confirm the configured project name or project URL is valid and `Create if missing` is enabled when creation is intended.
- If model selection fails, use the exact label visible in your ChatGPT account or turn off exact matching.

## Local Validation

Run the local checks before treating a change as ready:

```bash
npm run check
npm test
```

No install step is required for these checks. They use Node built-ins only.
