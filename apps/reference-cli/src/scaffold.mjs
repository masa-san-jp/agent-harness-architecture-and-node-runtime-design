import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const templateRoot = fileURLToPath(
  new URL("../templates/organization-bootstrap/", import.meta.url),
);

export const SCAFFOLD_FILES = [
  "README.md",
  ".gitignore",
  "profile.json",
  "policy.json",
  "input/events.jsonl",
  "adapter-input/events.org-export",
  "adapter-bundle/manifest.json",
  "adapter-bundle/profile.json",
  "adapter-bundle/example-adapter.mjs",
];

function displayPath(path, root) {
  const value = relative(root, path).split(sep).join("/");
  return value.startsWith(".") ? value : `./${value}`;
}

export async function createScaffold(directory, invocationRoot = process.cwd()) {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length > 0) {
    throw new Error(`SCAFFOLD_TARGET_NOT_EMPTY: ${target}`);
  }

  const rootLabel = displayPath(target, resolve(invocationRoot));
  for (const file of SCAFFOLD_FILES) {
    const sourcePath = join(templateRoot, file);
    const targetPath = join(target, file);
    await mkdir(dirname(targetPath), { recursive: true });
    let content = await readFile(sourcePath, "utf8");
    if (file === "README.md") content = content.replaceAll("__SCAFFOLD_DIR__", rootLabel);
    await writeFile(targetPath, content, { encoding: "utf8", flag: "wx" });
  }

  return { directory: target, files: SCAFFOLD_FILES.map((file) => join(target, file)) };
}
