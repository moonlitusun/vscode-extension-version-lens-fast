import * as vscode from "vscode";

export const extensionNamespace = "versionLensFast";
export const visibilityStateKey = "versionLensFast.visible";
export const prereleaseStateKey = "versionLensFast.includePrerelease";

export const defaultSections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies"
] as const;

export interface ExtensionSettings {
  showOnStartup: boolean;
  includePrerelease: boolean;
  cacheTtlMs: number;
  registryUrl: string;
  maxConcurrentRequests: number;
  sections: readonly string[];
}

export function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration(extensionNamespace);

  const ttlMinutes = Math.max(1, config.get<number>("cacheTtlMinutes", 5));
  const maxConcurrentRequests = Math.min(
    32,
    Math.max(1, config.get<number>("maxConcurrentRequests", 12))
  );
  const sections = config.get<string[]>("sections", [...defaultSections]).filter(Boolean);

  return {
    showOnStartup: config.get<boolean>("showOnStartup", true),
    includePrerelease: config.get<boolean>("includePrerelease", false),
    cacheTtlMs: ttlMinutes * 60_000,
    registryUrl: config.get<string>("registryUrl", "https://registry.npmjs.org/"),
    maxConcurrentRequests,
    sections: sections.length > 0 ? sections : [...defaultSections]
  };
}
