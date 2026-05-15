const CHATGPT_FRAME_POLICY_RULE_ID = 91001;
const CHATGPT_FRAME_POLICY_DOMAINS = ["chatgpt.com", "chat.openai.com"];
const CHATGPT_FRAME_POLICY_RESOURCE_TYPES = ["sub_frame"];
const CHATGPT_FRAME_POLICY_RESPONSE_HEADERS = [
  {
    header: "x-frame-options",
    operation: "remove"
  },
  {
    header: "content-security-policy",
    operation: "remove"
  }
];

let lastPolicyStatus = {
  enabled: false,
  supported: null,
  ruleId: CHATGPT_FRAME_POLICY_RULE_ID,
  scope: null,
  error: null,
  updatedAt: null
};

export function getOffscreenFramePolicyStatus() {
  return {
    ...lastPolicyStatus
  };
}

export async function enableOffscreenFramePolicyOverride() {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr?.updateSessionRules) {
    return rememberPolicyStatus({
      enabled: false,
      supported: false,
      scope: null,
      error: "chrome.declarativeNetRequest.updateSessionRules is unavailable. Add declarativeNetRequestWithHostAccess permission or use a Chrome build that supports session DNR rules."
    });
  }

  const nonTabRule = buildChatGptFramePolicyRule({
    tabIds: [getNonTabRequestId()]
  });

  const nonTabInstall = await installSessionRule(nonTabRule).then(() => ({
    ok: true
  })).catch((error) => ({
    ok: false,
    error
  }));

  if (nonTabInstall.ok) {
    return rememberPolicyStatus({
      enabled: true,
      supported: true,
      scope: "non-tab-chatgpt-subframes",
      error: null
    });
  }

  const fallbackRule = buildChatGptFramePolicyRule();
  const fallbackInstall = await installSessionRule(fallbackRule).then(() => ({
    ok: true
  })).catch((error) => ({
    ok: false,
    error
  }));

  if (fallbackInstall.ok) {
    return rememberPolicyStatus({
      enabled: true,
      supported: true,
      scope: "all-chatgpt-subframes",
      error: `Non-tab-scoped frame policy rule failed, so a sub_frame-only fallback rule was installed instead. Original error: ${formatError(nonTabInstall.error)}`
    });
  }

  return rememberPolicyStatus({
    enabled: false,
    supported: false,
    scope: null,
    error: `Could not install ChatGPT frame-policy override. Non-tab scoped error: ${formatError(nonTabInstall.error)} Fallback error: ${formatError(fallbackInstall.error)}`
  });
}


export async function enableBroadOffscreenFramePolicyOverride(reason = "Broad ChatGPT subframe fallback requested.") {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr?.updateSessionRules) {
    return rememberPolicyStatus({
      enabled: false,
      supported: false,
      scope: null,
      error: "chrome.declarativeNetRequest.updateSessionRules is unavailable."
    });
  }

  const fallbackRule = buildChatGptFramePolicyRule();

  return installSessionRule(fallbackRule).then(() => rememberPolicyStatus({
    enabled: true,
    supported: true,
    scope: "all-chatgpt-subframes",
    error: reason
  })).catch((error) => rememberPolicyStatus({
    enabled: false,
    supported: false,
    scope: null,
    error: `Could not install broad ChatGPT subframe frame-policy override. ${formatError(error)}`
  }));
}

export async function disableOffscreenFramePolicyOverride() {
  const dnr = chrome.declarativeNetRequest;

  if (!dnr?.updateSessionRules) {
    rememberPolicyStatus({
      enabled: false,
      supported: false,
      scope: null,
      error: "chrome.declarativeNetRequest.updateSessionRules is unavailable."
    });
    return;
  }

  await dnr.updateSessionRules({
    removeRuleIds: [CHATGPT_FRAME_POLICY_RULE_ID]
  }).catch(() => null);

  rememberPolicyStatus({
    enabled: false,
    supported: true,
    scope: null,
    error: null
  });
}

function buildChatGptFramePolicyRule({ tabIds = null } = {}) {
  const condition = {
    requestDomains: CHATGPT_FRAME_POLICY_DOMAINS,
    resourceTypes: CHATGPT_FRAME_POLICY_RESOURCE_TYPES
  };

  if (Array.isArray(tabIds)) {
    condition.tabIds = tabIds;
  }

  return {
    id: CHATGPT_FRAME_POLICY_RULE_ID,
    priority: 100,
    action: {
      type: "modifyHeaders",
      responseHeaders: CHATGPT_FRAME_POLICY_RESPONSE_HEADERS
    },
    condition
  };
}

async function installSessionRule(rule) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CHATGPT_FRAME_POLICY_RULE_ID],
    addRules: [rule]
  });
}

function getNonTabRequestId() {
  return Number.isInteger(chrome.tabs?.TAB_ID_NONE)
    ? chrome.tabs.TAB_ID_NONE
    : -1;
}

function rememberPolicyStatus(partial) {
  lastPolicyStatus = {
    ...lastPolicyStatus,
    ...partial,
    ruleId: CHATGPT_FRAME_POLICY_RULE_ID,
    updatedAt: new Date().toISOString()
  };

  return getOffscreenFramePolicyStatus();
}

function formatError(error) {
  if (!error) {
    return "unknown";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || String(error);
}
