import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "sidepanel/sidepanel.css"), "utf8");
const app = await readFile(join(root, "sidepanel/runtime/app.js"), "utf8");
const html = await readFile(join(root, "sidepanel/sidepanel.html"), "utf8");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const iconSvg = await readFile(join(root, "assets/icon.svg"), "utf8");

assertRuleIncludes(".composer-panel", ["min-width: 0", "overflow: hidden"]);
assertRuleIncludes(".composer-box", ["grid-template-columns: minmax(0, 1fr)", "overflow: hidden"]);
assertRuleIncludes(".composer-actions", ["display: grid", "grid-template-columns: auto minmax(0, 1fr)"]);
assertRuleIncludes(".composer-left-actions", ["justify-self: start", "flex-wrap: nowrap"]);
assertRuleIncludes(".composer-right-actions", ["justify-self: end", "flex-wrap: nowrap"]);
assertRuleIncludes(".composer-model-control select", ["width: clamp(88px, 26vw, 124px)", "max-width: 124px"]);
assertRuleIncludes(".send-button", ["width: 36px", "min-width: 34px"]);
assertRuleIncludes(".composer-panel.is-collapsed", ["padding: 6px 8px"]);
assertRuleIncludes(".composer-panel.is-collapsed .composer-box", ["grid-template-columns: minmax(0, 1fr) auto"]);
assertRuleIncludes(".composer-panel.is-collapsed textarea", ["max-height: 30px", "resize: none"]);
assertRuleIncludes(".attachments-tray", ["width: 100%", "overflow-x: hidden"]);
assertRuleIncludes(".attachment-chip", ["width: 100%", "flex: 0 1 100%", "contain: layout paint"]);
assertRuleIncludes(".request-actions", ["display: grid", "grid-template-columns: auto auto auto minmax(0, 1fr)"]);
assertRuleIncludes(".request-actions .status-line", ["min-width: 0", "text-align: right"]);
assertRuleIncludes(".response-copy-wrapper", ["display: grid"]);
assertRuleIncludes(".response-copy-wrapper", ["position: relative"]);
assertRuleIncludes(".response-copy-toolbar", ["position: absolute", "justify-content: flex-end", "opacity: 0", "pointer-events: none", "user-select: none"]);
assertRuleIncludes(".response-copy-wrapper:hover .response-copy-toolbar,\n.response-copy-wrapper:focus-within .response-copy-toolbar", ["opacity: 1", "pointer-events: auto"]);
assertRuleIncludes(".response-copy-button", ["user-select: none"]);
assertRuleIncludes(".response-content .writing-block", ["display: grid", "background: var(--surface-soft)"]);
assertRuleIncludes(".response-content .task-list", ["list-style: none"]);
assertRuleIncludes(".response-content .math-environment", ["display: inline-flex"]);
assertRuleIncludes(".response-content .math-row", ["display: inline-flex"]);

const copyToolbarRule = findRule(".response-copy-toolbar");
assert(copyToolbarRule.includes("transform: translateY(-2px)"), "Copy toolbar must stay hidden until the block is hovered or focused.");

assert(
  app.includes("image.width = 34;") && app.includes("image.height = 30;"),
  "Attachment previews must declare fixed image dimensions before assigning src."
);
assert(
  app.includes('image.decoding = "sync";') && app.includes('image.loading = "eager";'),
  "Attachment previews must avoid deferred first-paint sizing."
);
assert(
  app.includes("let composerReadingMode = true;") && app.includes("function markReaderInterest()"),
  "Composer collapse must be controlled by read/write intent state."
);
assert(
  manifest.name === "Dichrome" && manifest.action?.default_title === "Open Dichrome",
  "Extension-facing branding must use Dichrome."
);
assert(
  html.includes("<title>Dichrome</title>") && html.includes("<h1>Dichrome</h1>"),
  "Side panel title must use Dichrome."
);
assert(
  html.includes('class="visually-hidden">Mode</span>') && html.includes('aria-label="Mode"'),
  "Mode control must keep an accessible label without taking visible row space."
);
assert(
  !/(ChatGPT Relay|Message ChatGPT|Open ChatGPT|ChatGPT routing|Focus ChatGPT|GPT)/.test(html),
  "Side panel visible text must not reference GPT branding."
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
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));

  assert(match, `Missing CSS rule for ${selector}.`);
  return match[1].replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
