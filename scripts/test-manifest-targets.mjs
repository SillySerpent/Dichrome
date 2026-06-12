import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PACKAGE_TARGETS,
  buildTargetManifest,
  normalizePackageTarget
} from "./manifest-targets.mjs";

const baseManifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const chromeManifest = buildTargetManifest(baseManifest, "chrome");

assert.deepEqual(PACKAGE_TARGETS, ["chrome"]);
assert.equal(chromeManifest.background.service_worker, "background/service-worker.js");
assert.equal(chromeManifest.side_panel.default_path, "sidepanel/sidepanel.html");
assert.ok(chromeManifest.permissions.includes("offscreen"));
assert.ok(chromeManifest.permissions.includes("sidePanel"));
assert.equal(chromeManifest.commands["toggle-dichrome-side-panel"].suggested_key, "Alt+Shift+D");
assert.throws(() => normalizePackageTarget("unsupported-browser"), /Unsupported package target: unsupported-browser/);
assert.throws(() => buildTargetManifest(baseManifest, "unsupported-browser"), /Unsupported package target: unsupported-browser/);

console.log("Manifest target tests passed.");
