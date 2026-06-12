# Manual Smoke Tests

Run `npm run check`, `npm test`, and `npm run package` before manual testing. Load the current unpacked extension after code changes so the browser sees the new target manifest and content script order.

Load this repository directory through `chrome://extensions` in Chrome or another Chromium browser.

Run the Mode 2 default, mode-switching, shared screenshot/selection, Mode 1 hidden-internal, logged-out, project-history, project-routing, follow-up, model-selection, attachment, and formatting checks in Chrome/Chromium before claiming browser compatibility.

No separate non-Chromium package is built; browser smoke coverage is Chrome/Chromium only.

## Mode 2 Default Sidebar

1. Load the unpacked extension in a clean Chrome/Chromium profile.
2. Open a normal webpage and press `Alt+Shift+D`.
3. Confirm the root shell opens with only a compact floating mode/settings control and the embedded Mode 2 ChatGPT sidebar gets nearly all vertical space.
4. Confirm the embedded ChatGPT frame loads or presents a clear frame-policy/status message.
5. Press `Open` and confirm a ChatGPT companion popup window opens or refocuses.
6. Press `Reload` and confirm the embedded frame retries without reloading the extension.

## Mode 2 Selection And Screenshot

1. Highlight text on a normal webpage.
2. Use the selection popover `Ask`, `Summarize`, `Explain`, and `Rewrite` actions.
3. Confirm the side panel opens and the Mode 2 `Copy prompt` action appears with a prompt grounded in the selected text.
4. Right-click selected text and repeat `Ask with Dichrome`, `Summarize with Dichrome`, `Explain with Dichrome`, `Rewrite with Dichrome`, and `Define with Dichrome`.
5. Use `Shot`, the selection popover `Screenshot` action, the context-menu `Capture visible screenshot`, and the screenshot keyboard shortcut.
6. Confirm Mode 2 attaches the visible source-tab screenshot as an image chip in the embedded ChatGPT composer when the frame is loaded.
7. Confirm `Copy image` and `Save` remain available as compact fallback controls if the embedded frame is unavailable or ChatGPT rejects the image upload.
8. Confirm screenshots are not auto-sent to ChatGPT in Mode 2; the user must still press ChatGPT's send button.

## Mode Switching

1. Open the root `Settings` control.
2. Choose `Mode 1 - Original Dichrome Beta`.
3. Confirm the early beta warning is visible and switching is blocked until the acknowledgement checkbox is selected.
4. Save, then confirm the original Dichrome UI loads inside the shell.
5. Switch back to `Mode 2 - ChatGPT Sidebar` and confirm the Mode 2 sidebar reloads without a browser extension reload.
6. Start a Mode 1 request, then try to switch back while it is active.
7. Confirm the switch is blocked unless `Cancel the active Mode 1 request before switching` is checked.

## Mode 1 Hidden Internal

1. Sign in to ChatGPT in the browser profile.
2. Switch to `Mode 1 - Original Dichrome Beta`.
3. Open a normal webpage, select text, and choose `Ask with Dichrome about "%s"`.
4. Confirm no visible ChatGPT automation tab or window is created.
5. Confirm the side panel streams response text and reaches `RESPONSE_COMPLETE`.
6. Confirm the status text uses hidden workspace wording rather than tab-mode wording.

## Side Panel Shortcut And Narrow Layout

1. Open a normal webpage and press `Alt+Shift+D`.
2. Confirm the Dichrome side panel shell opens and the browser toolbar area remains separate from the extension content.
3. Press `Alt+Shift+D` again in Chrome or Chromium and confirm the panel closes when the browser exposes side-panel close support.
4. Drag the side-panel divider as narrow as the browser allows.
5. In Mode 2, confirm the compact floating Shot, Reload, Open, frame-status, fallback action, and toast controls remain usable without covering the ChatGPT composer.
6. Switch to Mode 1 and confirm the header, history area, response area, composer, screenshot button, file button, routing label, and send button remain usable without overlapping text.

## Logged Out

1. Use a fresh browser profile or sign out of ChatGPT.
2. Open Dichrome in Mode 2 and confirm the embedded frame or fallback window requires sign-in clearly.
3. Switch to Mode 1 and try a normal message and a project-history refresh.
4. Confirm the sidebar says the user must sign in to ChatGPT.
5. Click `Open ChatGPT to sign in` and complete authentication.
6. Return to Dichrome, retry once, and confirm project history and normal sends recover predictably.

## Project History

1. Use a project with enough conversations to scroll.
2. Confirm project history loads automatically through the hidden workspace.
3. Scroll near the bottom and load older conversations.
4. Confirm the list keeps its visual scroll anchor after loading.
5. Click a lower conversation and confirm the conversation loads without resetting the project-history scroll position.
6. Confirm long project and conversation titles truncate cleanly and action text remains readable.

## Project Routing

1. Use the default project routing configuration.
2. Run a normal request.
3. Confirm the request reaches `PROJECT_READY` before `PROMPT_INSERTED`.
4. Confirm the conversation is inside the requested project.
5. Set a missing project name with project creation disabled through internal settings, then confirm the request fails before sending the prompt.

## Follow-Up

1. Run a normal request to completion.
2. Enter a follow-up in the side-panel composer.
3. Confirm the follow-up uses the saved parent conversation URL in the hidden workspace.
4. Confirm it does not start a fresh chat unless `New` was pressed.

## Model Selection

1. Choose a visible model or mode label for the account, such as `Instant`, `Thinking`, or `Extended` when that label is shown in ChatGPT.
2. Run a request and confirm `MODEL_SELECTED` appears before prompt insertion.
3. Select a model label unavailable on the account.
4. Confirm the request fails before prompt insertion and the message clearly says the model is unavailable.

## Attachments And Screenshot

1. Open a normal webpage with visible content.
2. Open Dichrome from the toolbar or context menu on that source tab.
3. Attach a local file and attach a visible screenshot.
4. Confirm an image chip appears in the composer attachment tray.
5. Drag a local image file into the composer and confirm it appears as an attachment chip.
6. Copy a webpage image with the browser context menu or `Cmd+C`, paste it into the composer, and confirm the image appears as an attachment chip rather than URL text.
7. Drag a webpage image into the composer and confirm it appears as an attachment chip rather than URL text.
8. Drag selected webpage text and a non-image link into the composer and confirm readable text or the link is inserted into the message field.
9. Add screenshots until the image cap is reached and confirm the composer refuses additional screenshots with a clear local message before sending.
10. Confirm each attachment appears as an accepted ChatGPT composer chip before the prompt sends.
11. Open another normal website in the same window and repeat the screenshot flow without a runtime host-permission prompt.
12. Try a restricted browser page such as `chrome://extensions` and confirm any failure clearly explains that the browser blocks restricted surfaces.
13. Try an oversized or unsupported file and confirm the sidebar does not present the attachment as successfully sent.
14. Confirm ChatGPT upload-limit or rejection messages surface as user-readable errors and do not quote the user's prompt as the technical upload detail.

## Selection Sync

1. Open Dichrome beside a normal webpage.
2. In Mode 2, select text on the page and confirm the shared popover appears without disrupting the page selection.
3. Switch to Mode 1.
4. Select text on the page and confirm the selected-text card appears after about three seconds without pressing the panel refresh button.
5. Change the page selection and confirm the card updates to the new text after about three seconds.
6. Clear the page selection and confirm the selected-text card disappears automatically after about three seconds.
7. Press `Remove` on the selected-text card and confirm the same still-highlighted text does not reappear until the page selection changes or clears.

## Usage Limits

1. Use an account state that is temporarily limited, or wait for a known usage/upload limit.
2. Send a normal request or attachment.
3. Confirm the sidebar shows a bounded error state instead of spinning indefinitely.
4. Confirm retry behavior is manual and does not loop.

## Math Rendering

1. Ask ChatGPT for an answer containing:
   - `$$\frac{a_1}{\sqrt{b^2}} + \alpha$$`
   - `\(x_i^2\)`
   - `\(\hat{x} + P' + \widehat{AB}\)`
   - `\text{units}` or `\mathrm{kg}`
   - `\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}`
   - `\begin{bmatrix} 1 & 20 \\ 300 & 4 \end{bmatrix}\begin{pmatrix} x \\ y \end{pmatrix}`
   - `\begin{cases} x^2, & x \ge 0 \\ -x, & x < 0 \end{cases}`
2. Confirm display math, inline math, hats, primes, matrix products, and cases render visibly in the side panel without raw `begin...end` text.
3. Ask for a malformed expression such as `$$\frac{a}$$`.
4. Confirm it renders as escaped source in a styled math fallback instead of broken HTML.

## Response Formatting

1. Ask ChatGPT for a mixed-format response containing a table, task list, strikethrough, fenced code block, and `:::writing{variant="email"}` block.
2. Confirm writing directives do not appear as raw fence text in the side panel.
3. Confirm code and display-math copy buttons are hidden until their block is hovered or keyboard-focused.
4. Select and copy a larger section of the rendered response, then confirm copied text does not include the side panel's copy-button labels.
