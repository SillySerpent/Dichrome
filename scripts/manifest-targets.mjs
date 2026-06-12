export const PACKAGE_TARGETS = Object.freeze(["chrome"]);

export function normalizePackageTarget(value) {
  const target = String(value || "chrome").trim().toLowerCase();

  if (!PACKAGE_TARGETS.includes(target)) {
    throw new Error(`Unsupported package target: ${value}`);
  }

  return target;
}

export function buildTargetManifest(baseManifest, targetValue) {
  normalizePackageTarget(targetValue);
  return structuredClone(baseManifest);
}
