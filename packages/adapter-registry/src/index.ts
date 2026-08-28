import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  builtInAdapters,
  type EvidenceAdapter,
  type SourceKind,
} from "@agent-harness/evidence-importer";
import type { OrganizationProfile } from "@agent-harness/profile";

export const ADAPTER_BUNDLE_CONTRACT_ID = "evidence-adapter-bundle" as const;
export const ADAPTER_BUNDLE_CONTRACT_VERSION = "1.0.0" as const;

export interface AdapterBundleManifest {
  bundle_id: string;
  version: string;
  adapters: readonly {
    adapter_ref: string;
    version: string;
    source_kind: SourceKind;
    module_path: string;
    read_only: true;
  }[];
  extensions?: Record<string, unknown>;
}

export interface LoadedAdapterBundle {
  manifest: AdapterBundleManifest;
  adapters: readonly EvidenceAdapter[];
  digest: string;
  path: string;
}

export interface AdapterRegistry {
  readonly adapters: readonly EvidenceAdapter[];
  register(adapter: EvidenceAdapter): void;
  adaptersFor(profile: OrganizationProfile): readonly EvidenceAdapter[];
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SOURCE_KINDS = new Set<SourceKind>([
  "csv",
  "email",
  "chat",
  "file_update",
  "api_audit",
  "procedure",
  "spreadsheet",
  "other",
]);
const EXTENSION_KEY = /^(domain|local)\.[a-z][a-z0-9_.-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`ADAPTER_BUNDLE_INVALID: ${field}`);
  }
}

function assertSemver(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    throw new Error(`ADAPTER_BUNDLE_INVALID: ${field}`);
  }
}

function validateExtensions(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).some((key) => !EXTENSION_KEY.test(key))) {
    throw new Error("ADAPTER_BUNDLE_INVALID: extensions");
  }
  return value;
}

function assertModulePath(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "..") ||
    !value.endsWith(".mjs")
  ) {
    throw new Error(`ADAPTER_BUNDLE_INVALID: ${field}`);
  }
}

function assertAdapterShape(value: unknown, field: string): asserts value is EvidenceAdapter {
  if (!isRecord(value)) throw new Error(`ADAPTER_INVALID: ${field}`);
  if (typeof value.adapterId !== "string" || !IDENTIFIER.test(value.adapterId)) {
    throw new Error(`ADAPTER_INVALID: ${field}.adapterId`);
  }
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    throw new Error(`ADAPTER_INVALID: ${field}.version`);
  }
  if (typeof value.sourceKind !== "string" || !SOURCE_KINDS.has(value.sourceKind as SourceKind)) {
    throw new Error(`ADAPTER_INVALID: ${field}.sourceKind`);
  }
  if (typeof value.supports !== "function" || typeof value.parse !== "function") {
    throw new Error(`ADAPTER_INVALID: ${field}.port`);
  }
}

export function validateAdapterBundle(input: unknown): AdapterBundleManifest {
  if (!isRecord(input)) throw new Error("ADAPTER_BUNDLE_INVALID: expected an object");
  const allowed = new Set(["bundle_id", "version", "adapters", "extensions"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("ADAPTER_BUNDLE_INVALID: unknown property");
  }
  assertIdentifier(input.bundle_id, "bundle_id");
  assertSemver(input.version, "version");
  if (!Array.isArray(input.adapters) || input.adapters.length === 0) {
    throw new Error("ADAPTER_BUNDLE_INVALID: adapters");
  }
  const extensions = validateExtensions(input.extensions);
  const refs = new Set<string>();
  const adapters = input.adapters.map((value, index) => {
    if (!isRecord(value)) throw new Error(`ADAPTER_BUNDLE_INVALID: adapters[${index}]`);
    const allowedAdapterKeys = new Set([
      "adapter_ref",
      "version",
      "source_kind",
      "module_path",
      "read_only",
    ]);
    if (Object.keys(value).some((key) => !allowedAdapterKeys.has(key))) {
      throw new Error(`ADAPTER_BUNDLE_INVALID: adapters[${index}] unknown property`);
    }
    assertIdentifier(value.adapter_ref, `adapters[${index}].adapter_ref`);
    if (refs.has(value.adapter_ref)) {
      throw new Error(`ADAPTER_BUNDLE_INVALID: duplicate adapter_ref ${value.adapter_ref}`);
    }
    refs.add(value.adapter_ref);
    assertSemver(value.version, `adapters[${index}].version`);
    if (
      typeof value.source_kind !== "string" ||
      !SOURCE_KINDS.has(value.source_kind as SourceKind)
    ) {
      throw new Error(`ADAPTER_BUNDLE_INVALID: adapters[${index}].source_kind`);
    }
    assertModulePath(value.module_path, `adapters[${index}].module_path`);
    if (value.read_only !== true) {
      throw new Error(`ADAPTER_BUNDLE_INVALID: adapters[${index}].read_only`);
    }
    return {
      adapter_ref: value.adapter_ref,
      version: value.version,
      source_kind: value.source_kind as SourceKind,
      module_path: value.module_path,
      read_only: true as const,
    };
  });
  return {
    bundle_id: input.bundle_id,
    version: input.version,
    adapters,
    ...(extensions ? { extensions } : {}),
  };
}

function digestBundle(
  manifest: AdapterBundleManifest,
  modules: readonly { path: string; sha256: string }[],
): string {
  return createHash("sha256").update(JSON.stringify({ manifest, modules })).digest("hex");
}

export async function loadAdapterBundle(path: string): Promise<LoadedAdapterBundle> {
  const manifestPath = resolve(path);
  const manifestBytes = await readFile(manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("ADAPTER_BUNDLE_INVALID: malformed JSON");
  }
  const manifest = validateAdapterBundle(parsed);
  const bundleDirectory = dirname(manifestPath);
  const trustedBundleDirectory = await realpath(bundleDirectory);
  const adapters: EvidenceAdapter[] = [];
  const modules: { path: string; sha256: string }[] = [];

  for (const [index, declaration] of manifest.adapters.entries()) {
    const modulePath = resolve(bundleDirectory, declaration.module_path);
    const trustedModulePath = await realpath(modulePath);
    const boundary = relative(trustedBundleDirectory, trustedModulePath);
    if (!boundary || boundary.startsWith("..") || isAbsolute(boundary)) {
      throw new Error(`ADAPTER_BUNDLE_PATH_ESCAPE: adapters[${index}].module_path`);
    }
    const moduleBytes = await readFile(trustedModulePath);
    const loaded = await import(`${pathToFileURL(trustedModulePath).href}?bundle=${index}`);
    const candidate = loaded.default ?? loaded.adapter;
    assertAdapterShape(candidate, `adapters[${index}]`);
    if (
      candidate.adapterId !== declaration.adapter_ref ||
      candidate.version !== declaration.version ||
      candidate.sourceKind !== declaration.source_kind
    ) {
      throw new Error(`ADAPTER_BUNDLE_BINDING_MISMATCH: ${declaration.adapter_ref}`);
    }
    adapters.push(candidate);
    modules.push({
      path: declaration.module_path,
      sha256: createHash("sha256").update(moduleBytes).digest("hex"),
    });
  }

  return {
    manifest,
    adapters,
    digest: digestBundle(manifest, modules),
    path: manifestPath,
  };
}

function validateRegisteredAdapter(adapter: EvidenceAdapter): void {
  assertAdapterShape(adapter, "registered adapter");
}

export function createAdapterRegistry(
  customAdapters: readonly EvidenceAdapter[] = [],
): AdapterRegistry {
  const registered: EvidenceAdapter[] = [];
  const refs = new Set<string>();
  const register = (adapter: EvidenceAdapter): void => {
    validateRegisteredAdapter(adapter);
    if (refs.has(adapter.adapterId)) {
      throw new Error(`ADAPTER_DUPLICATE: ${adapter.adapterId}`);
    }
    refs.add(adapter.adapterId);
    registered.push(adapter);
  };

  for (const adapter of customAdapters) register(adapter);
  for (const adapter of builtInAdapters) register(adapter);

  return {
    get adapters(): readonly EvidenceAdapter[] {
      return [...registered];
    },
    register,
    adaptersFor(profile: OrganizationProfile): readonly EvidenceAdapter[] {
      const selected: EvidenceAdapter[] = [];
      const declared = new Set<string>();
      for (const declaration of profile.adapters) {
        if (declared.has(declaration.adapter_ref)) {
          throw new Error(`PROFILE_ADAPTER_DUPLICATE: ${declaration.adapter_ref}`);
        }
        declared.add(declaration.adapter_ref);
        const adapter = registered.find(
          (candidate) => candidate.adapterId === declaration.adapter_ref,
        );
        if (!adapter) throw new Error(`PROFILE_ADAPTER_NOT_RESOLVED: ${declaration.adapter_ref}`);
        if (adapter.version !== declaration.version) {
          throw new Error(`PROFILE_ADAPTER_VERSION_MISMATCH: ${declaration.adapter_ref}`);
        }
        if (adapter.sourceKind !== declaration.source_kind) {
          throw new Error(`PROFILE_ADAPTER_SOURCE_KIND_MISMATCH: ${declaration.adapter_ref}`);
        }
        selected.push(adapter);
      }
      return selected;
    },
  };
}
