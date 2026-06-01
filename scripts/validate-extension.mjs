import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { CHATGPT_CONTENT_SCRIPT_FILES } from "../shared/contracts.js";
import { buildTargetManifest } from "./manifest-targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  ".gitignore",
  "manifest.json",
  "background/service-worker.js",
  "background/constants.js",
  "background/runtime/app.js",
  "background/runtime/conversation-run-options.js",
  "background/runtime/context-menu.js",
  "background/runtime/fresh-conversation-url.js",
  "background/runtime/message-router.js",
  "background/runtime/project-history-controller.js",
  "background/runtime/request-controller.js",
  "background/runtime/settings-repository.js",
  "background/automation/offscreen-target.js",
  "background/automation/offscreen-frame-policy.js",
  "background/automation/project-target.js",
  "background/automation/source-focus.js",
  "background/automation/session.js",
  "background/automation/settings.js",
  "background/automation/tab-target.js",
  "background/debug-dump.js",
  "background/focus-emulation.js",
  "background/requests/store.js",
  "background/state-machine.js",
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
  "content/chatgpt/runtime/history/project-history.js",
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
  "docs/setup-and-usage.md",
  "docs/chrome-web-store-submission.md",
  "docs/privacy-policy.md",
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
  "scripts/test-project-history-filtering.mjs",
  "scripts/test-project-history-controller.mjs",
  "scripts/test-project-target.mjs",
  "scripts/test-conversation-run-options.mjs",
  "scripts/test-conversation-adapter.mjs",
  "scripts/test-project-routing-adapter.mjs",
  "scripts/test-fresh-conversation-url.mjs",
  "scripts/test-request-controller-conversation-routing.mjs",
  "scripts/test-request-controller-cancel.mjs",
  "scripts/test-source-focus-screenshot.mjs",
  "scripts/test-request-controller-screenshot-source.mjs",
  "scripts/test-sidepanel-open-order.mjs",
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-composer-upload-error-detection.mjs",
  "scripts/test-composer-attachment-upload-status.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-conversation-thread.mjs",
  "scripts/test-sidepanel-attachment-limits.mjs",
  "scripts/test-sidepanel-attachments.mjs",
  "scripts/test-sidepanel-drop-content.mjs",
  "scripts/test-sidepanel-selection-context.mjs",
  "scripts/test-sidepanel-layout-css.mjs",
  "scripts/test-contracts.mjs",
  "scripts/test-response-formatting.mjs",
  "scripts/test-manifest-targets.mjs",
  "scripts/test-firefox-automation-host.mjs",
  "scripts/test-offscreen-bridge-origin.mjs",
  "scripts/package-extension.mjs",
  "scripts/manifest-targets.mjs",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js",
  "sidepanel/runtime/app.js",
  "sidepanel/runtime/attachment-limits.js",
  "sidepanel/runtime/attachments.js",
  "sidepanel/runtime/client.js",
  "sidepanel/runtime/conversation-thread.js",
  "sidepanel/runtime/dom.js",
  "sidepanel/runtime/drop-content.js",
  "sidepanel/runtime/firefox-automation-host.js",
  "sidepanel/runtime/project-history-state.js",
  "sidepanel/runtime/response-animation.js",
  "sidepanel/runtime/response-view.js",
  "sidepanel/runtime/selection-context.js",
  "sidepanel/runtime/settings-dialog.js",
  "sidepanel/runtime/state.js",
  "shared/contracts.js",
  "shared/error-messages.js",
  "shared/response-formatting.js"
];
const javascriptFiles = requiredFiles.filter((file) => file.endsWith(".js"));
const extensionRuntimeRoots = [
  "background",
  "content",
  "offscreen",
  "shared",
  "sidepanel"
];
const moduleScriptFiles = [
  ...javascriptFiles,
  "scripts/validate-extension.mjs",
  "scripts/generate-icons.mjs",
  "scripts/package-extension.mjs",
  "scripts/test-settings.mjs",
  "scripts/test-content-runtime-url.mjs",
  "scripts/test-content-response-extraction.mjs",
  "scripts/test-project-history-filtering.mjs",
  "scripts/test-project-history-controller.mjs",
  "scripts/test-project-target.mjs",
  "scripts/test-conversation-run-options.mjs",
  "scripts/test-conversation-adapter.mjs",
  "scripts/test-project-routing-adapter.mjs",
  "scripts/test-fresh-conversation-url.mjs",
  "scripts/test-request-controller-conversation-routing.mjs",
  "scripts/test-request-controller-cancel.mjs",
  "scripts/test-source-focus-screenshot.mjs",
  "scripts/test-request-controller-screenshot-source.mjs",
  "scripts/test-sidepanel-open-order.mjs",
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-composer-upload-error-detection.mjs",
  "scripts/test-composer-attachment-upload-status.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-conversation-thread.mjs",
  "scripts/test-sidepanel-attachment-limits.mjs",
  "scripts/test-sidepanel-attachments.mjs",
  "scripts/test-sidepanel-drop-content.mjs",
  "scripts/test-sidepanel-selection-context.mjs",
  "scripts/test-sidepanel-layout-css.mjs",
  "scripts/test-offscreen-frame-policy.mjs",
  "scripts/test-offscreen-target.mjs",
  "scripts/test-automation-session.mjs",
  "scripts/test-request-records.mjs",
  "scripts/test-contracts.mjs",
  "scripts/test-response-formatting.mjs",
  "scripts/manifest-targets.mjs",
  "sidepanel/runtime/firefox-automation-host.js",
  "scripts/test-manifest-targets.mjs",
  "scripts/test-firefox-automation-host.mjs",
  "scripts/test-offscreen-bridge-origin.mjs"
];

await validateManifest();
await validateFilesExist();
await validateRepositoryHygiene();
await validateLayeredContentRuntime();
await validateStoreReviewReadiness();
await validateNoUserFacingDebugControls();
await validateNoRemoteCodeExecution();
await validatePngFiles();
validateJavaScriptSyntax();

console.log("Extension validation passed.");

async function validateManifest() {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(manifest.manifest_version === 3, "manifest_version must be 3.");
  assert(manifest.name === "Dichrome", "manifest name must match the extension brand.");
  assert(typeof manifest.description === "string" && manifest.description.trim(), "manifest description is required.");
  assert(manifest.description.length <= 132, "manifest description must be no more than 132 characters.");
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

  for (const permission of ["activeTab", "contextMenus", "declarativeNetRequestWithHostAccess", "offscreen", "scripting", "sidePanel", "storage", "tabs"]) {
    assert(permissions.has(permission), `Missing permission: ${permission}`);
  }
  assert(!permissions.has("debugger"), "Debugger permission must not return for hidden-internal-only builds.");
  assert(!permissions.has("windows"), "Windows permission must not return unless a visible automation route is reintroduced.");

  const hostPermissions = new Set(manifest.host_permissions || []);
  const optionalHostPermissions = manifest.optional_host_permissions || [];

  assert(hostPermissions.has("<all_urls>"), "Visible screenshot capture must declare required <all_urls> host access.");
  assert(hostPermissions.has("https://chatgpt.com/*"), "Missing chatgpt.com host permission.");
  assert(hostPermissions.has("https://chat.openai.com/*"), "Missing chat.openai.com host permission.");
  assert(
    optionalHostPermissions.length === 0,
    `Visible screenshot capture uses required host access, not runtime optional prompts: ${optionalHostPermissions.join(", ")}`
  );
  assert(
    manifest.content_security_policy?.extension_pages?.includes("frame-src https://chatgpt.com https://chat.openai.com"),
    "Extension CSP must allow ChatGPT offscreen iframe probe hosts."
  );

  validateFirefoxManifest(buildTargetManifest(manifest, "firefox"));
}

function validateFirefoxManifest(manifest) {
  assert(manifest.manifest_version === 3, "Firefox manifest_version must be 3.");
  assert(manifest.name === "Dichrome", "Firefox manifest name must match the extension brand.");
  assert(!("minimum_chrome_version" in manifest), "Firefox manifest must not include minimum_chrome_version.");
  assert(!manifest.side_panel, "Firefox manifest must not include Chrome side_panel.");
  assert(manifest.sidebar_action?.default_panel === "sidepanel/sidepanel.html", "Firefox sidebar panel path is wrong.");
  assert(manifest.sidebar_action?.default_title === "Open Dichrome", "Firefox sidebar title must match the extension brand.");
  assert(manifest.sidebar_action?.open_at_install === false, "Firefox sidebar must not open automatically at install.");
  assert(manifest.background?.scripts?.[0] === "background/service-worker.js", "Firefox background script path is wrong.");
  assert(!manifest.background?.service_worker, "Firefox manifest must not include Chrome background service_worker.");
  assert(manifest.background?.type === "module", "Firefox background script must be an ES module.");
  assert(manifest.browser_specific_settings?.gecko?.id === "dichrome@local", "Firefox manifest must declare a stable Gecko id.");

  const permissions = new Set(manifest.permissions || []);

  for (const permission of ["activeTab", "contextMenus", "declarativeNetRequestWithHostAccess", "scripting", "storage", "tabs"]) {
    assert(permissions.has(permission), `Firefox manifest missing permission: ${permission}`);
  }

  for (const chromeOnlyPermission of ["offscreen", "sidePanel"]) {
    assert(!permissions.has(chromeOnlyPermission), `Firefox manifest must not include Chrome-only permission: ${chromeOnlyPermission}`);
  }

  const chatGptContentScript = manifest.content_scripts?.find((script) => {
    return script.matches?.includes("https://chatgpt.com/*") && script.matches?.includes("https://chat.openai.com/*");
  });

  assert(chatGptContentScript, "Firefox manifest missing ChatGPT content script matches.");
  assert(chatGptContentScript.all_frames === true, "Firefox ChatGPT content script must run in all frames.");
  assert(chatGptContentScript.run_at === "document_start", "Firefox ChatGPT content script must run at document_start.");
  assert(
    JSON.stringify(chatGptContentScript.js) === JSON.stringify(CHATGPT_CONTENT_SCRIPT_FILES),
    "Firefox ChatGPT content script order must match shared contract order."
  );
  assert(
    manifest.content_security_policy?.extension_pages?.includes("frame-src https://chatgpt.com https://chat.openai.com"),
    "Firefox manifest CSP must allow ChatGPT iframe hosts."
  );
}

async function validateFilesExist() {
  for (const file of requiredFiles) {
    await readFile(join(root, file), "utf8");
  }
}

async function validateRepositoryHygiene() {
  const rootEntries = await readdir(root);

  assert(rootEntries.includes(".gitignore"), "Repository ignore rules must live in .gitignore.");
  assert(!rootEntries.includes(".gitIgnore"), "Use .gitignore, not .gitIgnore.");

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");

  assert(gitignore.includes(".DS_Store"), ".gitignore must ignore macOS metadata files.");
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

async function validateStoreReviewReadiness() {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const hostPermissions = manifest.host_permissions || [];
  const optionalHostPermissions = manifest.optional_host_permissions || [];

  assert(
    hostPermissions.includes("<all_urls>"),
    "Store package must disclose required <all_urls> host access for deterministic visible screenshot capture."
  );
  assert(
    optionalHostPermissions.length === 0,
    `Store package should not request runtime optional screenshot host prompts: ${optionalHostPermissions.join(", ")}`
  );

  assert(
    !/experimental|prototype|unpacked/i.test(manifest.description),
    "Manifest description must be store-facing and must not describe the extension as an experimental unpacked prototype."
  );

  const submissionNotes = await readFile(join(root, "docs/chrome-web-store-submission.md"), "utf8");
  const privacyPolicy = await readFile(join(root, "docs/privacy-policy.md"), "utf8");

  for (const requiredPhrase of ["Permission Justifications", "Screenshot Site Access", "Remote Code Statement", "Reviewer Test Instructions"]) {
    assert(submissionNotes.includes(requiredPhrase), `Chrome Web Store notes must include: ${requiredPhrase}`);
  }

  for (const requiredPhrase of ["Data handled by the extension", "Data sharing", "Storage and retention"]) {
    assert(privacyPolicy.includes(requiredPhrase), `Privacy policy draft must include: ${requiredPhrase}`);
  }
}

async function validateNoUserFacingDebugControls() {
  const sidepanelHtml = await readFile(join(root, "sidepanel/sidepanel.html"), "utf8");
  const sidepanelDom = await readFile(join(root, "sidepanel/runtime/dom.js"), "utf8");
  const sidepanelApp = await readFile(join(root, "sidepanel/runtime/app.js"), "utf8");

  for (const phrase of [
    "Routing, automation, and debug",
    "Dump Debug",
    "Dump debug",
    "automation target",
    "debug dump",
    "eventLog",
    "automationVisibilityMode",
    "modelSelectionEnabled"
  ]) {
    assert(!sidepanelHtml.includes(phrase), `Side panel HTML must not expose debug/repair controls: ${phrase}`);
    assert(!sidepanelDom.includes(phrase), `Side panel DOM bindings must not expose debug/repair controls: ${phrase}`);
  }

  for (const forbiddenCall of ["DUMP_DEBUG", "SET_LOCAL_REPAIR_SETTINGS", "GET_LOCAL_REPAIR_SETTINGS", "GET_AUTOMATION_SESSION"]) {
    assert(!sidepanelApp.includes(forbiddenCall), `Side panel app must not call internal debug/repair route: ${forbiddenCall}`);
  }
}

async function validateNoRemoteCodeExecution() {
  const runtimeFiles = await listFiles(extensionRuntimeRoots);
  const javascriptRuntimeFiles = runtimeFiles.filter((file) => file.endsWith(".js"));

  for (const file of javascriptRuntimeFiles) {
    const source = await readFile(join(root, file), "utf8");

    assert(!/\beval\s*\(/.test(source), `${file} must not use eval().`);
    assert(!/\bnew\s+Function\s*\(/.test(source), `${file} must not use new Function().`);
    assert(!/\bimportScripts\s*\(/.test(source), `${file} must not load script code dynamically with importScripts().`);
    if (!["sidepanel/runtime/app.js", "sidepanel/runtime/attachments.js"].includes(file)) {
      assert(!/chrome\.permissions\.request\s*\(/.test(source), `${file} must not request runtime host permissions in the store package.`);
    }
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

async function listFiles(entries) {
  const files = [];

  for (const entry of entries) {
    const dirEntries = await readdir(join(root, entry), {
      withFileTypes: true
    });

    for (const dirEntry of dirEntries) {
      const relativePath = `${entry}/${dirEntry.name}`;

      if (dirEntry.isDirectory()) {
        files.push(...await listFiles([relativePath]));
        continue;
      }

      if (dirEntry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
