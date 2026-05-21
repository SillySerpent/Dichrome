import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { CHATGPT_CONTENT_SCRIPT_FILES } from "../shared/contracts.js";

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
  "background/debug/debug-dump-collector.js",
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
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-conversation-thread.mjs",
  "scripts/test-sidepanel-layout-css.mjs",
  "scripts/test-contracts.mjs",
  "scripts/test-response-formatting.mjs",
  "scripts/package-extension.mjs",
  "sidepanel/sidepanel.html",
  "sidepanel/sidepanel.css",
  "sidepanel/sidepanel.js",
  "sidepanel/runtime/app.js",
  "sidepanel/runtime/client.js",
  "sidepanel/runtime/conversation-thread.js",
  "sidepanel/runtime/dom.js",
  "sidepanel/runtime/project-history-state.js",
  "sidepanel/runtime/response-animation.js",
  "sidepanel/runtime/response-view.js",
  "sidepanel/runtime/state.js",
  "shared/contracts.js",
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
  "scripts/test-dom-utils-click.mjs",
  "scripts/test-model-scoring.mjs",
  "scripts/test-main-world-capture.mjs",
  "scripts/test-response-animation.mjs",
  "scripts/test-conversation-thread.mjs",
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
  const redundantOptionalHostPermissions = optionalHostPermissions.filter((optionalHostPermission) => {
    return Array.from(hostPermissions).some((hostPermission) => {
      return hostPermission === optionalHostPermission || hostPermission === "<all_urls>";
    });
  });

  assert(hostPermissions.has("https://chatgpt.com/*"), "Missing chatgpt.com host permission.");
  assert(hostPermissions.has("https://chat.openai.com/*"), "Missing chat.openai.com host permission.");
  assert(!hostPermissions.has("<all_urls>"), "Required <all_urls> host access is too broad for Dichrome's store package.");
  assert(!optionalHostPermissions.includes("<all_urls>"), "Optional <all_urls> host access is too broad for Dichrome's store package.");
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
  const optionalHostPermissions = manifest.optional_host_permissions || [];

  assert(
    optionalHostPermissions.length === 0,
    `Store package must not request optional host permissions unless a review note is added for them: ${optionalHostPermissions.join(", ")}`
  );

  assert(
    !/experimental|prototype|unpacked/i.test(manifest.description),
    "Manifest description must be store-facing and must not describe the extension as an experimental unpacked prototype."
  );

  const submissionNotes = await readFile(join(root, "docs/chrome-web-store-submission.md"), "utf8");
  const privacyPolicy = await readFile(join(root, "docs/privacy-policy.md"), "utf8");

  for (const requiredPhrase of ["Permission Justifications", "Remote Code Statement", "Reviewer Test Instructions"]) {
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
    "Local repair",
    "Dump Debug",
    "Dump debug",
    "automation target",
    "debug dump",
    "repairSuggestions",
    "eventLog",
    "automationVisibilityMode",
    "modelSelectionEnabled",
    "projectRoutingEnabled"
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
    assert(!/chrome\.permissions\.request\s*\(/.test(source), `${file} must not request runtime host permissions in the store package.`);
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
