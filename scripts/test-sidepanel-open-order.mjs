import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../background/runtime/app.js", import.meta.url), "utf8");
const listenerMatch = source.match(/chrome\.action\.onClicked\.addListener\(\(tab\) => \{([\s\S]*?)\n\}\);/);

assert.ok(listenerMatch, "Toolbar action click listener must be present.");

const listenerBody = listenerMatch[1];
const openIndex = listenerBody.indexOf("openSidePanel(tab?.id)");
const rememberIndex = listenerBody.indexOf("rememberSourceTab(tab)");

assert.ok(openIndex >= 0, "Toolbar click listener must open the side panel.");
assert.ok(rememberIndex >= 0, "Toolbar click listener must remember the source tab.");
assert.ok(openIndex < rememberIndex, "Toolbar click must call sidePanel.open before source-tab persistence to preserve Chrome's user gesture.");
assert.equal(/await\s+rememberSourceTab/.test(listenerBody), false, "Toolbar click listener must not await source-tab persistence before opening the panel.");

console.log("Side panel open order tests passed.");
