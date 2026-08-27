import { spawn } from "node:child_process";

const packages = [
  "@agent-harness/evidence-importer",
  "@agent-harness/graph-inference",
  "@agent-harness/harness-draft",
  "@agent-harness/policy-evaluator",
  "@agent-harness/review-workflow",
  "@agent-harness/control-kernel",
  "@agent-harness/ephemeral-runtime",
];

function build(packageName) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--config.engine-strict=false", "--filter", packageName, "build"],
      {
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${packageName} build failed with exit code ${code}`));
    });
  });
}

for (const packageName of packages) await build(packageName);
