import * as vscode from "vscode";

export type UpdateMode = "latest" | "major" | "minor" | "patch";

export interface DependencyEntry {
  id: string;
  section: string;
  name: string;
  spec: string;
  propertyOffset: number;
  valueOffset: number;
  valueLength: number;
}

export interface UpdateTargets {
  latest?: string;
  major?: string;
  minor?: string;
  patch?: string;
}

export interface ResolvedDependencyState {
  kind: "loading" | "ready" | "unsupported" | "error";
  latestVersion?: string;
  latestKind?: string;
  targets?: UpdateTargets;
  detail?: string;
}

export interface Snapshot {
  documentUri: string;
  documentVersion: number;
  dependencies: DependencyEntry[];
  states: Map<string, ResolvedDependencyState>;
  dirtyDependencyIds: Set<string>;
  needsBackgroundRefresh: boolean;
  refreshing: boolean;
  lastResolvedAt?: number;
}

export interface UpdateDependencyCommandArgs {
  documentUri: string;
  section: string;
  name: string;
  targetVersion: string;
}

export interface UpdatePlanItem {
  entry: DependencyEntry;
  version: string;
}

export interface PackageJsonFormattingOptions {
  insertSpaces: boolean;
  tabSize: number;
  eol: string;
}

export interface SortResult {
  text: string;
  changed: boolean;
}

export interface DocumentContext {
  document: vscode.TextDocument;
  formatting: PackageJsonFormattingOptions;
}
