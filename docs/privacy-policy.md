# Dichrome Privacy Policy Draft

Effective date: May 22, 2026

This draft is intended to be published at the privacy policy URL used in the Chrome Web Store Developer Dashboard. Keep the published copy synchronized with the exact extension build being submitted.

## Summary

Dichrome routes user-selected webpage text, user-entered prompts, optional attachments, and visible-tab screenshots into the user's signed-in ChatGPT workspace through the ChatGPT web interface. Dichrome does not run a developer-operated backend, does not use the OpenAI API, does not sell data, and does not include advertising or analytics.

## Data handled by the extension

Dichrome may handle the following data when the user invokes a feature:

- Prompts typed by the user into the side-panel composer.
- Selected text from the active webpage when the user chooses a Dichrome context-menu action or uses selected text in the side panel.
- Visible-tab screenshots when the user presses the screenshot attachment control on a normal webpage.
- Uploaded or attached files selected by the user, including image previews and file metadata such as name, MIME type, and size.
- Generated ChatGPT response text and response metadata needed to display request status, errors, and results in the side panel.
- Local extension settings, including project-routing settings, model label preference, exact-match preference, and hidden workspace session summary.
- Short-lived request state, bounded recent request history, conversation URL/key state, and internal status events needed to show recent side-panel state and recover from failed automation.
- Interaction with the user's own signed-in ChatGPT web session, including project selection, model selection, prompt insertion, attachment insertion, send-button interaction, project-history loading, and response reading.

## How data is used

Dichrome uses this data only to provide the user-requested assistant workflow:

- Build prompts from selected text, typed instructions, screenshots, and user-selected attachments.
- Insert prompts and attachments into ChatGPT using the user's existing ChatGPT browser session.
- Display ChatGPT-generated responses and request status in the extension side panel.
- Route requests to the configured ChatGPT project or existing conversation when the user has enabled those settings.
- Open ChatGPT for authentication/setup only when the user chooses the sign-in handoff.
- Show clear error messages when sign-in, project routing, model selection, hidden workspace setup, screenshot permission, or ChatGPT availability fails.

## Data sharing

Dichrome shares prompt content, selected webpage text, screenshots, and attachments with ChatGPT only when the user sends a request or asks the extension to load project/conversation information from their ChatGPT session. ChatGPT processing is governed by the user's account relationship with ChatGPT/OpenAI.

Dichrome does not send user data to a developer-operated server, does not sell user data, does not transfer user data for advertising, and does not allow humans associated with the developer to read user data through a hosted service.

## Storage and retention

Automation settings are stored in browser extension local storage. Request state, recent request history, and attachment payloads are stored in browser extension session storage when available, with local storage used only as a browser fallback. Recent request history is bounded by the extension's configured history limit.

Users can clear stored extension data by removing the extension or clearing the extension's site/app data in their browser.

## Permissions

Dichrome requests browser extension permissions only for its assistant-routing workflow. Required ChatGPT host permissions are used to interact with ChatGPT through the user's signed-in browser session. Required all-sites host access is used for user-triggered visible-tab screenshot capture on normal webpages.

Dichrome does not use all-sites host access for background browsing-history collection, analytics, advertising, or unrelated website modification.

## Security

The extension package contains the runtime code. Dichrome does not execute remote code, does not call `eval`, does not use `new Function`, and does not load remote script files.

## Limited Use statement

The use of information received from Chrome extension permissions will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

Before publishing, replace this section with the support contact or support URL used for the Chrome Web Store listing.
