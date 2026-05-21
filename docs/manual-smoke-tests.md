# Manual Smoke Tests

Run `npm run check` and `npm test` before manual testing. Load the unpacked extension after code changes so Chrome sees the new manifest and content script order.

## Hidden Internal

1. In the side panel, set automation target mode to `Hidden internal`.
2. Open a normal webpage, select text, and choose `Ask assistant about this`.
3. Confirm the source webpage stays focused.
4. Confirm the side panel streams response text and reaches `RESPONSE_COMPLETE`.
5. Click `Dump Debug`.
6. Confirm the debug dump reports an offscreen host and a connected offscreen frame bridge.
7. Confirm no new visible ChatGPT tab is created when hidden support is working.

## Hidden Fallback Single Tab

1. Use a browser/profile state where hidden internal is unsupported, or temporarily block the offscreen bridge during local diagnosis.
2. Run a normal selection request in `Hidden internal`.
3. Confirm the request appends a fallback/support event.
4. Confirm exactly one inactive ChatGPT tab is created or reused.
5. Confirm the source tab remains selected and the side panel completes the response.

## One Background Tab

1. Set automation target mode to `One background tab`.
2. Run two normal selection requests from different source tabs.
3. Confirm both reuse the same inactive ChatGPT tab.
4. Confirm the tab is not duplicated after completion.

## Visible Side Window

1. Set automation target mode to `Visible side window`.
2. Run a normal request.
3. Confirm the side window opens for visual inspection.
4. Confirm response streaming still completes.
5. Confirm debugger focus emulation status appears in `Dump Debug`.

## Focus ChatGPT

1. Set automation target mode to `Focus ChatGPT`.
2. Run a normal request.
3. Confirm ChatGPT becomes focused during generation.
4. Confirm focus returns to the source tab after completion or error.

## Project Routing

1. Enable project routing and set a known project name.
2. Run a normal request.
3. Confirm the request reaches `PROJECT_READY` before `PROMPT_INSERTED`.
4. Confirm the conversation is inside the requested project.
5. Set a missing project name with `Create if missing` disabled.
6. Confirm the request fails before sending the prompt.

## Follow-Up

1. Run a normal request to completion.
2. Enter a follow-up in the side panel follow-up box.
3. Confirm the follow-up uses the saved parent conversation URL.
4. Confirm it does not start a fresh chat.

## Model Selection

1. Choose a visible model or mode label for the account, such as `Instant`, `Thinking`, or `Extended` when that label is shown in ChatGPT. Confirm the Enabled checkbox turns on automatically.
2. Run a request without pressing Save Routing first and confirm `MODEL_SELECTED` appears before prompt insertion.
3. Send a follow-up and confirm `MODEL_SELECTED` appears before the follow-up prompt insertion.
4. Enable `Require exact match` with an unavailable model label.
5. Confirm the request fails before sending.

## Screenshot Request

1. Open a normal webpage with visible content.
2. Open Dichrome from the toolbar or context menu so Chrome grants active-tab access for the source tab.
3. Use the side-panel screenshot request.
4. Confirm an image attachment is attempted through ChatGPT's file input.
5. Confirm the request either sends with the attachment or fails with a clear capture/file-input error.

## Local Repair

1. Enable local repair and configure the local Ollama-compatible endpoint.
2. Trigger or simulate a DOM adapter failure.
3. Confirm repair suggestions appear only when strict JSON hints validate.
4. Retry with repair hints and confirm the hints are still checked against runtime element predicates.

## Debug Dump

1. Click `Dump Debug` while idle.
2. Click `Dump Debug` during a request.
3. Confirm both dumps render without throwing and include request/session/offscreen/focus/content sections where available.

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
