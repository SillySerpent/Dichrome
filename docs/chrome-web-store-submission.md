# Chrome Web Store Submission Notes

Use this file as the source packet for the Chrome Web Store listing, privacy fields, and reviewer instructions. Keep it synchronized with the exact ZIP uploaded to the Developer Dashboard.

## Single Purpose

Dichrome is a local-first Chrome side-panel extension for sending user-selected webpage context, typed prompts, screenshots, and user-chosen attachments into the user's own signed-in ChatGPT web session, then displaying the generated response in the side panel.

The extension does not inject ads, replace search, alter website content, run a hosted backend, or use the OpenAI API. Its single purpose is a browser-side ChatGPT routing and response-viewing workflow.

## Store Package

Run the full local gate before uploading:

```bash
npm run check
npm test
npm run package
```

Upload `.dist/chrome/dichrome-<version>-chrome.zip`, not the whole repository or the Firefox ZIP. The package script includes only runtime extension files required by Chrome:

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
| `activeTab` | Reads selected text from the active source tab after a user action and may allow screenshot capture of the current visible tab without persistent host access. |
| `contextMenus` | Adds explicit user-invoked selection actions: ask, define, and summarize. |
| `declarativeNetRequestWithHostAccess` | Installs session-scoped rules limited to ChatGPT subframe responses for the hidden internal ChatGPT workspace. The rules are not used for arbitrary websites. |
| `offscreen` | Hosts the extension-owned offscreen document that contains the hidden ChatGPT iframe used by internal automation. |
| `scripting` | Runs packaged scripts on ChatGPT pages and reads selected text from the active source tab after user action. |
| `sidePanel` | Provides the main extension UI. |
| `storage` | Stores user settings, recent request state, bounded request history, and hidden workspace session metadata. |
| `tabs` | Finds the active source tab, captures the visible tab after user action, and opens ChatGPT only when the user chooses the sign-in/setup handoff. |

## Host Permissions

| Host permission | Why Dichrome needs it |
| --- | --- |
| `https://chatgpt.com/*` | Runs packaged content scripts in ChatGPT and communicates with ChatGPT through the user's signed-in browser session. |
| `https://chat.openai.com/*` | Supports legacy ChatGPT host redirects and existing sessions. |

## Optional Screenshot Site Access

The manifest includes `optional_host_permissions: ["<all_urls>"]` solely so the side-panel screenshot button can request access to the active website at the moment the user asks to attach a screenshot.

Implementation constraints:

- Access is requested from the side panel only after the user presses `Screenshot`.
- The request is narrowed to the active page's origin, for example `https://example.com/*`, rather than immediately granting every site.
- Browser-internal pages such as `chrome://`, extension pages, and developer tools pages are rejected with a clear error.
- The permission is used for visible viewport screenshot capture and selected-text workflows only. It is not used for background page crawling, analytics, advertising, or unrelated browsing-history collection.

## Remote Code Statement

Select the Developer Dashboard remote-code answer that states the extension does not execute remote code.

The extension communicates with remote services as data endpoints:

- ChatGPT pages and ChatGPT backend endpoints through the user's signed-in ChatGPT browser session.

No developer-operated service receives user data from the extension. The submitted package contains the extension logic. It does not load remote script files, call `eval`, use `new Function`, or execute code returned by ChatGPT.

## Data Use Disclosure

Disclose, accurately, that Dichrome may handle the following data when the user invokes the corresponding feature:

- Prompts typed by the user.
- Selected webpage text.
- Visible-tab screenshots.
- Uploaded or attached files and file metadata.
- Generated ChatGPT responses and response metadata needed to display status/results.
- Local extension settings and bounded local/session request state.
- Interaction metadata required to drive the user's own signed-in ChatGPT session, including project routing, conversation URL/key state, and model label preference.

Do not claim that no user data is handled. The more accurate claim is: Dichrome does not send data to a developer-operated backend and does not sell, advertise against, or externally analyze the data.

Use `docs/privacy-policy.md` as the source for the public privacy policy page. The public URL must match the behavior of the uploaded build.

## Reviewer Test Instructions

1. Load the extension and open the side panel.
2. Sign in to ChatGPT in the same Chrome profile.
3. Open a normal webpage, select text, right-click, and choose `Ask assistant about this`.
4. Confirm the side panel opens, the selected text is routed to ChatGPT, and the generated response appears in the side panel.
5. Open `Settings`, change the ChatGPT project routing target, save, and confirm the history panel reflects the configured project.
6. Type a follow-up in the side panel and confirm it continues the active conversation.
7. Press `New`, send a message, and confirm it starts a separate conversation.
8. Press `Screenshot` on a normal webpage, approve the site-access prompt if shown, and confirm the screenshot is attached rather than auto-sent.
9. Sign out of ChatGPT and retry a request.
10. Confirm the side panel shows a clear sign-in message and that `Open ChatGPT to sign in` opens ChatGPT only for authentication/setup.

## Required Manual QA Matrix

Before submission, manually test these cases in a clean Chrome profile and document outcomes:

- Clean Chrome profile, not signed into ChatGPT.
- Clean Chrome profile, already signed into ChatGPT.
- Extension upgrade over an old version.
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

- `declarativeNetRequestWithHostAccess` is high-sensitivity and must be justified as part of the hidden internal ChatGPT workspace design.
- Optional `<all_urls>` host access is present for user-triggered active-site screenshot capture and should be described narrowly.
- Hidden internal mode depends on ChatGPT allowing a signed-in session inside an extension-hosted iframe. If that fails, the extension shows an actionable error instead of silently failing or opening uncontrolled tabs.
- The extension depends on the user's existing ChatGPT account and browser session. The listing should say Dichrome is not affiliated with ChatGPT/OpenAI and requires the user to sign in to ChatGPT separately.
