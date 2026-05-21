# Chrome Web Store Submission Notes

Use this file as the review packet source when preparing the Chrome Web Store listing, privacy fields, and reviewer instructions. It is not a substitute for the Developer Dashboard fields.

## Single Purpose

Dichrome is a local-first side-panel extension that lets a user send selected webpage text, typed prompts, and optional user-chosen attachments to a hidden internal ChatGPT workspace, then read the assistant response in the extension side panel.

The extension does not replace search, inject ads, alter page content, or run a hosted backend.

## Store Package

Run the full local gate before uploading:

```bash
npm run check
npm test
npm run package
```

Upload the ZIP created under `.dist/`, not the whole repository. The package script includes only the runtime extension files required by Chrome:

- `manifest.json`
- `background/`
- `content/`
- `shared/`
- `sidepanel/`
- `offscreen/`
- `icons/`
- `LICENSE`

## Permission Justifications

| Permission | Why Dichrome needs it |
| --- | --- |
| `activeTab` | Reads the user's current selection from the active source tab when the side panel is used, and attempts visible-tab screenshot capture only after a user action. |
| `contextMenus` | Adds the user-invoked selection actions: ask, define, and summarize. |
| `declarativeNetRequestWithHostAccess` | Installs session-scoped rules limited to ChatGPT subframe responses for hidden internal automation probing. The rule removes embedding headers only for the ChatGPT iframe used by the offscreen automation path and is removed when unsupported or closed. |
| `offscreen` | Hosts the extension-owned offscreen automation page that contains the ChatGPT iframe used by hidden internal mode. |
| `scripting` | Registers and runs packaged scripts for ChatGPT pages and reads selected text from the active source tab after a user action. |
| `sidePanel` | Provides the main extension UI. |
| `storage` | Stores user settings, recent request state, request events, and the hidden workspace session summary. |
| `tabs` | Finds the active source tab and opens ChatGPT only when the user chooses the sign-in/setup handoff. |

## Host Permissions

| Host permission | Why Dichrome needs it |
| --- | --- |
| `https://chatgpt.com/*` | Runs the packaged content script in ChatGPT and communicates with ChatGPT pages through the user's signed-in browser session. |
| `https://chat.openai.com/*` | Supports the legacy ChatGPT host and redirects used by existing user sessions. |

Dichrome does not request required or optional `<all_urls>` host access.

## Remote Code Statement

Select the Developer Dashboard remote-code answer that states the extension does not execute remote code.

The extension does communicate with remote services as data endpoints:

- ChatGPT pages and ChatGPT backend endpoints through the user's signed-in browser session.
No developer-operated service receives the user's data from the extension.

The submitted package contains the extension logic. It does not load remote script files, does not call `eval`, does not use `new Function`, and does not execute code returned by ChatGPT.

## Data Use Disclosure

Disclose the following data categories if the Developer Dashboard asks for them:

- Website content: selected webpage text and visible-tab screenshots when the user invokes those actions.
- User activity: prompts, request state, and ChatGPT response metadata needed to complete and display the requested assistant workflow.
- Files: user-selected attachments and generated screenshot attachments.

Use the privacy policy draft in `docs/privacy-policy.md` as the source for the public privacy policy page. The public URL must match the behavior of the uploaded build.

## Reviewer Test Instructions

1. Load the extension and pin/open the side panel.
2. Sign in to ChatGPT in the same Chrome profile.
3. Open a normal webpage, select text, right-click, and choose `Ask assistant about this`.
4. Confirm the side panel opens, the selected text is routed to ChatGPT, and a response streams back.
5. In the side panel, type a follow-up and send it.
6. Sign out of ChatGPT and retry a request.
7. Confirm the side panel shows a clear sign-in message and that `Open ChatGPT to sign in` opens ChatGPT only for authentication/setup.

## Known Review Risks To Disclose Clearly

- `declarativeNetRequestWithHostAccess` is a high-sensitivity permission. It is core to the local UI-driven hidden automation design and should be justified directly in the privacy fields.
- Hidden internal mode depends on ChatGPT allowing a signed-in session inside an extension-hosted iframe. If that fails, the extension shows an actionable error instead of opening a normal automation tab.
- The extension depends on the user's existing ChatGPT account and browser session. The listing should say that Dichrome is not affiliated with ChatGPT/OpenAI and requires the user to sign in to ChatGPT separately.
