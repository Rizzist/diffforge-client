import { spawnSync } from "node:child_process";
import process from "node:process";

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

if (process.platform === "win32") {
  run(npx, ["tauri", "build", "--bundles", "nsis"]);
} else if (process.platform === "darwin") {
  run(npx, ["tauri", "build", "--bundles", "app"]);
  run("scripts/package-macos-pkg.sh", []);
} else if (process.platform === "linux") {
  run(npx, ["tauri", "build", "--bundles", "deb,rpm"]);
} else {
  console.error(`Unsupported packaging platform: ${process.platform}`);
  process.exit(1);
}
