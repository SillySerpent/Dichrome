# Dichrome

Dichrome is a Chrome extension that puts ChatGPT beside the page you’re browsing. Highlight text to ask about it, summarize a passage, or capture a screenshot and add it to your conversation without switching tabs.

It uses the ChatGPT website and your existing browser sign-in. You don’t need an API key or a separate backend.

## What it does

- Opens ChatGPT in the browser’s side panel.
- Turns selected text into an editable prompt with a link to the source page. Actions include Ask, Summarize, Explain, Rewrite, and Define.
- Captures the visible part of the current tab and attaches it to ChatGPT when image uploads are available.
- Keeps captured text and screenshots in a Context drawer, with controls to copy, save, or clear them.
- Opens ChatGPT in a separate window if it won’t load reliably in the sidebar.

The default sidebar mode prepares text and attachments but leaves sending to you. It won’t overwrite an existing ChatGPT draft.

## Install locally

You need Chrome 116 or newer, or a Chromium browser with compatible side-panel support, and a signed-in ChatGPT account. This repository currently targets Chrome/Chromium; it does not build a Firefox package.

1. Clone or download this repository. If you download a ZIP, extract it first.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the repository’s root folder, which contains `manifest.json`.
4. Sign in to ChatGPT in a normal browser tab.
5. Open a webpage, then click the Dichrome toolbar icon or press `Alt+Shift+D`.

You can load the extension directly from source; no build or dependency installation is required. After updating the files, reload Dichrome from `chrome://extensions` and refresh any webpages where you’re using its selection controls.

## Use the sidebar

Highlight text on a webpage and choose an action from the selection toolbar or the right-click menu. Dichrome opens the sidebar and adds an editable prompt to **Context**.

Hover over the sidebar’s top toolbar to open Context, review the prompt, then choose **Insert into ChatGPT** or **Copy**. Keyboard users can open Context with Enter or Space and close it with Escape; touch users can tap the Context button. Moving away closes the drawer without clearing its contents.

Click **Screenshot** to capture the visible part of the source tab. Dichrome tries to attach it to the embedded ChatGPT composer. The screenshot stays in Context with **Attach image**, **Copy image**, **Save**, and **Clear image** controls. Screenshots capture the visible viewport, not the full page.

Review the text and attachments in ChatGPT, then press Send yourself. Capturing a screenshot can upload it to ChatGPT before you send the message; inserting text also exposes it to the ChatGPT page. Clearing Context only removes Dichrome’s local copy.

If ChatGPT gets stuck loading, asks for verification, or repeatedly reloads, use **Try again** or choose **Open ChatGPT window** from the sidebar’s options menu. Dichrome stops repeated reloads and keeps your captured context available to copy. ChatGPT’s sign-in and embedding restrictions can still prevent the sidebar from connecting.

## Two modes

Fresh installs use **Mode 2 – ChatGPT Sidebar**, the workflow described above. Existing installs with saved original-mode settings may keep Mode 1 after an update.

**Mode 1 – Original Dichrome Beta** provides the original automation workflow. It sends prompts through a hidden ChatGPT page and streams responses into Dichrome’s own interface. It also supports file attachments, project routing, model selection, follow-up messages, and project conversation history.

Mode 1 is an early beta. It depends on ChatGPT’s page structure and browser support for hidden frames, so changes to ChatGPT can break it. Unlike Mode 2, choosing a selection action in Mode 1 can send the prepared prompt automatically.

To switch modes, open **··· → Mode settings**. Switching to Mode 1 requires acknowledging the beta notice. An active Mode 1 request must finish or be cancelled before switching away.

## Permissions and data

Dichrome runs as a browser extension and has no developer-operated server or analytics. Prompts, screenshots, and attachments you insert, upload, or send are handled by ChatGPT under your account.

The extension requests all-sites access for selected-text actions and visible-tab screenshots, ChatGPT access for its page integration, and permissions for the side panel, storage, clipboard copying, companion windows, and hidden automation. It uses browser network rules to allow ChatGPT to load in extension frames. Settings and the last ChatGPT URL are stored locally; captured context and recent request state use browser session storage when available, with local storage as a fallback.

See the [privacy policy draft](docs/privacy-policy.md) for the full data and permissions description. Browser-internal pages, the Chrome Web Store, and other restricted pages may block selection or screenshot features.

## Development

The runtime is plain JavaScript using Chrome Manifest V3. Node.js is needed for the validation and packaging scripts.

Run the static checks and unit tests without installing dependencies:

```bash
npm run check
npm test
```

For browser regression tests, install the development dependencies and Playwright’s Chromium build:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

The browser tests load the real extension with controlled webpage and ChatGPT fixtures. They check selection actions, prompt insertion, draft protection, screenshots, context controls, layouts, and frame recovery. They don’t sign in to ChatGPT or send messages. Use the [manual smoke tests](docs/manual-smoke-tests.md) to check behavior with a real account.

Create an extension ZIP with:

```bash
npm run package
```

The output is `.dist/chrome/dichrome-<version>-chrome.zip`. Regenerate icons with `npm run icons` after changing the icon source or generator.

### Repository layout

| Directory | Purpose |
| --- | --- |
| `background/` | Browser events, context menus, screenshot capture, mode routing, and request orchestration. |
| `content/` | Webpage selection controls and ChatGPT page integrations. |
| `sidepanel/` | The mode switcher, default ChatGPT sidebar, and original beta interface. |
| `offscreen/` | The hidden ChatGPT host used by Mode 1. |
| `shared/` | Message contracts, settings helpers, and response formatting. |
| `scripts/` | Validation, unit tests, browser tests, icon generation, and packaging. |
| `docs/` | Setup guides, architecture notes, manual checks, and store submission material. |

For more detail, see [setup and usage](docs/setup-and-usage.md), the [architecture overview](docs/architecture.md), and the [module map](docs/module-map.md).

## License

See [LICENSE](LICENSE).
