import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const [scriptName, ...scriptArgs] = process.argv.slice(2);

if (!scriptName) {
  console.error("Usage: node scripts/run-workspaces.mjs <script> [...args]");
  process.exit(2);
}

const rootDirectory = resolve(import.meta.dirname, "..");
const workspaceDirectories = [];

for (const workspaceRoot of ["packages", "apps"]) {
  const directory = join(rootDirectory, workspaceRoot);
  if (!existsSync(directory)) {
    continue;
  }

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspaceDirectory = join(directory, entry.name);
    const packageJsonPath = join(workspaceDirectory, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (!packageJson.name?.startsWith("@agent-harness/") || !packageJson.scripts?.[scriptName]) {
      continue;
    }

    workspaceDirectories.push({
      directory: workspaceDirectory,
      name: packageJson.name,
    });
  }
}

workspaceDirectories.sort((left, right) => left.name.localeCompare(right.name));

if (workspaceDirectories.length === 0) {
  console.log(`No @agent-harness workspace exposes '${scriptName}'.`);
  process.exit(0);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const workspace of workspaceDirectories) {
  console.log(`\n> ${workspace.name} ${scriptName}`);
  const exitCode = await new Promise((resolveExitCode) => {
    const child = spawn(
      pnpmCommand,
      ["--dir", workspace.directory, "run", scriptName, ...scriptArgs],
      {
        env: {
          ...process.env,
          npm_config_engine_strict: "false",
        },
        stdio: "inherit",
      },
    );
    child.on("close", (code) => resolveExitCode(code ?? 1));
    child.on("error", () => resolveExitCode(1));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
