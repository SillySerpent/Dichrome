import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "background/state-machine.js",
  "background/adapter-repair.js",
  "content/chatgpt-automation.js",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js"
];
const javascriptFiles = requiredFiles.filter((file) => file.endsWith(".js"));

await validateManifest();
await validateFilesExist();
validateJavaScriptSyntax();

console.log("Extension validation passed.");

async function validateManifest() {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(manifest.manifest_version === 3, "manifest_version must be 3.");
  assert(Number(manifest.minimum_chrome_version) >= 116, "minimum_chrome_version must be 116 or newer for sidePanel.open.");
  assert(manifest.background?.service_worker === "background/service-worker.js", "background service worker path is wrong.");
  assert(manifest.background?.type === "module", "background service worker must be an ES module.");
  assert(manifest.side_panel?.default_path === "sidepanel/sidepanel.html", "side panel path is wrong.");

  const permissions = new Set(manifest.permissions || []);

  for (const permission of ["activeTab", "contextMenus", "scripting", "sidePanel", "storage", "tabs"]) {
    assert(permissions.has(permission), `Missing permission: ${permission}`);
  }

  const hostPermissions = new Set(manifest.host_permissions || []);

  assert(hostPermissions.has("https://chatgpt.com/*"), "Missing chatgpt.com host permission.");
  assert(hostPermissions.has("https://chat.openai.com/*"), "Missing chat.openai.com host permission.");
}

async function validateFilesExist() {
  for (const file of requiredFiles) {
    await readFile(join(root, file), "utf8");
  }
}

function validateJavaScriptSyntax() {
  for (const file of javascriptFiles) {
    const result = spawnSync(process.execPath, ["--check", join(root, file)], {
      encoding: "utf8"
    });

    if (result.status !== 0) {
      throw new Error(`Syntax check failed for ${file}\n${result.stderr || result.stdout}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
