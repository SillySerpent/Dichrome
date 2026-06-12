# Setup and Usage

This guide is for loading Dichrome locally and using its two Chrome side-panel modes against an already signed-in ChatGPT account.

## Requirements

- Chrome or another Chromium browser that supports Manifest V3 side panels. Chrome 116 or newer is the baseline.
- A ChatGPT account signed in at `https://chatgpt.com/`.
- This repository directory available on the same machine where the browser is running.

Dichrome is local and UI-driven. It does not use the OpenAI API and does not require a hosted backend. Mode 2 is the default ChatGPT sidebar companion. Mode 1 is the original Dichrome hidden-automation UI and is labelled as an early beta before users switch into it.

No separate non-Chromium package is built; this project targets Chrome/Chromium side panels only. Firefox support is no longer considered because Firefox provides a GPT sidebar by default, and removing Firefox-specific code keeps Dichrome's extension runtime simpler.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the repository root directory, not a subfolder.
5. Accept the permission prompt.
6. Pin or open the `Dichrome` extension from the browser toolbar, or use `Alt+Shift+D`.
7. Open `https://chatgpt.com/` in a normal tab and confirm the account is signed in.

The Chrome manifest requests access to all sites so screenshot actions can capture visible normal web tabs without relying on a temporary `activeTab` grant or repeated per-site prompts. It also requests ChatGPT host access, side-panel access, storage, offscreen documents, clipboard writes for Mode 2 copy/fallback controls, window control for the Mode 2 fallback ChatGPT companion window, and declarative network request access for ChatGPT iframe frame-policy probes.

If the manifest changed while the extension was already loaded, use the reload button for Dichrome on `chrome://extensions` before testing again.

The default side-panel shortcut is `Alt+Shift+D`. It can be changed from `chrome://extensions/shortcuts`. On Chrome versions with side-panel close support, the same shortcut closes the panel when Dichrome is already open.

## First Run

1. Open a normal webpage that you want to use as source context.
2. Open the Dichrome side panel from the toolbar or with `Alt+Shift+D`.
3. Confirm the compact mode control is present and Mode 2 opens the embedded ChatGPT sidebar.
4. If the embedded ChatGPT frame loads, use it normally. If it does not, press `Open` to launch the ChatGPT companion window.
5. Select text on the source page and use the selection popover or context menu to prepare a prompt.
6. Press `Copy prompt` and paste into ChatGPT, or use the embedded frame directly.
7. If ChatGPT asks for sign-in, human verification, account selection, or another modal, resolve it in ChatGPT and reload the embedded frame or retry the action.

Fresh installs open Mode 2 by default. Existing local installs that already have original Dichrome automation settings or session state migrate to Mode 1 so the prior workflow is not hidden unexpectedly.

## Mode Switching

1. Open the root Dichrome side panel.
2. Press the compact `Mode` control.
3. Choose `Mode 2 - ChatGPT Sidebar` or `Mode 1 - Original Dichrome Beta`.
4. When switching into Mode 1, read and acknowledge the early beta warning:

```text
Original Dichrome (Mode 1) is an early beta.

It uses hidden ChatGPT automation for project routing, model selection, attachments, streaming responses, and project history. ChatGPT UI changes can break this mode. You can switch back to the Mode 2 sidebar at any time from settings.
```

Switching back to Mode 2 is immediate when Mode 1 has no active request. If a Mode 1 request is active, the shell blocks the switch unless the user explicitly chooses to cancel that request first.

## Selected Text Workflow

1. Highlight text on a normal webpage.
2. Use the selection popover or right-click menu.
3. Choose one of the shared Dichrome actions:
   - `Ask with Dichrome about "%s"`
   - `Summarize with Dichrome`
   - `Explain with Dichrome`
   - `Rewrite with Dichrome`
   - `Define with Dichrome`
4. The side panel opens for the source tab.
5. In Mode 2, Dichrome creates a copyable prompt and exposes it beside the embedded ChatGPT sidebar.
6. In Mode 1, Dichrome routes the prompt into the configured ChatGPT project and streams the newest assistant response back into the panel.

The source webpage should stay focused during normal Mode 1 hidden-internal automation.

## Mode 2 Screenshot And Prompt Controls

1. Open a normal webpage with visible content.
2. Open Dichrome in Mode 2.
3. Press `Shot`, use the context menu `Capture visible screenshot`, use the screenshot shortcut, or use the selection popover `Screenshot` action.
4. Confirm the screenshot appears as an attachment in the embedded ChatGPT prompt box when the frame is loaded and ChatGPT exposes a compatible upload input.
5. If the embedded frame cannot accept the image, use `Copy image` to place the captured screenshot on the clipboard, or `Save` to download the PNG.
6. Select text and use a shared selection action, then press `Copy prompt` to copy the prepared prompt.

Mode 2 does not press ChatGPT's send button. Screenshot attachment places the image in the composer and leaves the final send action under user control.

## Mode 1 Manual Messages

1. Open the side panel on a normal webpage.
2. Switch to `Mode 1 - Original Dichrome Beta` if it is not already active.
3. Type into the message composer.
4. Optionally attach selected page text, files, or a screenshot.
5. Press the send button.

Mode 1 normal messages start a new ChatGPT conversation by default. Press `New` when you want to clear the loaded panel conversation and make the next send start separately.

## Mode 1 Follow-ups

After a response completes, send another message from the active panel conversation to continue that ChatGPT conversation. Follow-ups use the saved conversation URL and fail clearly if the previous conversation target cannot be reopened.

If you selected a project-history conversation from the side panel, sending from that loaded conversation continues that selected conversation. Press `New` before sending if you want a separate fresh chat instead.

## Mode 1 Screenshot Attachments

1. Open the tab you want to capture.
2. Open the Dichrome side panel for that browser window.
3. Click `Screenshot` in the composer.
4. Confirm the image chip appears in the attachment tray.
5. Add any text you want and press the send button.

The screenshot is the visible viewport of the resolved source tab. It is not a stitched full-page screenshot. Dichrome activates the source tab before capture so `chrome.tabs.captureVisibleTab` captures the intended page.

Chrome can still block restricted browser surfaces such as `chrome://` pages, the Chrome Web Store, and other extension pages. Normal web tabs should work after the extension has been reloaded with the current manifest permissions.

## File Attachments

Use `Files` in the Mode 1 composer or drag files into the composer area. Image files are sent as image attachments where ChatGPT exposes a compatible file input. Other files are buffered and passed through the same attachment path when possible.

Attachment upload depends on the current ChatGPT web UI. If the page stops exposing a compatible file input, the request fails with a file-input error rather than pretending the attachment was sent.

## Mode 1 Project History

The side panel loads project history automatically for the configured project. In Chrome, each history refresh reloads a separate hidden history frame so the active chat frame is not navigated away from a draft or streaming conversation. Use the history list to open recent project conversations in the panel. The history path is read-only until you choose a conversation and send a follow-up.

If history cannot load, check:

- You are signed in to ChatGPT.
- The configured project name or project URL exists and belongs to the signed-in account.
- Hidden internal automation is healthy.
- ChatGPT has not shown an account gate or modal that needs manual handling.

## Mode 1 Model Selection

Choose a visible ChatGPT model or mode label from the mode dropdown, such as `Auto`, `Instant`, `Thinking`, `Extended`, or another label your account actually shows. Dichrome saves the current model setting before sends, follow-ups, screenshot sends, and retries.

If `Require exact match` is enabled, a missing model label stops the request before prompt insertion. With exact matching off, known aliases may be accepted where the ChatGPT UI uses nearby wording.

## Troubleshooting

- If screenshot capture fails after pulling or editing the manifest, reload Dichrome on `chrome://extensions`.
- If the keyboard shortcut does not fire, check `chrome://extensions/shortcuts`; Chrome may leave a shortcut unassigned if another extension already claimed it.
- If a screenshot captures the wrong page, click the intended source tab and open the side panel from that same browser window before retrying.
- If Mode 2's embedded frame does not load, press `Reload`; if it still fails, use `Open` for the ChatGPT companion window.
- If Mode 2 captures a screenshot but cannot attach it to ChatGPT, use the compact fallback copy/save controls and check whether ChatGPT is signed in or showing a modal.
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
