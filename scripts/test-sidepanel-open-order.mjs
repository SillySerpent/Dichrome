import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background/runtime/app.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const listenerMatch = source.match(/chrome\.action\.onClicked\.addListener\(\(tab\) => \{([\s\S]*?)\n\}\);/);

assert.ok(listenerMatch, "Toolbar action click listener must be present.");

const listenerBody = listenerMatch[1];
const openIndex = listenerBody.indexOf("openSidePanel(tab?.id)");
const rememberIndex = listenerBody.indexOf("rememberSourceTab(tab)");

assert.ok(openIndex >= 0, "Toolbar click listener must open the side panel.");
assert.ok(rememberIndex >= 0, "Toolbar click listener must remember the source tab.");
assert.ok(openIndex < rememberIndex, "Toolbar click must call sidePanel.open before source-tab persistence to preserve Chrome's user gesture.");
assert.equal(/await\s+rememberSourceTab/.test(listenerBody), false, "Toolbar click listener must not await source-tab persistence before opening the panel.");

assert.equal(
  manifest.commands?.["toggle-dichrome-side-panel"]?.suggested_key,
  "Alt+Shift+D",
  "Manifest must register the side-panel toggle shortcut."
);
assert.ok(
  source.includes('const SIDE_PANEL_TOGGLE_COMMAND = "toggle-dichrome-side-panel";'),
  "Background runtime must use the manifest command id."
);
assert.ok(
  source.includes("chrome.commands?.onCommand?.addListener?."),
  "Background runtime must listen for the registered keyboard command."
);
const commandListenerMatch = source.match(/chrome\.commands\?\.onCommand\?\.addListener\?\.\(\(command, tab\) => \{([\s\S]*?)\n\}\);/);

assert.ok(commandListenerMatch, "Keyboard command listener must be present.");
assert.ok(commandListenerMatch[1].includes("shouldCloseSidePanel(tab)"), "Keyboard command must check whether the side panel is open.");
assert.ok(commandListenerMatch[1].includes("closeSidePanel(tab)"), "Keyboard command must close the side panel when close is supported.");
assert.ok(commandListenerMatch[1].includes("openSidePanel(tab?.id)"), "Keyboard command must open the side panel when it is closed.");
assert.ok(
  source.includes("chrome.sidePanel?.onOpened?.addListener?.") && source.includes("chrome.sidePanel?.onClosed?.addListener?."),
  "Background runtime must track side-panel open and close events when the browser exposes them."
);

console.log("Side panel open order tests passed.");
