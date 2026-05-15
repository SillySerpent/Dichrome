export function createContextMenuController({
  appendEvent,
  normalizeText,
  openSidePanel,
  requestProfiles,
  startRequest,
  updateRequest
}) {
  async function createContextMenus() {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

    for (const profile of Object.values(requestProfiles)) {
      if (profile.inputKind !== "selection" || !profile.contextMenuTitle) {
        continue;
      }

      chrome.contextMenus.create({
        id: `profile:${profile.id}`,
        title: profile.contextMenuTitle,
        contexts: ["selection"]
      });
    }
  }

  async function handleContextMenuClick(info, tab) {
    if (!info.menuItemId || !String(info.menuItemId).startsWith("profile:")) {
      return;
    }

    const profileId = String(info.menuItemId).slice("profile:".length);
    const selectedText = normalizeText(info.selectionText);

    await openSidePanel(tab?.id);

    const { requestId } = await startRequest({
      profileId,
      sourceTab: tab,
      selectedText
    });

    await updateRequest(requestId, (request) => {
      appendEvent(request, "Context menu request created.");
    });
  }

  return Object.freeze({
    createContextMenus,
    handleContextMenuClick
  });
}
