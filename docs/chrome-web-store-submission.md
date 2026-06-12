# Chrome Web Store Submission Notes

Use this file as the source packet for the Chrome Web Store listing, privacy fields, and reviewer instructions. Keep it synchronized with the exact ZIP uploaded to the Developer Dashboard.

## Single Purpose

Dichrome is a local-first Chrome side-panel extension for working with the user's own signed-in ChatGPT web session. Its default Mode 2 embeds a ChatGPT sidebar companion, prepares copyable prompts from selected webpage text, and captures visible screenshots for copy/download. Its optional Mode 1 original Dichrome beta sends user-selected webpage context, typed prompts, screenshots, and user-chosen attachments into ChatGPT through hidden local browser automation, then displays the generated response in the side panel.

The extension does not inject ads, replace search, alter website content beyond its selected-text quick-action popover, run a hosted backend, or use the OpenAI API. Its single purpose is a browser-side ChatGPT companion, prompt-preparation, screenshot, and optional original Dichrome routing workflow.

## Store Package

Run the full local gate before uploading:

```bash
npm run check
npm test
npm run package
```

Upload `.dist/chrome/dichrome-<version>-chrome.zip`, not the whole repository. The package script includes only runtime extension files required by Chrome:

- `manifest.json`
- `background/`
- `content/`
- `shared/`
- `sidepanel/`
- `offscreen/`
- `icons/`
- `LICENSE`

Do not upload repository notes, screenshots, scratch files, generated debug dumps, or unpacked development folders.

## Permission Justifications

| Permission | Why Dichrome needs it |
| --- | --- |
| `activeTab` | Supports explicit user-invoked active-tab workflows such as selected-text handoff from the current source tab. |
| `clipboardWrite` | Lets Mode 2 copy prepared prompts and captured screenshot images to the clipboard only after the user presses a copy control. |
| `contextMenus` | Adds explicit user-invoked actions for selected text, visible screenshot capture, and the ChatGPT companion window. |
| `declarativeNetRequestWithHostAccess` | Installs session-scoped rules limited to ChatGPT subframe responses for the embedded ChatGPT sidebar and Mode 1 hidden internal ChatGPT workspace. The rules are not used for arbitrary websites. |
| `offscreen` | Hosts the extension-owned offscreen document that contains the hidden ChatGPT iframe used by internal automation. |
| `scripting` | Runs packaged scripts on ChatGPT pages and reads selected text from the active source tab after user action. |
| `sidePanel` | Provides the main extension UI. |
| `storage` | Stores user settings, active mode, Mode 2 prompt/screenshot/sidebar state, recent Mode 1 request state, bounded request history, and hidden workspace session metadata. |
| `tabs` | Finds and activates the source tab for user-triggered screenshot capture, reads tab metadata for request context, and opens ChatGPT only when the user chooses the sign-in/setup handoff. |
| `windows` | Opens or refocuses the user-triggered Mode 2 ChatGPT companion popup window when the embedded side-panel frame is unavailable or the user prefers a separate window. |

## Host Permissions

| Host permission | Why Dichrome needs it |
| --- | --- |
| `<all_urls>` | Lets user-triggered screenshot actions capture visible normal web tabs consistently without a transient `activeTab` grant or repeated per-site prompts, and lets the shared selected-text popover run on normal webpages. It is not used for background page crawling, analytics, advertising, or unrelated website modification. |
| `https://chatgpt.com/*` | Runs packaged content scripts in ChatGPT and communicates with ChatGPT through the user's signed-in browser session. |
| `https://chat.openai.com/*` | Supports legacy ChatGPT host redirects and existing sessions. |

## Screenshot Site Access

The manifest includes required `<all_urls>` host access so screenshot actions can capture visible normal web tabs consistently at the moment the user asks for a screenshot.

Implementation constraints:

- Screenshot capture is initiated only after the user presses a screenshot control, selects the screenshot action from the context menu/popover, or uses the screenshot keyboard shortcut.
- The background worker activates the resolved source tab immediately before calling `tabs.captureVisibleTab`.
- Browser-internal pages such as `chrome://`, extension pages, and developer tools pages are rejected with a clear error.
- The permission is used for visible viewport screenshot capture and source-tab context only. In Mode 2, screenshots are prepared for copy/download. In Mode 1, screenshots are attached to a user-started ChatGPT request. The permission is not used for background page crawling, analytics, advertising, or unrelated browsing-history collection.

## Remote Code Statement

Select the Developer Dashboard remote-code answer that states the extension does not execute remote code.

The extension communicates with remote services as data endpoints:

- ChatGPT pages and ChatGPT backend endpoints through the user's signed-in ChatGPT browser session.

No developer-operated service receives user data from the extension. The submitted package contains the extension logic. It does not load remote script files, call `eval`, use `new Function`, or execute code returned by ChatGPT.

## Data Use Disclosure

Disclose, accurately, that Dichrome may handle the following data when the user invokes the corresponding feature:

- Prompts typed by the user.
- Mode 2 prompt records prepared from selected text.
- Selected webpage text.
- Visible-tab screenshots.
- Uploaded or attached files and file metadata.
- Generated ChatGPT responses and response metadata needed to display status/results.
- Local extension settings, active mode, Mode 2 sidebar/prompt/screenshot state, and bounded local/session request state.
- Interaction metadata required to drive the user's own signed-in ChatGPT session, including project routing, conversation URL/key state, and model label preference.

Do not claim that no user data is handled. The more accurate claim is: Dichrome does not send data to a developer-operated backend and does not sell, advertise against, or externally analyze the data.

Use `docs/privacy-policy.md` as the source for the public privacy policy page. The public URL must match the behavior of the uploaded build.

## Reviewer Test Instructions

1. Load the extension and open the side panel.
2. Sign in to ChatGPT in the same Chrome profile.
3. Confirm the side panel opens in `Mode 2 - ChatGPT Sidebar`.
4. Open a normal webpage, select text, right-click, and choose `Ask with Dichrome about "%s"`.
5. Confirm Mode 2 prepares a copyable prompt and keeps the user in control of the embedded ChatGPT frame or fallback companion window.
6. Press `Shot` on a normal webpage and confirm the screenshot is prepared for copy/download rather than auto-sent.
7. Open root `Settings`, choose `Mode 1 - Original Dichrome Beta`, and confirm the early beta warning must be acknowledged before switching.
8. In Mode 1, select webpage text, choose a Dichrome selected-text action, and confirm the selected text is routed to ChatGPT and the generated response appears in the side panel.
9. Open Mode 1 `Settings`, change the ChatGPT project routing target, save, and confirm the history panel reflects the configured project.
10. Type a follow-up in Mode 1 and confirm it continues the active conversation.
11. Press `New`, send a message, and confirm it starts a separate conversation.
12. Sign out of ChatGPT and retry a Mode 1 request.
13. Confirm the side panel shows a clear sign-in message and that `Open ChatGPT to sign in` opens ChatGPT only for authentication/setup.

## Required Manual QA Matrix

Before submission, manually test these cases in a clean Chrome profile and document outcomes:

- Clean Chrome profile, not signed into ChatGPT.
- Clean Chrome profile, already signed into ChatGPT.
- Extension upgrade over an old version.
- Fresh install opens Mode 2 by default.
- Existing original Dichrome storage migrates to Mode 1.
- Mode 1 beta warning and active-request switch guard.
- Mode 2 embedded ChatGPT frame and fallback companion window.
- Mode 2 selected-text prompt copy and screenshot copy/download.
- Configured project exists.
- Configured project renamed or missing.
- Model unavailable on the user's ChatGPT tier.
- ChatGPT offline or unreachable.
- Project-history recent chat open.
- Project-history older chat open.
- Deep project-history scroll.
- New chat after model switch.
- Follow-up after model switch.
- Screenshot attach-only flow on non-ChatGPT webpages.
- Large selected text.
- Service worker cold start after idle.

## Known Review Risks To Disclose Clearly

- `declarativeNetRequestWithHostAccess` is high-sensitivity and must be justified as part of the embedded ChatGPT sidebar and Mode 1 hidden internal ChatGPT workspace design.
- Required `<all_urls>` host access is present for deterministic user-triggered visible-tab screenshot capture and should be described narrowly.
- Mode 2's embedded ChatGPT iframe may be blocked or behave differently depending on ChatGPT account/session behavior. The extension provides reload and user-triggered fallback-window controls.
- Mode 1 hidden internal mode depends on ChatGPT allowing a signed-in session inside an extension-hosted iframe. If that fails, the extension shows an actionable error instead of silently failing or opening uncontrolled tabs.
- The extension depends on the user's existing ChatGPT account and browser session. The listing should say Dichrome is not affiliated with ChatGPT/OpenAI and requires the user to sign in to ChatGPT separately.
