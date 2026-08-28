import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const noBuildOptions = new Set(["--help", "-h", "--version", "-v", "--init"]);
const canRunWithoutBuild = args.length > 0 && noBuildOptions.has(args[0]);

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

if (!canRunWithoutBuild) {
  const buildExitCode = await run("pnpm", ["run", "build-dependencies"]);
  if (buildExitCode !== 0) process.exitCode = buildExitCode;
}

if (!process.exitCode) {
  const cliPath = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
  const cliExitCode = await run(process.execPath, [cliPath, ...rawArgs]);
  if (cliExitCode !== 0) process.exitCode = cliExitCode;
}
