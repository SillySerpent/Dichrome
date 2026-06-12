import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shellHtml = await readFile(new URL("../sidepanel/sidepanel.html", import.meta.url), "utf8");
const shellSource = await readFile(new URL("../sidepanel/shell.js", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../background/runtime/app.js", import.meta.url), "utf8");
const mode2ControllerSource = await readFile(new URL("../background/mode2/companion-controller.js", import.meta.url), "utf8");
const mode2Html = await readFile(new URL("../sidepanel/mode2/sidepanel.html", import.meta.url), "utf8");
const mode2Source = await readFile(new URL("../sidepanel/mode2/sidepanel.js", import.meta.url), "utf8");
const frameThemeSource = await readFile(new URL("../content/mode2/chatgpt-frame-theme.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

assert.match(shellHtml, /id="modeFrame"/, "root side panel must render the mode iframe");
assert.match(shellHtml, /Original Dichrome \(Mode 1\) is an early beta\./, "mode shell must include the Mode 1 beta warning");
assert.match(shellSource, /mode2\/sidepanel\.html/, "mode shell must load Mode 2 by iframe source");
assert.match(shellSource, /mode1\.html/, "mode shell must load Mode 1 by iframe source");
assert.match(shellSource, /MODE_MESSAGES\.SET_ACTIVE_MODE/, "mode shell must persist mode switches through the background");
assert.match(shellSource, /cancelActiveRequest/, "mode shell must expose active request cancellation when switching away");
assert.match(backgroundSource, /handleShortcutCommand\(command, tab\)/, "background shortcuts must route through active-mode command handling");
assert.match(backgroundSource, /contextMenuController\.handleScreenshotAction\(sourceTab, "keyboard-shortcut"\)/, "Mode 1 screenshot shortcuts must reuse shared screenshot routing");
assert.match(backgroundSource, /requestController\.cancelRequest\(session\.activeRequestId\);/, "switching away from an active Mode 1 request must await cancellation");
assert.doesNotMatch(backgroundSource, /cancelRequest\(session\.activeRequestId\)\.catch/, "Mode 1 cancellation failures must not be swallowed during mode switches");
assert.match(mode2Html, /<iframe[\s\S]*id="chatGptFrame"/, "Mode 2 must keep the embedded ChatGPT frame");
assert.match(mode2Html, /id="captureScreenshot"/, "Mode 2 must keep a screenshot button");
assert.match(mode2Source, /dichrome\.mode2\.chatGptFrameUrl/, "Mode 2 frame URL storage must be namespaced");
assert.match(mode2Source, /dichrome\.mode2\.latestPrompt/, "Mode 2 prompt storage must be namespaced");
assert.match(mode2ControllerSource, /BACKGROUND_MESSAGE_TYPES/, "Mode 2 controller must distinguish background messages from content-only messages");
assert.match(frameThemeSource, /dichrome\.mode2\.chatGptFrameUrl/, "Mode 2 frame theme must persist namespaced frame URL state");

const selectionScript = manifest.content_scripts.find((script) => {
  return script.js?.includes("content/shared/selection-popover.js");
});
const mode2ThemeScript = manifest.content_scripts.find((script) => {
  return script.js?.includes("content/mode2/chatgpt-frame-theme.js");
});

assert.ok(selectionScript, "manifest must register the shared selection popover");
assert.deepEqual(selectionScript.matches, ["<all_urls>"], "shared selection popover should be available on normal webpages");
assert.equal(selectionScript.run_at, "document_idle");
assert.ok(mode2ThemeScript, "manifest must register the Mode 2 ChatGPT frame theme");
assert.equal(mode2ThemeScript.all_frames, true, "Mode 2 frame theme must run in embedded ChatGPT frames");
assert.ok(manifest.permissions.includes("clipboardWrite"), "Mode 2 copy controls require clipboardWrite");
assert.ok(manifest.permissions.includes("windows"), "Mode 2 fallback window requires windows permission");

console.log("Mode shell tests passed.");
