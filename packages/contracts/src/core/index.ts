export const CONTRACT_NAMESPACE = "urn:agent-harness-reference" as const;

export const CORE_CONTRACT_IDS = [
  "identifier:v1",
  "provenance:v1",
  "classification-ref:v1",
  "semver:v1",
] as const;

export type CoreContractId = (typeof CORE_CONTRACT_IDS)[number];

export function coreContractId(name: string, majorVersion: number): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid contract name: ${name}`);
  }
  if (!Number.isInteger(majorVersion) || majorVersion < 1) {
    throw new Error(`Invalid major version: ${majorVersion}`);
  }
  return `${CONTRACT_NAMESPACE}:${name}:v${majorVersion}`;
}
