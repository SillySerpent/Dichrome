import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "sidepanel/sidepanel.css"), "utf8");
const app = await readFile(join(root, "sidepanel/runtime/app.js"), "utf8");
const messageCards = await readFile(join(root, "sidepanel/runtime/message-cards.js"), "utf8");
const pendingAttachments = await readFile(join(root, "sidepanel/runtime/pending-attachments.js"), "utf8");
const shellHtml = await readFile(join(root, "sidepanel/sidepanel.html"), "utf8");
const mode1Html = await readFile(join(root, "sidepanel/mode1.html"), "utf8");
const responseView = await readFile(join(root, "sidepanel/runtime/response-view.js"), "utf8");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const iconSvg = await readFile(join(root, "assets/icon.svg"), "utf8");

assertRuleIncludes("body", ["min-width: 260px", "overflow: hidden"]);
assertRuleIncludes(".composer-panel", ["min-width: 0", "overflow: hidden"]);
assertRuleIncludes(".composer-box", ["grid-template-columns: minmax(0, 1fr)", "overflow: hidden"]);
assertRuleIncludes(".composer-actions", ["display: grid", "grid-template-columns: auto minmax(0, 1fr)"]);
assertRuleIncludes(".composer-left-actions", ["justify-self: start", "flex-wrap: nowrap", "transition:"]);
assertRuleIncludes(".composer-right-actions", ["justify-self: end", "flex-wrap: nowrap"]);
assertRuleIncludes(".composer-model-control select", ["width: clamp(88px, 26vw, 124px)", "max-width: 124px"]);
assertRuleIncludes(".send-button", ["width: 36px", "min-width: 34px"]);
assertRuleIncludes(".composer-panel.is-collapsed", ["padding: 6px 8px"]);
assertRuleIncludes(".composer-panel.is-collapsed .composer-box", ["grid-template-columns: minmax(0, 1fr) auto"]);
assertRuleIncludes(".composer-panel.is-collapsed textarea", ["max-height: 30px", "resize: none"]);
assertRuleIncludes(".composer-panel.is-collapsed .composer-left-actions,\n.composer-panel.is-collapsed .composer-model-control,\n.composer-panel.is-collapsed .attachments-tray", ["max-height: 0", "opacity: 0", "transform: translateY(4px)"]);
assertRuleIncludes(".attachments-tray", ["width: 100%", "overflow-x: hidden"]);
assertRuleIncludes(".attachment-chip", ["width: 100%", "flex: 0 1 100%", "contain: layout paint"]);
assertRuleIncludes(".request-actions", ["display: grid", "grid-template-columns: auto auto auto minmax(0, 1fr)"]);
assertRuleIncludes(".request-actions .status-line", ["min-width: 0", "text-align: right"]);
assertRuleIncludes(".history-panel", ["border-radius: 8px", "padding: 10px", "transition:"]);
assertRuleIncludes(".history-panel.is-collapsed", ["padding: 7px 10px", "gap: 0"]);
assertRuleIncludes(".history-panel.is-collapsed .history-list", ["max-height: 0", "opacity: 0", "transform: translateY(-4px)"]);
assertRuleIncludes(".history-list", ["max-height: clamp(180px, 28vh, 260px)", "scrollbar-gutter: stable", "overflow-anchor: none", "transition:"]);
assertRuleIncludes(".history-item", ["min-height: 54px", "border-radius: 8px", "grid-template-columns: minmax(0, 1fr) auto"]);
assertRuleIncludes(".response-copy-wrapper", ["display: grid"]);
assertRuleIncludes(".response-copy-wrapper", ["position: relative"]);
assertRuleIncludes(".response-copy-toolbar", ["position: absolute", "right: 18px", "justify-content: flex-end", "opacity: 0", "pointer-events: none", "user-select: none"]);
assertRuleIncludes(".response-copy-wrapper:hover .response-copy-toolbar,\n.response-copy-wrapper:focus-within .response-copy-toolbar", ["opacity: 1", "pointer-events: auto"]);
assertRuleIncludes(".response-copy-button", ["user-select: none"]);
assertRuleIncludes(".response-content h1,\n.response-content h2,\n.response-content h3,\n.response-content h4,\n.response-content h5,\n.response-content h6", ["overflow: visible", "text-overflow: clip", "white-space: normal"]);
assertRuleIncludes(".response-content pre", ["overflow-x: auto", "scrollbar-gutter: stable", "white-space: pre", "overflow-wrap: normal"]);
assertRuleIncludes(".response-content .response-copy-wrapper pre", ["padding-right: 78px"]);
assertRuleIncludes(".response-content .writing-block", ["display: grid", "background: var(--surface-soft)"]);
assertRuleIncludes(".response-content .writing-block-meta", ["flex-wrap: wrap"]);
assertRuleIncludes(".response-content .task-list", ["list-style: none"]);
assertRuleIncludes(".response-content blockquote .math", ["color: var(--text)"]);
assertRuleIncludes(".shortcut-hint", ["display: flex", "flex-wrap: wrap"]);
assertRuleIncludes(".shortcut-hint kbd", ["border: 1px solid var(--border)", "font-size: 10px"]);
assertRuleIncludes(".response-content .math-rendered", ["display: inline-block", "font-size: calc(15px * var(--math-fit-scale, 1))", "white-space: nowrap"]);
assertRuleIncludes(".response-content .math-display", ["overflow-x: auto", "overflow-y: visible", "scrollbar-gutter: stable", "contain: inline-size"]);
assertRuleIncludes(".response-content .math-display.math-fit-scrollable", ["text-align: left"]);
assertRuleIncludes(".response-content .math-accent", ["position: relative", "padding-top: 0.36em"]);
assertRuleIncludes(".response-content .math-prime", ["font-size: 0.72em", "vertical-align: super"]);
assertRuleIncludes(".response-content .math-boxed", ["display: inline-block", "border: 1px solid currentColor"]);
assertRuleIncludes(".response-content .math-environment", ["display: inline-flex", "align-items: stretch"]);
assertRuleIncludes(".response-content .math-matrix,\n.response-content .math-cases-body", ["display: inline-table", "border-spacing: 0.38em 0.12em"]);
assertRuleIncludes(".response-content .math-aligned-body,\n.response-content .math-alignedat-body,\n.response-content .math-gathered-body", ["display: inline-table", "border-spacing: 0.28em 0.18em"]);
assertRuleIncludes(".response-content .math-row", ["display: table-row"]);
assertRuleIncludes(".response-content .math-cell", ["display: table-cell", "white-space: nowrap"]);

const copyToolbarRule = findRule(".response-copy-toolbar");
assert(copyToolbarRule.includes("transform: translateY(-2px)"), "Copy toolbar must stay hidden until the block is hovered or focused.");

assert(
  pendingAttachments.includes("image.width = 34;") && pendingAttachments.includes("image.height = 30;"),
  "Attachment previews must declare fixed image dimensions before assigning src."
);
assert(
  pendingAttachments.includes('image.decoding = "sync";') && pendingAttachments.includes('image.loading = "eager";'),
  "Attachment previews must avoid deferred first-paint sizing."
);
assert(
  app.includes("let composerReadingMode = true;") && app.includes("function markReaderInterest()"),
  "Composer collapse must be controlled by read/write intent state."
);
assert(
  app.includes("let projectHistoryReadingMode = true;")
    && app.includes("function markProjectHistoryInterest()")
    && app.includes("function updateProjectHistoryCollapseState()")
    && app.includes('dom.historyPanel?.classList.toggle("is-collapsed", shouldCollapse)'),
  "Project history collapse must be controlled by the same reader/history intent state."
);
assert(
  app.includes("const chatThreadScrollState =") && app.includes("function restoreChatThreadScroll("),
  "Chat history rendering must preserve scroll position when the reader is inspecting older messages."
);
assert(
  messageCards.includes("responseView.enhanceContainer(content);"),
  "Historical assistant messages must receive the same copy controls as the active response."
);
assert(
  /document\.addEventListener\("click"[\s\S]*response-copy-button/.test(responseView),
  "Copy controls must work for response blocks outside the active streaming container."
);
assert(
  mode1Html.includes("Mac <kbd>Option</kbd><kbd>Shift</kbd><kbd>D</kbd>")
    && mode1Html.includes("Windows <kbd>Alt</kbd><kbd>Shift</kbd><kbd>D</kbd>")
    && messageCards.includes("function createShortcutHint()")
    && messageCards.includes('createKeyCap("Option")')
    && messageCards.includes('createKeyCap("Alt")'),
  "Fresh chat state must expose Mac and Windows side-panel shortcuts."
);
assert(
  responseView.includes("function fitDisplayMathBlock(")
    && responseView.includes("MIN_DISPLAY_MATH_SCALE")
    && responseView.includes("ResizeObserver")
    && responseView.includes("math-fit-scrollable"),
  "Display math must be dynamically fitted after rendering and scroll instead of clipping below the readable scale."
);
assert(
  manifest.name === "Dichrome" && manifest.action?.default_title === "Open Dichrome",
  "Extension-facing branding must use Dichrome."
);
assert(
  shellHtml.includes("<title>Dichrome</title>")
    && shellHtml.includes('id="modeFrame"')
    && shellHtml.includes('value="mode2"')
    && shellHtml.includes('value="mode1"'),
  "Side panel shell must expose the switchable mode frame."
);
assert(
  mode1Html.includes("<title>Dichrome</title>") && mode1Html.includes("<h1>Dichrome</h1>"),
  "Mode 1 side panel title must use Dichrome."
);
assert(
  mode1Html.includes('id="settingsOverlay"')
    && mode1Html.includes('Routing and model settings')
    && mode1Html.includes('aria-label="Preferred model"'),
  "Routing and model settings must live in the separate settings dialog."
);
assert(
  mode1Html.includes("Open ChatGPT to sign in"),
  "Side panel must keep a clear user-triggered ChatGPT sign-in handoff."
);
assert(
  !/(ChatGPT Relay|Message ChatGPT|ChatGPT routing|Focus ChatGPT|Routing, automation, and debug|Dump Debug|automation target|debug dump|event log)/i.test(mode1Html),
  "Side panel visible text must not expose old branding or debug/repair internals."
);
assert(iconSvg.includes("Dichrome icon"), "Source icon must use Dichrome branding.");

console.log("Side panel layout CSS tests passed.");

function assertRuleIncludes(selector, declarations) {
  const rule = findRule(selector);

  for (const declaration of declarations) {
    assert(rule.includes(declaration), `${selector} must include ${declaration}.`);
  }
}

function findRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));

  assert(match, `Missing CSS rule for ${selector}.`);
  return match[1].replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
