# Dichrome Privacy Policy Draft

Effective date: May 21, 2026

This draft is intended to be published at the privacy policy URL used in the Chrome Web Store Developer Dashboard. Keep the published copy in sync with the extension behavior before submitting a build.

## Summary

Dichrome routes user-selected webpage text, user-entered prompts, optional attachments, and visible-tab screenshots into the user's signed-in ChatGPT workspace through the ChatGPT web interface. Dichrome does not run a hosted backend, does not use the OpenAI API, does not sell data, and does not include advertising or analytics.

## Data handled by the extension

Dichrome may handle the following data when the user invokes a feature:

- Selected text from the active webpage, when the user chooses a Dichrome context-menu action or uses selected text in the side panel.
- Text typed by the user into the side-panel composer.
- Files selected by the user for attachment, including image previews and file metadata such as name, MIME type, and size.
- Visible-tab screenshots when the user presses the screenshot attachment control and Chrome grants capture access for the active tab.
- ChatGPT response text and response metadata needed to display request status in the side panel.
- Extension settings, including ChatGPT project-routing settings, model label preference, and the hidden workspace session summary.
- Short-lived request history and internal events needed to show recent side-panel state and troubleshoot failed automation.

## How data is used

Dichrome uses this data only to provide the user-requested assistant workflow:

- Build prompts from selected text, typed instructions, and user-selected attachments.
- Insert prompts into ChatGPT using the user's existing ChatGPT browser session.
- Display ChatGPT responses and request status in the extension side panel.
- Route requests to the configured ChatGPT project or existing conversation when the user has enabled those settings.
- Open ChatGPT for authentication/setup only when the user chooses the sign-in handoff.

## Data sharing

Dichrome shares prompt content and attachments with ChatGPT only when the user sends a request. ChatGPT processing is governed by the user's account relationship with ChatGPT/OpenAI.

Dichrome does not send user data to a developer-operated server.

## Storage and retention

Automation settings are stored in Chrome extension local storage. Request state, recent request history, and attachment payloads are stored in Chrome extension session storage when available, with local storage used only as a browser fallback. Recent request history is bounded by the extension's configured history limit.

Users can clear stored extension data by removing the extension or clearing the extension's site/app data in Chrome.

## Permissions

Dichrome requests Chrome permissions only for the extension's assistant-routing workflow. Permission details and Chrome Web Store reviewer notes are maintained in `docs/chrome-web-store-submission.md`.

## Contact

Before publishing, replace this section with the support contact or support URL used for the Chrome Web Store listing.
