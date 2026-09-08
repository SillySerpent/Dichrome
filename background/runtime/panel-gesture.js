const PANEL_ACTIONS = new Set([
  "chatgpt-sidebar:selection-action",
  "chatgpt-sidebar:capture-visible-tab",
  "chatgpt-sidebar:open-side-panel"
]);

// Call at the browser event boundary, before mode lookup, storage, or capture.
export function openPanelForUserAction(message, sender, openSidePanel) {
  if (!PANEL_ACTIONS.has(message?.type) || !Number.isInteger(sender?.tab?.id)) {
    return Promise.resolve({});
  }
  return openSidePanel(sender.tab.id).then((result) => ({
    panelOpened: result?.opened === true,
    panelError: result?.error || ""
  }));
}
