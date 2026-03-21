import * as vscode from "vscode";
import { getSettings } from "./config";
import {
  getLineForDependency,
  isSupportedPackageJsonDocument,
  parseDependencies
} from "./packageJson";
import type { DependencyEntry } from "./types";

export interface ManifestProvider {
  readonly id: string;
  readonly displayName: string;
  supports(document: vscode.TextDocument): boolean;
  parse(document: vscode.TextDocument): DependencyEntry[];
  getLensLine(document: vscode.TextDocument, entry: DependencyEntry): number;
}

export class PackageJsonManifestProvider implements ManifestProvider {
  readonly id = "package-json";
  readonly displayName = "package.json";

  supports(document: vscode.TextDocument): boolean {
    return isSupportedPackageJsonDocument(document);
  }

  parse(document: vscode.TextDocument): DependencyEntry[] {
    return parseDependencies(document, getSettings().sections);
  }

  getLensLine(document: vscode.TextDocument, entry: DependencyEntry): number {
    return getLineForDependency(document, entry);
  }
}

export function getManifestProvider(
  document: vscode.TextDocument,
  providers: readonly ManifestProvider[]
): ManifestProvider | undefined {
  return providers.find((provider) => provider.supports(document));
}
