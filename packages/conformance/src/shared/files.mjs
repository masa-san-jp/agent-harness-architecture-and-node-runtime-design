import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function sha256(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}
