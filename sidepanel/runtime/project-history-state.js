export const PROJECT_HISTORY_STORAGE_KEY = "dichrome.projectHistoryState";
export const PROJECT_HISTORY_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  LOADED: "loaded",
  EMPTY: "empty",
  ERROR: "error",
  LOGGED_OUT: "logged-out",
  PENDING_AUTH: "pending-auth"
});

export function createProjectHistoryState() {
  return {
    status: PROJECT_HISTORY_STATUS.IDLE,
    loaded: false,
    loadingList: false,
    loadingConversationId: "",
    conversations: [],
    nextCursor: null,
    project: null,
    activeConversation: null,
    renderedMessageCount: 0,
    error: "",
    pending: false,
    pendingSource: ""
  };
}

export function loadPersistedProjectHistoryState(state, storage = localStorage) {
  try {
    const raw = storage.getItem(PROJECT_HISTORY_STORAGE_KEY);

    if (!raw) {
      return;
    }

    const persisted = JSON.parse(raw);

    if (!persisted || typeof persisted !== "object") {
      return;
    }

    state.loaded = Boolean(persisted.loaded);
    state.status = state.loaded ? PROJECT_HISTORY_STATUS.LOADED : PROJECT_HISTORY_STATUS.IDLE;
    state.project = persisted.project || null;
    state.conversations = Array.isArray(persisted.conversations) ? persisted.conversations : [];
    state.nextCursor = persisted.nextCursor ?? null;
    state.activeConversation = persisted.activeConversation || null;
    state.renderedMessageCount = Number.isFinite(Number(persisted.renderedMessageCount))
      ? Number(persisted.renderedMessageCount)
      : 0;
    state.error = "";
    state.pending = false;
    state.pendingSource = "";
  } catch {
    // Ignore malformed persisted state.
  }
}

export function setProjectHistoryStatus(state, status) {
  state.status = Object.values(PROJECT_HISTORY_STATUS).includes(status)
    ? status
    : PROJECT_HISTORY_STATUS.IDLE;
  state.loaded = state.status === PROJECT_HISTORY_STATUS.LOADED
    || state.status === PROJECT_HISTORY_STATUS.EMPTY
    || Boolean(state.loaded && state.status === PROJECT_HISTORY_STATUS.LOADING);
  state.loadingList = state.status === PROJECT_HISTORY_STATUS.LOADING;
  state.pending = state.status === PROJECT_HISTORY_STATUS.PENDING_AUTH;
}

export function persistProjectHistoryState(state, storage = localStorage) {
  try {
    const persisted = {
      loaded: state.loaded,
      project: state.project,
      conversations: state.conversations,
      nextCursor: state.nextCursor,
      activeConversation: state.activeConversation,
      renderedMessageCount: state.renderedMessageCount
    };

    storage.setItem(PROJECT_HISTORY_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Ignore persistence failures.
  }
}

export function normalizeHistoryProjectKey(project) {
  return String(project?.name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
