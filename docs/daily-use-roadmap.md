# Daily-use feature recommendations

Reviewed against the local checkout on 2026-09-14. These are proposed additions, not implemented features. The accompanying implementation changes only the Mode 2 Context drawer interaction.

## What is already here

The default Mode 2 includes selected-text actions, visible-page screenshots, editable local prompts, source links, insertion that protects an existing ChatGPT draft, screenshot upload acknowledgments, copy/save fallbacks, session persistence, and recovery controls. ChatGPT provides its own conversation interface inside the frame. Mode 1 has separate beta automation and project-history functionality; its existence does not mean those controls are available in the Mode 2 companion.

The strongest additions would reduce the repeated work between capturing information and preparing a useful question.

| Priority | Proposed feature | Current gap and daily benefit | Relative scope |
| --- | --- | --- | --- |
| 1 | Collect multiple snippets | Each text capture replaces `latestPrompt`. Let users collect, reorder, remove, and combine excerpts from several pages, retaining each source URL. Useful for comparing documentation, articles, and products. | Medium–large |
| 2 | Append to the current draft | Insertion currently refuses a different non-empty ChatGPT draft. An explicit **Append context** action would preserve the question already being written and add the reviewed material below it. Keep normal insertion protective and never press Send. | Medium |
| 3 | Custom prompt actions | Ask, Summarize, Explain, Rewrite, and Define are fixed. Let users save actions such as “Extract action items”, “Explain this code”, “Translate to …”, or “Draft a concise reply”, with favorite actions in the selection toolbar. | Medium |
| 4 | Crop and redact screenshots before attachment | Capture currently saves the whole visible viewport and automatically attempts attachment. A review option could crop to an error or chart and cover sensitive regions before any upload begins. | Medium–large |
| 5 | Website-specific selection-popup controls | The selection popover currently runs on normal matching pages without a per-site preference. Add “Disable on this site” and an option to use only shortcuts/right-click actions. Useful on editors and frequently visited pages where a popup interrupts work. | Small–medium |
| 6 | Pin useful context and undo replacement/clear | Current context is transient, with one latest text and image record and no undo. Offer explicit local saving, names, search, and deletion for material users choose to keep; retain temporary storage for ordinary captures. | Medium |
| 7 | Continue the same conversation in a window | The sidebar persists its frame URL, but the fallback window opens the ChatGPT home URL or focuses its existing window. Add a distinct action to open the current conversation, making the destination clear and preserving unsent text through an explicit copy/transfer step. | Medium |

I would start with custom actions for a smaller improvement, then an explicit append operation, then the multi-snippet collection. Multi-snippet collection has the highest research value but changes storage and prompt composition more substantially.

## Implementation boundaries

- **Captured records and fixed actions:** [background/mode2/companion-controller.js](../background/mode2/companion-controller.js) owns prompt construction, the latest text/image records, shortcuts, and the fallback window. Multi-snippet support needs a bounded collection, source provenance, migration of existing records, and deliberate replacement/clear semantics.
- **Review and persistence:** [sidepanel/mode2/context-controller.js](../sidepanel/mode2/context-controller.js) owns editable drafts, source display, actions, and image queuing. Saved context should use a separate explicit local collection rather than silently making all captures durable. Chrome clears `storage.session` on restart, extension reload, disable, or update; pinned items require a separate persistence decision. See [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).
- **Draft insertion:** [content/mode2/composer-bridge.js](../content/mode2/composer-bridge.js) protects non-empty drafts and verifies insertion. Append must handle both textarea and contenteditable composers, detect changes while a request is in flight, and acknowledge the combined result without submitting it.
- **Screenshot review:** The current controller automatically calls `attachRecentImage` when a recent screenshot is available and the frame is ready. A crop/redaction workflow must defer that path until review is complete; merely adding an editor after capture would allow the original image to reach ChatGPT first.
- **Selection actions and site preferences:** [content/shared/selection-popover.js](../content/shared/selection-popover.js) owns popup behavior; [background/runtime/context-menu.js](../background/runtime/context-menu.js) and the Mode 2 controller own related entrypoints. Custom actions should share one validated definition across these surfaces. Disabling the popup on a site should not unexpectedly disable explicitly invoked shortcuts or right-click actions.
- **Conversation handoff:** [content/mode2/chatgpt-frame-theme.js](../content/mode2/chatgpt-frame-theme.js) persists the frame URL, and [sidepanel/mode2/frame-client.js](../sidepanel/mode2/frame-client.js) validates supported URLs. Reuse that allowlisting and make the choice between a new conversation and the current one explicit.

## Interaction change included in this update

Context opens when the mouse enters the top toolbar, stays available while the pointer is over the toolbar or drawer, and collapses after a 160 ms exit grace period. Reentering cancels the pending close. A 180 ms overlay slide and short fade soften the change without resizing the ChatGPT frame; reduced-motion preferences disable animation. Captures and storage refreshes update the drawer without opening it. Keyboard and touch activation remain available; Escape dismisses it. Keyboard navigation keeps it open while its controls are in use.

Hover content should remain reachable and dismissible, with keyboard access. These choices follow [W3C guidance on content shown on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).
