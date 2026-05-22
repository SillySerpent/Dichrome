export const PACKAGE_TARGETS = Object.freeze(["chrome", "firefox"]);

const FIREFOX_GECKO_ID = "dichrome@local";

export function normalizePackageTarget(value) {
  const target = String(value || "chrome").trim().toLowerCase();

  if (!PACKAGE_TARGETS.includes(target)) {
    throw new Error(`Unsupported package target: ${value}`);
  }

  return target;
}

export function buildTargetManifest(baseManifest, targetValue) {
  const target = normalizePackageTarget(targetValue);
  const manifest = structuredClone(baseManifest);

  if (target === "chrome") {
    return manifest;
  }

  manifest.background = {
    scripts: [baseManifest.background?.service_worker || "background/service-worker.js"],
    type: baseManifest.background?.type || "module"
  };
  manifest.sidebar_action = {
    default_panel: baseManifest.side_panel?.default_path || "sidepanel/sidepanel.html",
    default_title: baseManifest.action?.default_title || baseManifest.name || "Dichrome",
    default_icon: baseManifest.icons || baseManifest.action?.default_icon || {},
    open_at_install: false
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: FIREFOX_GECKO_ID
    }
  };
  manifest.permissions = (baseManifest.permissions || []).filter((permission) => {
    return permission !== "offscreen" && permission !== "sidePanel";
  });

  delete manifest.minimum_chrome_version;
  delete manifest.side_panel;

  return manifest;
}
