import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { CHATGPT_CONTENT_SCRIPT_FILES } from "../shared/contracts.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "background/constants.js",
  "background/runtime/app.js",
  "background/runtime/context-menu.js",
  "background/runtime/message-router.js",
  "background/runtime/request-controller.js",
  "background/runtime/settings-repository.js",
  "background/debug/debug-dump-collector.js",
  "background/automation/offscreen-target.js",
  "background/automation/offscreen-frame-policy.js",
  "background/automation/source-focus.js",
  "background/automation/session.js",
  "background/automation/settings.js",
  "background/automation/tab-target.js",
  "background/debug-dump.js",
  "background/focus-emulation.js",
  "background/requests/store.js",
  "background/state-machine.js",
  "background/adapter-repair.js",
  "content/chatgpt/00-namespace.js",
  "content/chatgpt/runtime/contracts.js",
  "content/chatgpt/runtime/messaging/messages.js",
  "content/chatgpt/runtime/url/chatgpt-url.js",
  "content/chatgpt/runtime/errors/errors.js",
  "content/chatgpt/runtime/dom/utils.js",
  "content/chatgpt/runtime/async/wait.js",
  "content/chatgpt/runtime/adapter/options.js",
  "content/chatgpt/runtime/adapter/scoring.js",
  "content/chatgpt/runtime/adapter/base.js",
  "content/chatgpt/runtime/adapter/project-routing.js",
  "content/chatgpt/runtime/adapter/conversation.js",
  "content/chatgpt/runtime/adapter/model-selection.js",
  "content/chatgpt/runtime/adapter/composer-controls.js",
  "content/chatgpt/runtime/adapter/assistant-response.js",
  "content/chatgpt/runtime/response/extraction.js",
  "content/chatgpt/runtime/network/capture-client.js",
  "content/chatgpt/runtime/offscreen/bridge.js",
  "content/chatgpt/runtime/page/visibility.js",
  "content/chatgpt/runtime/debug/dump.js",
  "content/chatgpt/runtime/response/observer.js",
  "content/chatgpt/runtime/runner/automation-runner.js",
  "content/chatgpt/runtime/app.js",
  "content/chatgpt/90-bootstrap.js",
  "content/chatgpt/main-world-capture.js",
  "docs/hidden-internal-invariants.md",
  "docs/manual-smoke-tests.md",
  "docs/module-map.md",
  "offscreen/automation-host.html",
  "offscreen/automation-host.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "assets/icon.svg",
  "scripts/test.mjs",
  "scripts/test-offscreen-frame-policy.mjs",
  "scripts/test-offscreen-target.mjs",
  "scripts/test-automation-session.mjs",
  "scripts/test-request-records.mjs",
  "scripts/test-settings.mjs",
  "scripts/test-content-runtime-url.mjs",
  "scripts/test-content-response-extraction.mjs",
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-sidepanel-layout-css.mjs",
  "scripts/test-contracts.mjs",
  "scripts/test-response-formatting.mjs",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js",
  "sidepanel/runtime/app.js",
  "sidepanel/runtime/client.js",
  "sidepanel/runtime/dom.js",
  "sidepanel/runtime/response-animation.js",
  "sidepanel/runtime/response-view.js",
  "sidepanel/runtime/state.js",
  "shared/contracts.js",
  "shared/response-formatting.js"
];
const javascriptFiles = requiredFiles.filter((file) => file.endsWith(".js"));
const moduleScriptFiles = [
  ...javascriptFiles,
  "scripts/validate-extension.mjs",
  "scripts/generate-icons.mjs",
  "scripts/test-settings.mjs",
  "scripts/test-content-runtime-url.mjs",
  "scripts/test-content-response-extraction.mjs",
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-sidepanel-layout-css.mjs",
  "scripts/test-offscreen-frame-policy.mjs",
  "scripts/test-offscreen-target.mjs",
  "scripts/test-automation-session.mjs",
  "scripts/test-request-records.mjs",
  "scripts/test-contracts.mjs",
  "scripts/test-response-formatting.mjs"
];

await validateManifest();
await validateFilesExist();
await validateLayeredContentRuntime();
await validatePngFiles();
validateJavaScriptSyntax();

console.log("Extension validation passed.");

async function validateManifest() {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(manifest.manifest_version === 3, "manifest_version must be 3.");
  assert(manifest.name === "Dichrome", "manifest name must match the extension brand.");
  assert(manifest.action?.default_title === "Open Dichrome", "action title must match the extension brand.");
  assert(Number(manifest.minimum_chrome_version) >= 116, "minimum_chrome_version must be 116 or newer for sidePanel.open.");
  assert(manifest.background?.service_worker === "background/service-worker.js", "background service worker path is wrong.");
  assert(manifest.background?.type === "module", "background service worker must be an ES module.");
  assert(manifest.side_panel?.default_path === "sidepanel/sidepanel.html", "side panel path is wrong.");
  assert(manifest.icons?.["128"] === "icons/icon-128.png", "manifest 128px icon path is wrong.");
  assert(manifest.action?.default_icon?.["32"] === "icons/icon-32.png", "action 32px icon path is wrong.");
  assert(Array.isArray(manifest.content_scripts), "Missing ChatGPT content script registration.");
  const chatGptContentScript = manifest.content_scripts.find((script) => {
    return script.matches?.includes("https://chatgpt.com/*") && script.matches?.includes("https://chat.openai.com/*");
  });
  assert(chatGptContentScript, "Missing ChatGPT content script matches.");
  assert(chatGptContentScript.all_frames === true, "ChatGPT content script must run in all frames for offscreen iframe probing.");
  assert(chatGptContentScript.run_at === "document_start", "ChatGPT content script must connect the offscreen iframe bridge at document_start.");
  assert(
    JSON.stringify(chatGptContentScript.js) === JSON.stringify(CHATGPT_CONTENT_SCRIPT_FILES),
    "ChatGPT content script order must match shared contract order."
  );

  const webAccessibleResources = manifest.web_accessible_resources || [];
  const chatGptCaptureResource = webAccessibleResources.find((resource) => {
    return resource.resources?.includes("content/chatgpt/main-world-capture.js")
      && resource.matches?.includes("https://chatgpt.com/*")
      && resource.matches?.includes("https://chat.openai.com/*");
  });

  assert(chatGptCaptureResource, "Main-world ChatGPT stream capture script must be exposed to ChatGPT pages.");

  const permissions = new Set(manifest.permissions || []);

  for (const permission of ["activeTab", "contextMenus", "debugger", "declarativeNetRequestWithHostAccess", "offscreen", "scripting", "sidePanel", "storage", "tabs", "windows"]) {
    assert(permissions.has(permission), `Missing permission: ${permission}`);
  }

  const hostPermissions = new Set(manifest.host_permissions || []);
  const optionalHostPermissions = manifest.optional_host_permissions || [];
  const redundantOptionalHostPermissions = optionalHostPermissions.filter((optionalHostPermission) => {
    return Array.from(hostPermissions).some((hostPermission) => {
      return hostPermission === optionalHostPermission || hostPermission === "<all_urls>";
    });
  });

  assert(hostPermissions.has("https://chatgpt.com/*"), "Missing chatgpt.com host permission.");
  assert(hostPermissions.has("https://chat.openai.com/*"), "Missing chat.openai.com host permission.");
  assert(optionalHostPermissions.includes("<all_urls>"), "Visible screenshot capture must declare optional <all_urls> host access.");
  assert(
    redundantOptionalHostPermissions.length === 0,
    `Optional host permissions must not duplicate required host access: ${redundantOptionalHostPermissions.join(", ")}`
  );
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

async function validateLayeredContentRuntime() {
  const allowedFlatRuntimeFiles = new Set(["app.js", "contracts.js"]);
  const entries = await readdir(join(root, "content/chatgpt/runtime"), {
    withFileTypes: true
  });
  const flatRuntimeFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && !allowedFlatRuntimeFiles.has(entry.name))
    .map((entry) => entry.name);

  assert(
    flatRuntimeFiles.length === 0,
    `Content runtime helpers must live in layered subdirectories, not flat runtime files: ${flatRuntimeFiles.join(", ")}`
  );
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
