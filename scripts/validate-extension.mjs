import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "background/constants.js",
  "background/automation-settings.js",
  "background/automation/focus-emulation.js",
  "background/automation/offscreen-target.js",
  "background/automation/source-focus.js",
  "background/automation/session.js",
  "background/automation/settings.js",
  "background/automation/tab-target.js",
  "background/debug-dump.js",
  "background/focus-emulation.js",
  "background/requests/store.js",
  "background/state-machine.js",
  "background/adapter-repair.js",
  "content/chatgpt-automation.js",
  "content/chatgpt/00-namespace.js",
  "content/chatgpt/90-bootstrap.js",
  "offscreen/automation-host.html",
  "offscreen/automation-host.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "assets/icon.svg",
  "scripts/test.mjs",
  "scripts/test-automation-session.mjs",
  "scripts/test-request-records.mjs",
  "scripts/test-settings.mjs",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js"
];
const javascriptFiles = requiredFiles.filter((file) => file.endsWith(".js"));
const moduleScriptFiles = [
  ...javascriptFiles,
  "scripts/validate-extension.mjs",
  "scripts/generate-icons.mjs",
  "scripts/test-settings.mjs"
];

await validateManifest();
await validateFilesExist();
await validatePngFiles();
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
  assert(manifest.icons?.["128"] === "icons/icon-128.png", "manifest 128px icon path is wrong.");
  assert(manifest.action?.default_icon?.["32"] === "icons/icon-32.png", "action 32px icon path is wrong.");

  const permissions = new Set(manifest.permissions || []);

  for (const permission of ["activeTab", "contextMenus", "debugger", "offscreen", "scripting", "sidePanel", "storage", "tabs", "windows"]) {
    assert(permissions.has(permission), `Missing permission: ${permission}`);
  }

  const hostPermissions = new Set(manifest.host_permissions || []);

  assert(hostPermissions.has("https://chatgpt.com/*"), "Missing chatgpt.com host permission.");
  assert(hostPermissions.has("https://chat.openai.com/*"), "Missing chat.openai.com host permission.");
  assert(
    manifest.content_security_policy?.extension_pages?.includes("frame-src https://chatgpt.com https://chat.openai.com"),
    "Extension CSP must allow ChatGPT offscreen iframe probe hosts."
  );
}

async function validateFilesExist() {
  for (const file of requiredFiles) {
    await readFile(join(root, file), "utf8");
  }
}

async function validatePngFiles() {
  for (const file of ["icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"]) {
    const bytes = await readFile(join(root, file));
    const signature = bytes.subarray(0, 8).toString("hex");

    assert(signature === "89504e470d0a1a0a", `${file} is not a valid PNG file.`);
  }
}

function validateJavaScriptSyntax() {
  for (const file of moduleScriptFiles) {
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
