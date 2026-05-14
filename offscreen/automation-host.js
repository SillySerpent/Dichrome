const frame = document.getElementById("chatgptFrame");
let frameLoaded = false;
let frameFailed = false;
let failureReason = "";

frame.addEventListener("load", () => {
  frameLoaded = true;
});

frame.addEventListener("error", () => {
  frameFailed = true;
  failureReason = "ChatGPT iframe failed to load in the offscreen host.";
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OFFSCREEN_AUTOMATION_PROBE") {
    return false;
  }

  if (frameFailed) {
    sendResponse({
      target: "offscreen-automation-host",
      supported: false,
      failureReason
    });
    return false;
  }

  sendResponse({
    target: "offscreen-automation-host",
    supported: frameLoaded,
    failureReason: frameLoaded
      ? null
      : "Waiting for ChatGPT iframe load in the offscreen host."
  });
  return false;
});
