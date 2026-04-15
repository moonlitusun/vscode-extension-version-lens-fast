import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface NpmRegistryRequestConfig {
  registryUrl: string;
  headers: Record<string, string>;
}

interface ParsedNpmConfig {
  values: Map<string, string>;
}

const defaultRegistryUrl = "https://registry.npmjs.org/";
const authorizationHeaderPrefix = "Bearer ";

export class NpmConfigResolver {
  private readonly cache = new Map<string, Promise<ParsedNpmConfig>>();

  clear(): void {
    this.cache.clear();
  }

  async resolve(
    packageName: string,
    documentPath?: string,
    registryOverride?: string
  ): Promise<NpmRegistryRequestConfig> {
    const config = await this.loadMergedConfig(documentPath);
    const registryUrl = ensureTrailingSlash(
      registryOverride ?? pickRegistryUrl(packageName, config.values) ?? defaultRegistryUrl
    );
    const headers: Record<string, string> = {};
    const authToken = pickAuthToken(registryUrl, config.values);

    if (authToken) {
      headers.Authorization = authToken.startsWith("Bearer ") || authToken.startsWith("Basic ")
        ? authToken
        : `${authorizationHeaderPrefix}${authToken}`;
    }

    return {
      registryUrl,
      headers
    };
  }

  private async loadMergedConfig(documentPath?: string): Promise<ParsedNpmConfig> {
    const cacheKey = documentPath ? path.resolve(path.dirname(documentPath)) : "__no-document__";
    const existing = this.cache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const values = new Map<string, string>();
      const configFiles = collectConfigFiles(documentPath);

      for (const configFile of configFiles) {
        const parsed = await readConfigFile(configFile);
        for (const [key, value] of parsed.values) {
          values.set(key, value);
        }
      }

      const envRegistry = readEnv("npm_config_registry") ?? readEnv("NPM_CONFIG_REGISTRY");
      if (envRegistry) {
        values.set("registry", envRegistry);
      }

      return { values };
    })();

    this.cache.set(cacheKey, promise);
    return promise;
  }
}

function collectConfigFiles(documentPath?: string): string[] {
  const files: string[] = [];
  const userConfig = readEnv("npm_config_userconfig") ?? readEnv("NPM_CONFIG_USERCONFIG");

  if (userConfig) {
    files.push(userConfig);
  } else {
    files.push(path.join(os.homedir(), ".npmrc"));
  }

  if (!documentPath) {
    return files;
  }

  const dirs: string[] = [];
  let currentDir = path.resolve(path.dirname(documentPath));
  while (true) {
    dirs.push(currentDir);
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  for (let index = dirs.length - 1; index >= 0; index -= 1) {
    files.push(path.join(dirs[index], ".npmrc"));
  }

  return files;
}

async function readConfigFile(configPath: string): Promise<ParsedNpmConfig> {
  try {
    const contents = await fs.readFile(configPath, "utf8");
    const values = new Map<string, string>();

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = unquote(trimmed.slice(separatorIndex + 1).trim());
      if (key) {
        values.set(key, value);
      }
    }

    return { values };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { values: new Map() };
    }

    throw error;
  }
}

function pickRegistryUrl(packageName: string, values: Map<string, string>): string | undefined {
  if (packageName.startsWith("@")) {
    const scope = packageName.slice(0, packageName.indexOf("/"));
    const scopedRegistry = values.get(`${scope}:registry`);
    if (scopedRegistry) {
      return scopedRegistry;
    }
  }

  return values.get("registry");
}

function pickAuthToken(registryUrl: string, values: Map<string, string>): string | undefined {
  const registry = new URL(ensureTrailingSlash(registryUrl));
  const registryPath = registry.pathname.endsWith("/") ? registry.pathname : `${registry.pathname}/`;
  const authKey = `//${registry.host}${registryPath}:_authToken`;
  const hostOnlyKey = `//${registry.host}/:_authToken`;

  return (
    values.get(authKey) ??
    values.get(hostOnlyKey) ??
    values.get("_authToken")
  );
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}
