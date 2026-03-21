import * as semver from "semver";
import { getSettings } from "./config";
import type { DependencyEntry, ResolvedDependencyState, UpdateTargets, UpdateMode } from "./types";

interface Packument {
  distTags: Record<string, string>;
  versions: string[];
}

interface CacheEntry {
  expiresAt: number;
  packument: Packument;
}

const unsupportedPrefixes = [
  "workspace:",
  "file:",
  "link:",
  "portal:",
  "catalog:",
  "github:",
  "git+",
  "http:",
  "https:",
  "npm:"
];

export class NpmRegistryClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Packument>>();

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  async resolveDependency(
    entry: DependencyEntry,
    includePrerelease: boolean
  ): Promise<ResolvedDependencyState> {
    if (!entry.spec || isUnsupportedSpec(entry.spec)) {
      return {
        kind: "unsupported",
        detail: "Unsupported spec"
      };
    }

    const currentVersion = semver.minVersion(entry.spec)?.version;
    if (!currentVersion) {
      return {
        kind: "unsupported",
        detail: "Unsupported range"
      };
    }

    const packument = await this.fetchPackument(entry.name);
    const targets = getUpdateTargets(
      currentVersion,
      packument.versions,
      packument.distTags,
      includePrerelease
    );
    const latestVersion = targets.latest;

    if (!latestVersion) {
      return {
        kind: "unsupported",
        detail: "No published versions"
      };
    }

    return {
      kind: "ready",
      latestVersion,
      latestKind: normalizeDiff(currentVersion, latestVersion) ?? "current",
      targets
    };
  }

  private async fetchPackument(packageName: string): Promise<Packument> {
    const settings = getSettings();
    const registryUrl = ensureTrailingSlash(settings.registryUrl);
    const cacheKey = `${registryUrl}|${packageName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.packument;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const request = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${registryUrl}${encodePackageName(packageName)}`, {
          headers: {
            Accept: "application/vnd.npm.install-v1+json, application/json"
          },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Registry request failed with ${response.status}`);
        }

        const payload = (await response.json()) as {
          "dist-tags"?: Record<string, string>;
          versions?: Record<string, unknown>;
        };

        const packument: Packument = {
          distTags: payload["dist-tags"] ?? {},
          versions: Object.keys(payload.versions ?? {}).filter((version) => semver.valid(version))
        };

        this.cache.set(cacheKey, {
          expiresAt: Date.now() + settings.cacheTtlMs,
          packument
        });

        return packument;
      } finally {
        clearTimeout(timeout);
        this.inflight.delete(cacheKey);
      }
    })();

    this.inflight.set(cacheKey, request);
    return request;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function encodePackageName(name: string): string {
  return encodeURIComponent(name).replace("%40", "@");
}

function isUnsupportedSpec(spec: string): boolean {
  if (unsupportedPrefixes.some((prefix) => spec.startsWith(prefix))) {
    return true;
  }

  return parseSpecDescriptor(spec) === undefined;
}

function getUpdateTargets(
  currentVersion: string,
  versions: string[],
  distTags: Record<string, string>,
  includePrerelease: boolean
): UpdateTargets {
  const filteredVersions = versions
    .filter((version) => includePrerelease || semver.prerelease(version) === null)
    .sort(semver.compare);

  const newerVersions = filteredVersions.filter((version) => semver.gt(version, currentVersion));
  if (newerVersions.length === 0) {
    return {
      latest: currentVersion
    };
  }

  const latestTagged = distTags.latest;
  const taggedLatest = latestTagged &&
    semver.valid(latestTagged) &&
    (includePrerelease || semver.prerelease(latestTagged) === null) &&
    semver.gt(latestTagged, currentVersion)
    ? latestTagged
    : undefined;
  const latest = taggedLatest ?? newerVersions[newerVersions.length - 1];
  const patch = pickLast(newerVersions.filter((version) => semver.diff(currentVersion, version) === "patch"));
  const minor = pickLast(
    newerVersions.filter((version) => {
      const diff = normalizeDiff(currentVersion, version);
      return diff === "minor";
    })
  );
  const major = pickLast(
    newerVersions.filter((version) => {
      const diff = normalizeDiff(currentVersion, version);
      return diff === "major";
    })
  );

  return {
    latest,
    patch,
    minor,
    major
  };
}

function pickLast(values: string[]): string | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function normalizeDiff(currentVersion: string, nextVersion: string): string | null {
  const diff = semver.diff(currentVersion, nextVersion);
  switch (diff) {
    case "patch":
    case "minor":
    case "major":
      return diff;
    case "prepatch":
      return "patch";
    case "preminor":
      return "minor";
    case "premajor":
      return "major";
    case "prerelease":
      return "patch";
    default:
      return diff;
  }
}

export function buildNextSpec(currentSpec: string, targetVersion: string): string {
  const descriptor = parseSpecDescriptor(currentSpec);
  if (!descriptor) {
    return targetVersion;
  }

  const version = descriptor.versionPrefix ? `v${targetVersion}` : targetVersion;
  return `${descriptor.rangePrefix}${version}`;
}

interface SpecDescriptor {
  rangePrefix: "" | "^" | "~" | "=";
  versionPrefix: boolean;
}

function parseSpecDescriptor(spec: string): SpecDescriptor | undefined {
  const trimmed = spec.trim();
  const match = /^(?<rangePrefix>\^|~|=)?(?<versionPrefix>v)?(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(trimmed);
  if (!match?.groups) {
    return undefined;
  }

  return {
    rangePrefix: (match.groups.rangePrefix ?? "") as SpecDescriptor["rangePrefix"],
    versionPrefix: Boolean(match.groups.versionPrefix)
  };
}

export function getTargetForMode(
  state: ResolvedDependencyState,
  mode: UpdateMode
): string | undefined {
  if (state.kind !== "ready") {
    return undefined;
  }

  return state.targets?.[mode];
}
