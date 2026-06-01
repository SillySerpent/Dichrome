import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTargetManifest } from "./manifest-targets.mjs";

const baseManifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const chromeManifest = buildTargetManifest(baseManifest, "chrome");
const firefoxManifest = buildTargetManifest(baseManifest, "firefox");

assert.equal(chromeManifest.background.service_worker, "background/service-worker.js");
assert.equal(chromeManifest.side_panel.default_path, "sidepanel/sidepanel.html");
assert.ok(chromeManifest.permissions.includes("offscreen"));
assert.ok(chromeManifest.permissions.includes("sidePanel"));
assert.equal(chromeManifest.commands["toggle-dichrome-side-panel"].suggested_key, "Alt+Shift+D");

assert.equal(firefoxManifest.background.scripts[0], "background/service-worker.js");
assert.equal(firefoxManifest.background.type, "module");
assert.equal(firefoxManifest.sidebar_action.default_panel, "sidepanel/sidepanel.html");
assert.equal(firefoxManifest.sidebar_action.default_title, "Open Dichrome");
assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "dichrome@local");
assert.equal("minimum_chrome_version" in firefoxManifest, false);
assert.equal("side_panel" in firefoxManifest, false);
assert.equal("service_worker" in firefoxManifest.background, false);
assert.equal(firefoxManifest.permissions.includes("offscreen"), false);
assert.equal(firefoxManifest.permissions.includes("sidePanel"), false);
assert.ok(firefoxManifest.permissions.includes("declarativeNetRequestWithHostAccess"));
assert.deepEqual(firefoxManifest.content_scripts, baseManifest.content_scripts);
assert.deepEqual(firefoxManifest.commands, baseManifest.commands);

console.log("Manifest target tests passed.");
