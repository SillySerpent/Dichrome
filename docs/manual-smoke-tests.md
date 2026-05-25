# Manual Smoke Tests

Run `npm run check`, `npm test`, and `npm run package` before manual testing. Load the current unpacked extension after code changes so the browser sees the new target manifest and content script order.

For Chrome or Chromium, load this repository directory through `chrome://extensions`. For Firefox, run `npm run package:firefox`, open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on, and select `.dist/firefox/package/manifest.json`.

Run the core hidden-internal, logged-out, project-history, project-routing, follow-up, model-selection, attachment, and formatting checks in both Chrome/Chromium and Firefox before claiming cross-browser compatibility.

## Hidden Internal

1. Sign in to ChatGPT in the browser profile.
2. Open a normal webpage, select text, and choose `Ask assistant about this`.
3. Confirm no visible ChatGPT automation tab or window is created.
4. Confirm the side panel streams response text and reaches `RESPONSE_COMPLETE`.
5. Confirm the status text uses hidden workspace wording rather than tab-mode wording.

## Logged Out

1. Use a fresh browser profile or sign out of ChatGPT.
2. Open Dichrome and try a normal message and a project-history refresh.
3. Confirm the sidebar says the user must sign in to ChatGPT.
4. Click `Open ChatGPT to sign in` and complete authentication.
5. Return to Dichrome, retry once, and confirm project history and normal sends recover predictably.

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
5. Confirm successful attachments send through ChatGPT's file input.
6. Open another normal website in the same window and repeat the screenshot flow without a runtime host-permission prompt.
7. Try a restricted browser page such as `chrome://extensions` and confirm any failure clearly explains that the browser blocks restricted surfaces.
8. Try an oversized or unsupported file and confirm the sidebar does not present the attachment as successfully sent.
9. Confirm ChatGPT upload-limit or rejection messages surface as user-readable errors.

## Usage Limits

1. Use an account state that is temporarily limited, or wait for a known usage/upload limit.
2. Send a normal request or attachment.
3. Confirm the sidebar shows a bounded error state instead of spinning indefinitely.
4. Confirm retry behavior is manual and does not loop.

## Math Rendering

1. Ask ChatGPT for an answer containing:
   - `$$\frac{a_1}{\sqrt{b^2}} + \alpha$$`
   - `\(x_i^2\)`
   - `\text{units}` or `\mathrm{kg}`
   - `\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}`
   - `\begin{cases} x^2, & x \ge 0 \\ -x, & x < 0 \end{cases}`
2. Confirm display math, inline math, matrices, and cases render visibly in the side panel without raw `begin...end` text.
3. Ask for a malformed expression such as `$$\frac{a}$$`.
4. Confirm it renders as escaped source in a styled math fallback instead of broken HTML.

## Response Formatting

1. Ask ChatGPT for a mixed-format response containing a table, task list, strikethrough, fenced code block, and `:::writing{variant="email"}` block.
2. Confirm writing directives do not appear as raw fence text in the side panel.
3. Confirm code and display-math copy buttons are hidden until their block is hovered or keyboard-focused.
4. Select and copy a larger section of the rendered response, then confirm copied text does not include the side panel's copy-button labels.
