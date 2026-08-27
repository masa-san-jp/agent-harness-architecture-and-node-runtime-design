import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assert } from "../shared/assertions.mjs";
import { readJson, sha256 } from "../shared/files.mjs";

const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(runnerDirectory, "../../../..");
const fixtureRoot = join(repositoryDirectory, "fixtures/bootstrap/minimal-office-v1");
const suitesRoot = join(runnerDirectory, "../suites");

export function parseArguments(args) {
  const options = { list: false, suite: undefined };
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const argument = normalizedArgs[index];
    if (argument === "--list") {
      options.list = true;
      continue;
    }
    if (argument === "--suite") {
      const suite = normalizedArgs[index + 1];
      if (!suite || suite.startsWith("--")) {
        throw new Error("--suite requires a suite id");
      }
      options.suite = suite;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

export async function discoverSuites() {
  if (!existsSync(suitesRoot)) {
    return [];
  }

  const entries = await readdir(suitesRoot, { withFileTypes: true });
  const suites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const modulePath = join(suitesRoot, entry.name, "suite.mjs");
    if (!existsSync(modulePath)) {
      continue;
    }
    const suite = await import(pathToFileURL(modulePath));
    assert(typeof suite.id === "string", `Suite ${entry.name} must export id`);
    assert(typeof suite.run === "function", `Suite ${entry.name} must export run`);
    assert(suite.id === entry.name, `Suite directory and id differ: ${entry.name} / ${suite.id}`);
    suites.push({ id: suite.id, run: suite.run });
  }

  return suites.sort((left, right) => left.id.localeCompare(right.id));
}

export async function runSuites({ suiteId } = {}) {
  const suites = await discoverSuites();
  const selected = suiteId ? suites.filter((suite) => suite.id === suiteId) : suites;
  if (suiteId && selected.length === 0) {
    throw new Error(`Suite not found: ${suiteId}`);
  }

  for (const suite of selected) {
    await suite.run({ fixtureRoot, assert, readJson, sha256 });
    console.log(`PASS ${suite.id}`);
  }

  return selected.map((suite) => suite.id);
}

export async function main() {
  const options = parseArguments(process.argv.slice(2));
  const suites = await discoverSuites();

  if (options.list) {
    for (const suite of suites) {
      console.log(suite.id);
    }
    return;
  }

  if (suites.length === 0) {
    console.log("No conformance suites discovered.");
    return;
  }

  await runSuites({ suiteId: options.suite });
}

const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
