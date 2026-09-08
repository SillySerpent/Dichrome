# Sidebar improvements and verification

Date: 2026-09-08

Scope: the current ChatGPT sidebar (Mode 2), its shared selection popover, and the browser event handoff that opens it. The original Mode 1 beta implementation was not redesigned. The downloaded source matched `SillySerpent/Dichrome` at `cd92186d68e3d6ffcc980f8730f86a98ba264ce7`; the `improve-sidebar` branch starts from that upstream commit.

## Behavior changes

- The selection popover builds its controls once and keeps them stable through selection events and slow mouse clicks. Ask, Summarize, and Explain are immediately available; Rewrite, Define, and Screenshot are under the more-actions button. The default toolbar is under 250px wide and 38px high in Chromium at the tested default zoom.
- The browser event handler opens the native side panel before awaiting mode lookup or storage. This preserves the user gesture required by Chrome. If opening fails after context has been saved, the popover explains how to open Dichrome manually. Extension reload failures ask the user to refresh the source page.
- The sidebar has a responsive header, a scrollable Context drawer, and a status footer that reserves its own space. Reload ChatGPT, Open ChatGPT window, and Mode settings are in the options menu.
- Selected text has a source link and an editable prompt. Insert into ChatGPT checks the receiving frame and acknowledgment, refuses to overwrite an existing draft, and leaves Send to the user. Copy and Clear text remain available. Edits survive panel reloads within the browser session.
- Screenshot previews retain Attach image, Copy image, Save, and Clear image controls. Recent captures wait for the frame to become ready. A newer capture arriving during an upload is queued and receives its own acknowledgment. Successful uploads are remembered across panel reloads to prevent automatic reattachment of the same image.
- Each replacement iframe document must finish loading and answer a composer handshake before the sidebar reports Connected. Slow or unavailable frames show retry/window recovery controls while retaining local context. Pending frame requests are cancelled on reload.
- Frame appearance uses consistent dark surfaces without changing the account's saved theme. Theme/navigation code and composer interaction code now have separate files. Top-level ChatGPT tabs are excluded from the Mode 2 bridge.

## Verification

Run the static and unit checks:

```bash
npm run check
npm test
```

The unit runner contains 44 suites. Added coverage checks selected-text persistence and truncation, synchronous panel opening, rejected panel opening, frame origin/source validation, request correlation, URL allowlisting, timeouts, and cancellation.

Run browser checks:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

The twelve Chromium scenarios load the actual unpacked extension in a temporary browser profile:

1. Compact popover geometry, the slow-click regression, saved selection, and successful native-panel opening feedback.
2. Layouts at 280, 320, 360, and 480px; no horizontal overflow or header/frame overlap; edited prompt persistence through storage changes and reload.
3. A real source-page screenshot through the popover, source URL verification, upload acceptance, no duplicate upload from notice changes, download, and persistent clearing.
4. Unavailable/sign-in frame recovery while context remains copyable.
5. Textarea prompt insertion, existing-draft protection, no automatic Send, and persisted clearing.
6. A delayed replacement document cannot inherit Connected status from the previous page.
7. A second capture queues behind an outstanding upload and records the correct acknowledgment.
8. Contenteditable insertion retains rendered multiline text and does not submit.
9. The production root shell at 280px, its Mode 2 menu-to-settings handoff, and Escape dismissal.
10. Ordinary composer/body clicks do not throw null-target errors, and frame messages produce no origin errors.
11. A sandboxed ChatGPT document with an opaque origin does not install main-world capture or publish messages.
12. Navigation from the legacy ChatGPT host uses the live destination document's announced origin for prompt insertion.

Every browser scenario also checks for uncaught page errors and postMessage origin errors.

The popup click, delayed reload, and overlapping screenshot regressions were observed failing before their fixes and passing afterward. An independent code review found the two race conditions; follow-up review confirmed their fixes without further high or medium severity findings.

The browser suite uses controlled source-page and ChatGPT documents. It exercises extension APIs and the actual packaged composer adapter, but does not sign into ChatGPT, send messages, or prove compatibility with a particular live account's current UI. Check sign-in, model/work navigation, and attachment behavior in the intended browser account using [manual smoke tests](manual-smoke-tests.md).

Generate the installable Chrome archive:

```bash
npm run package:chrome
```

Output: `.dist/chrome/dichrome-0.1.0-chrome.zip`. The same current source directory can be loaded unpacked. After reloading the extension at `chrome://extensions`, refresh existing source pages so they receive the updated popover script, then reopen the sidebar.

## Runtime error follow-up

The reported duplicate menu ID, null link target, and opaque-origin postMessage errors were reproduced with regression tests. Context-menu creation now shares one in-flight rebuild across overlapping install/startup calls, checks both removal and creation failures, and permits retry after failure. The embedded link handler ignores non-link clicks and empty URL values.

Main-world response capture checks the effective window origin before installation and each publication, skipping opaque or detached documents. Sidebar messaging waits for an allowed frame document to announce its identity. Requests go once to that verified origin and require the same document ID in the reply; explicit reload and document unload invalidate pending work. Origins remain allowlisted, with no wildcard targets or null-origin acceptance.

The first UI verification did not assert on uncaught browser errors. The new browser assertions cover that gap. Unit tests also exercise menu setup concurrency and recovery, origin handshakes, unmatched unload notices, and navigation cancellation.

## Commit accounting

Within each development batch, every modified or created file receives its own local commit, with a file-specific message and no tool-authorship attribution. The commit inventory is the union of tracked changes and untracked source files; dependencies, browser artifacts, and generated packages are ignored. Compare against the upstream baseline:

```bash
git diff --name-only origin/master...HEAD
git rev-list --count origin/master..HEAD
git log --format='%h %s' origin/master..HEAD
git status --short
```

No remote push is part of this change.
