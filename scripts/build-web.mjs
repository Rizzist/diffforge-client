import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const distDir = path.join(root, "dist");
const lockDir = path.join(root, "node_modules", ".cache", "diffforge-build-web.lock");
const lockStaleMs = 10 * 60 * 1000;
const lockPollMs = 250;
const lockTimeoutMs = 60 * 1000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireBuildLock() {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      let ageMs = 0;
      try {
        const stats = fs.statSync(lockDir);
        ageMs = Date.now() - stats.mtimeMs;
      } catch {
        ageMs = lockStaleMs + 1;
      }

      if (ageMs > lockStaleMs) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error("Timed out waiting for another web build to finish.");
      }

      sleep(lockPollMs);
    }
  }
}

function releaseBuildLock() {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function isAssetReference(value) {
  return (
    value.startsWith("/assets/")
    || value.startsWith("./")
    || value.startsWith("../")
  );
}

function assetPathFromReference(reference, containingFile) {
  if (!isAssetReference(reference)) {
    return null;
  }

  if (reference.startsWith("/assets/")) {
    return path.join(distDir, reference.slice(1));
  }

  return path.resolve(path.dirname(containingFile), reference);
}

function isKnownEmbeddedAssetReference(reference, containingFile) {
  return (
    path.basename(containingFile).startsWith("standalone.min-")
    && (reference === "../components/GenericSolverDebugger" || reference === "./MyComponent")
  );
}

function validateReferencesInFile(filePath, source, failures) {
  const patterns = [
    /\b(?:src|href)=["']([^"']+)["']/gu,
    /\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu,
  ];

  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      if (isKnownEmbeddedAssetReference(match[1], filePath)) {
        continue;
      }

      const referencedPath = assetPathFromReference(match[1], filePath);
      if (referencedPath && !fs.existsSync(referencedPath)) {
        failures.push(
          `${path.relative(root, filePath)} references missing asset ${match[1]}`,
        );
      }
    }
  });
}

function walkFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(entryPath);
    }
    return [entryPath];
  });
}

function validateDist() {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error("dist/index.html was not emitted.");
  }

  const files = walkFiles(distDir).filter((filePath) => /\.(?:html|js|css)$/iu.test(filePath));
  const failures = [];

  files.forEach((filePath) => {
    validateReferencesInFile(filePath, fs.readFileSync(filePath, "utf8"), failures);
  });

  if (failures.length > 0) {
    throw new Error(
      [
        "The web build emitted missing asset references:",
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
}

acquireBuildLock();

try {
  const build = spawnSync("vite", ["build"], {
    cwd: root,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (build.status !== 0) {
    process.exit(build.status || 1);
  }

  validateDist();
} finally {
  releaseBuildLock();
}
