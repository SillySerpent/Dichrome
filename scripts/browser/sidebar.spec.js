import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

let context;
let profile;
let extensionId;
const promptKey = "dichrome.mode2.latestPrompt";

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "dichrome-browser-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${resolve(".")}`, `--load-extension=${resolve(".")}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  // A controlled ChatGPT document exercises the real extension bridge without an account or sending a message.
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html", body: `<!doctype html><html><head><title>ChatGPT test fixture</title>
    <style>html {color-scheme:dark} body {margin:0;background:#212121;color:#eee;font:14px sans-serif}
    main {height:100vh;display:flex;flex-direction:column;box-sizing:border-box;padding:16px}
    form {margin-top:auto} textarea {width:100%;box-sizing:border-box;min-height:90px}</style></head>
    <body><main><h2>ChatGPT test fixture</h2><p>Local browser verification. No message is sent.</p>
    <form><textarea aria-label="Message ChatGPT" placeholder="Message ChatGPT"></textarea>
    <input id="upload" type="file" accept="image/*" hidden>
    <button type="button" id="send" onclick="document.body.dataset.sent='true'">Send</button></form></main>
    <script>document.querySelector('#upload').addEventListener('change', (event) => {
      const chip = document.createElement('div'); chip.dataset.testid = 'attachment';
      chip.textContent = event.target.files[0].name; document.querySelector('form').prepend(chip);
    });</script></body></html>`
  }));
  await context.route("https://example.com/**", (route) => route.fulfill({
    contentType: "text/html", body: '<p id="passage">A useful selected passage about resilient software.</p>'
  }));
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function openSidebar(width = 360, height = 800) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`chrome-extension://${extensionId}/sidepanel/mode2/sidepanel.html`);
  return page;
}

async function seedPrompt() {
  await context.serviceWorkers()[0].evaluate(async (key) => {
    await chrome.storage.session.remove("dichrome.mode2.promptDraft");
    await chrome.storage.session.set({ [key]: {
      id: crypto.randomUUID(), actionLabel: "Explain", prompt: "Explain: A useful selected passage",
      sourceTitle: "A page about resilient software", sourceUrl: "https://example.com/"
    } });
  }, promptKey);
}

// Inspect the closed production shadow root through Chromium's DOM domain.
async function inspectPopover(page, label) {
  const session = await context.newCDPSession(page);
  async function popupButton() {
    const { root } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node) => {
      if (node.nodeName === "BUTTON" && node.children?.some((child) => child.nodeValue === label)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = find(child); if (found) return found;
      }
    };
    return find(root);
  }
  return { session, popupButton };
}

async function clickPopover(page, label) {
  const { session, popupButton } = await inspectPopover(page, label);
  await expect.poll(async () => Boolean(await popupButton())).toBe(true);
  const { model } = await session.send("DOM.getBoxModel", { nodeId: (await popupButton()).nodeId });
  await page.mouse.click((model.border[0] + model.border[2]) / 2, (model.border[1] + model.border[5]) / 2);
}

test("selection popup keeps its click target during a slow click and queues context", async () => {
  const page = await context.newPage();
  await page.goto("https://example.com/");
  await page.locator("#passage").selectText();
  const { session, popupButton } = await inspectPopover(page, "Explain");
  await expect.poll(async () => Boolean(await popupButton())).toBe(true);
  const button = await popupButton();
  const popover = await page.locator("[data-chatgpt-sidebar-popover]").boundingBox();
  expect(popover.width).toBeLessThan(250);
  expect(popover.height).toBeLessThan(38);
  await page.screenshot({ path: "test-results/selection-popup.png" });
  const { model } = await session.send("DOM.getBoxModel", { nodeId: button.nodeId });
  const x = (model.border[0] + model.border[2]) / 2;
  const y = (model.border[1] + model.border[5]) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
  await page.waitForTimeout(160); // Reproduce the existing 80 ms button replacement race.
  await page.mouse.up();
  const worker = context.serviceWorkers()[0];
  await expect.poll(() => worker.evaluate(async (key) => (await chrome.storage.session.get(key))[key]?.selectedText, promptKey))
    .toBe("A useful selected passage about resilient software.");
  const { root: afterClick } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
  expect(JSON.stringify(afterClick)).toContain("Ready in Dichrome");
  await page.close();
});

test("sidebar fits narrow widths and retains editable context through screenshot updates", async () => {
  await seedPrompt();
  const page = await openSidebar();
  await expect(page.locator("#promptText")).toHaveValue(/A useful selected passage/);
  await page.locator("#promptText").fill("My edited prompt");
  for (const width of [280, 320, 360, 480]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const header = await page.locator(".top-bar").boundingBox();
    const frame = await page.locator("#chatGptFrame").boundingBox();
    expect(frame.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(frame.height).toBeGreaterThan(280);
  }
  await page.evaluate(() => chrome.storage.session.set({
    "dichrome.mode2.latestNotice": { message: "Screenshot captured", kind: "success" }
  }));
  await expect(page.locator("#promptText")).toHaveValue("My edited prompt");
  await page.reload();
  await expect(page.locator("#promptText")).toHaveValue("My edited prompt");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#frameStatus")).toHaveText("Connected");
  await page.screenshot({ path: "test-results/sidebar-context.png" });
  await page.close();
});

test("screenshot capture attaches once and keeps preview, save, and clear actions", async () => {
  const source = await context.newPage();
  await source.goto("https://example.com/");
  const page = await openSidebar();
  await expect(page.locator("#frameStatus")).toHaveText("Connected");
  await source.bringToFront();
  await source.locator("#passage").selectText();
  await clickPopover(source, "···");
  await clickPopover(source, "Screenshot");
  await expect(page.locator("#screenshotPreview")).toBeVisible();
  expect(await page.evaluate(async () => (await chrome.storage.session.get("dichrome.mode2.latestScreenshot"))["dichrome.mode2.latestScreenshot"].sourceUrl)).toBe("https://example.com/");
  await expect(page.locator("#statusText")).toContainText("Screenshot attached", { timeout: 12000 });
  await expect(page.frameLocator("#chatGptFrame").locator('[data-testid="attachment"]')).toHaveCount(1);
  await page.evaluate(() => chrome.storage.session.set({
    "dichrome.mode2.latestNotice": { id: "another-notice", message: "Context retained", kind: "success" }
  }));
  await expect(page.frameLocator("#chatGptFrame").locator('[data-testid="attachment"]')).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.locator("#downloadScreenshot").click();
  expect((await download).suggestedFilename()).toMatch(/^dichrome-screenshot-.*\.png$/);
  await expect(page.locator("#copyScreenshot")).toBeVisible();
  await page.screenshot({ path: "test-results/sidebar-screenshot.png" });
  await page.locator("#clearScreenshot").click();
  await expect(page.locator("#screenshotCard")).toBeHidden();
  await page.reload();
  await expect(page.locator("#screenshotCard")).toBeHidden();
  await page.close();
  await source.close();
});

test("unavailable frame exposes recovery and retains copyable context", async () => {
  await seedPrompt();
  const page = await context.newPage();
  await page.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Sign in to ChatGPT</h1><p>Create account or sign in.</p>"
  }));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel/mode2/sidepanel.html`);
  await expect(page.locator("#frameStatus")).toHaveText("Needs attention", { timeout: 20000 });
  await expect(page.locator("#frameRecovery")).toBeVisible();
  await expect(page.locator("#copyPrompt")).toBeVisible();
  await page.screenshot({ path: "test-results/sidebar-recovery.png" });
  await page.close();
});

test("insert is acknowledged, preserves a draft, and never sends", async () => {
  await seedPrompt();
  const page = await openSidebar();
  const composer = page.frameLocator("#chatGptFrame").getByRole("textbox");
  await expect(composer).toBeVisible();
  await composer.fill("Existing draft");
  await page.locator("#insertPrompt").click();
  await expect(page.locator("#statusText")).toContainText("already has a draft");
  await expect(composer).toHaveValue("Existing draft");
  await composer.fill("");
  await page.locator("#insertPrompt").click();
  await expect(composer).toHaveValue(/A useful selected passage/);
  await expect(page.locator("#statusText")).toContainText("Review it");
  expect(await composer.evaluate(() => document.body.dataset.sent)).toBeUndefined();
  await page.locator("#clearPrompt").click();
  await expect(page.locator("#promptCard")).toBeHidden();
  await page.reload();
  await expect(page.locator("#promptCard")).toBeHidden();
  await page.close();
});

test("reload waits for the replacement document before reporting readiness", async () => {
  const page = await openSidebar();
  await expect(page.locator("#frameStatus")).toHaveText("Connected");
  await page.route("https://chatgpt.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await route.fulfill({ contentType: "text/html", body: "<h1>Log in or Sign up</h1>" });
  });
  await page.locator("#toolsMenu summary").click();
  await page.locator("#reloadChatGptFrame").click();
  await expect(page.frameLocator("#chatGptFrame").locator("h1")).toHaveText("Log in or Sign up");
  await expect(page.locator("#frameStatus")).not.toHaveText("Connected");
  await expect(page.locator("#frameStatus")).toHaveText("Needs attention", { timeout: 20000 });
  await page.close();
});

test("a second screenshot queues behind an upload and receives its own acknowledgment", async () => {
  const page = await openSidebar();
  await expect(page.locator("#frameStatus")).toHaveText("Connected");
  const dataUrl = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
  const storeImage = (id) => page.evaluate(({ id, dataUrl }) => chrome.storage.session.set({
    "dichrome.mode2.latestScreenshot": { id, dataUrl, sourceTitle: id, createdAt: new Date().toISOString() }
  }), { id, dataUrl });
  await storeImage("image-A");
  await expect(page.locator("#attachScreenshot")).toHaveText("Attaching…");
  await storeImage("image-B");
  await expect.poll(() => page.evaluate(async () => (await chrome.storage.session.get("dichrome.mode2.attachedScreenshotId"))["dichrome.mode2.attachedScreenshotId"]), { timeout: 10000 }).toBe("image-B");
  await expect(page.frameLocator("#chatGptFrame").locator('[data-testid="attachment"]')).toHaveCount(2);
  await page.locator("#clearScreenshot").click();
  await page.close();
});

test("contenteditable insertion retains multiline text without submitting", async () => {
  await seedPrompt();
  const page = await context.newPage();
  await page.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html", body: '<main><form><div contenteditable="true" role="textbox" aria-label="Message ChatGPT" style="min-height:80px"></div><button id="send" type="button" onclick="document.body.dataset.sent=true">Send</button></form></main>'
  }));
  await page.goto(`chrome-extension://${extensionId}/sidepanel/mode2/sidepanel.html`);
  await expect(page.locator("#frameStatus")).toHaveText("Connected");
  const text = "Explain these points:\nFirst <example> & context.\nSecond point.";
  await page.locator("#promptText").fill(text);
  await page.locator("#insertPrompt").click();
  const composer = page.frameLocator("#chatGptFrame").getByRole("textbox");
  await expect(composer).toHaveText(text, { useInnerText: true });
  expect(await composer.evaluate(() => document.body.dataset.sent)).toBeUndefined();
  await page.close();
});

test("production shell keeps the current mode full width and opens settings from its menu", async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 280, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  const mode = page.frameLocator("#modeFrame");
  await expect(mode.locator("#frameStatus")).toHaveText("Connected");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(280);
  expect((await page.locator("#modeFrame").boundingBox()).y).toBe(0);
  await mode.locator("#toolsMenu summary").click();
  await mode.locator("#modeButton").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#modeSelect")).toHaveValue("mode2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.close();
});
