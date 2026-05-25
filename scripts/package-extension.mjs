import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import {
  PACKAGE_TARGETS,
  buildTargetManifest,
  normalizePackageTarget
} from "./manifest-targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const distRoot = join(root, ".dist");
const requestedTargets = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map(normalizePackageTarget)
  : PACKAGE_TARGETS;
const packageEntries = [
  "LICENSE",
  "background",
  "content",
  "icons",
  "offscreen",
  "shared",
  "sidepanel"
];

runNodeScript("scripts/validate-extension.mjs");

for (const target of requestedTargets) {
  await createPackage(target);
}

async function createPackage(target) {
  const packageRoot = join(distRoot, target, "package");
  const archivePath = join(distRoot, target, `dichrome-${manifest.version}-${target}.zip`);

  await rm(packageRoot, {
    recursive: true,
    force: true
  });
  await mkdir(packageRoot, {
    recursive: true
  });

  for (const entry of packageEntries) {
    await cp(join(root, entry), join(packageRoot, entry), {
      recursive: true
    });
  }

  await writeFile(
    join(packageRoot, "manifest.json"),
    `${JSON.stringify(buildTargetManifest(manifest, target), null, 2)}\n`
  );

  await rm(archivePath, {
    force: true
  });

  const zipResult = spawnSync("zip", ["-qr", archivePath, "."], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  if (zipResult.error?.code === "ENOENT") {
    throw new Error("The zip command is required to create extension packages.");
  }

  if (zipResult.status !== 0) {
    throw new Error(`${target} package creation failed.\n${zipResult.stderr || zipResult.stdout}`);
  }

  console.log(`Created ${relative(root, archivePath)}`);
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [join(root, scriptPath)], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed.\n${result.stderr || result.stdout}`);
  }
}
