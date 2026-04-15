import * as semver from "semver";
import * as vscode from "vscode";
import { getSettings } from "./config";
import type { ManifestProvider } from "./manifests";
import { getManifestProvider } from "./manifests";
import { buildNextSpec, NpmRegistryClient, getTargetForMode } from "./npmRegistry";
import type {
  DependencyEntry,
  ResolvedDependencyState,
  Snapshot,
  UpdateDependencyCommandArgs,
  UpdateMode,
  UpdatePlanItem
} from "./types";

export class FastVersionLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly busyEmitter = new vscode.EventEmitter<boolean>();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private activeRefreshCount = 0;

  readonly onDidChangeCodeLenses = this.emitter.event;
  readonly onDidChangeBusyState = this.busyEmitter.event;

  constructor(
    private readonly registryClient: NpmRegistryClient,
    private readonly manifestProviders: readonly ManifestProvider[],
    private readonly isVisible: () => boolean,
    private readonly includePrerelease: () => boolean
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.handleDocumentChange(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.snapshots.delete(document.uri.toString());
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("versionLensFast")) {
          this.clear();
        }
      })
    );
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const manifestProvider = getManifestProvider(document, this.manifestProviders);
    if (!this.isVisible() || !manifestProvider) {
      return [];
    }

    const snapshot = this.getSnapshot(document, manifestProvider);
    this.scheduleRefresh(document, snapshot);

    return snapshot.dependencies.flatMap((entry) =>
      this.createCodeLenses(document, entry, snapshot.states.get(entry.id), manifestProvider)
    );
  }

  dispose(): void {
    this.clear();
    vscode.Disposable.from(...this.disposables).dispose();
    this.busyEmitter.dispose();
    this.emitter.dispose();
  }

  clear(): void {
    this.snapshots.clear();
    this.registryClient.clear();
    this.emitter.fire();
  }

  invalidate(uri: string): void {
    this.snapshots.delete(uri);
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  softRefresh(): void {
    for (const snapshot of this.snapshots.values()) {
      snapshot.needsBackgroundRefresh = true;
    }
    this.emitter.fire();
  }

  get isBusy(): boolean {
    return this.activeRefreshCount > 0;
  }

  async resolveForBulkUpdate(document: vscode.TextDocument): Promise<UpdatePlanItem[]> {
    const manifestProvider = getManifestProvider(document, this.manifestProviders);
    if (!manifestProvider) {
      return [];
    }

    const snapshot = this.getSnapshot(document, manifestProvider);
    await this.refreshSnapshot(document, snapshot);

    const updates: UpdatePlanItem[] = [];
    for (const entry of snapshot.dependencies) {
      const state = snapshot.states.get(entry.id);
      if (state?.kind !== "ready") {
        continue;
      }

      updates.push({
        entry,
        version: state.latestVersion ?? ""
      });
    }

    return updates;
  }

  async getPlanForMode(
    document: vscode.TextDocument,
    mode: UpdateMode
  ): Promise<UpdatePlanItem[]> {
    const manifestProvider = getManifestProvider(document, this.manifestProviders);
    if (!manifestProvider) {
      return [];
    }

    const snapshot = this.getSnapshot(document, manifestProvider);
    await this.refreshSnapshot(document, snapshot);

    return snapshot.dependencies.flatMap((entry) => {
      const state = snapshot.states.get(entry.id);
      const target = state ? getTargetForMode(state, mode) : undefined;
      if (!target || target === entry.spec || target === "") {
        return [];
      }

      const nextSpec = buildNextSpec(entry.spec, target);
      if (nextSpec === entry.spec) {
        return [];
      }

      return [{ entry, version: target }];
    });
  }

  private getSnapshot(document: vscode.TextDocument, manifestProvider: ManifestProvider): Snapshot {
    const uri = document.uri.toString();
    const existing = this.snapshots.get(uri);
    if (existing && existing.documentVersion === document.version) {
      return existing;
    }

    if (existing) {
      return this.reconcileSnapshot(existing, document, manifestProvider);
    }

    const dependencies = manifestProvider.parse(document);
    const states = new Map<string, ResolvedDependencyState>();
    const dirtyDependencyIds = new Set<string>();
    for (const dependency of dependencies) {
      states.set(
        dependency.id,
        dependency.spec
          ? { kind: "loading" }
          : { kind: "unsupported", detail: "Non-string dependency" }
      );
      dirtyDependencyIds.add(dependency.id);
    }

    const snapshot: Snapshot = {
      documentUri: uri,
      documentVersion: document.version,
      dependencies,
      states,
      dirtyDependencyIds,
      needsBackgroundRefresh: false,
      refreshing: false
    };

    this.snapshots.set(uri, snapshot);
    return snapshot;
  }

  private scheduleRefresh(document: vscode.TextDocument, snapshot: Snapshot): void {
    if (snapshot.refreshing) {
      return;
    }

    if (snapshot.dirtyDependencyIds.size > 0) {
      void this.refreshSnapshot(document, snapshot);
      return;
    }

    if (snapshot.needsBackgroundRefresh) {
      void this.refreshSnapshot(document, snapshot);
      return;
    }

    const isFresh = snapshot.lastResolvedAt && Date.now() - snapshot.lastResolvedAt < getSettings().cacheTtlMs;
    if (isFresh) {
      return;
    }

    void this.refreshSnapshot(document, snapshot);
  }

  private async refreshSnapshot(document: vscode.TextDocument, snapshot: Snapshot): Promise<void> {
    if (snapshot.refreshing) {
      return;
    }

    snapshot.refreshing = true;
    this.beginRefresh();
    const settings = getSettings();
    const includePrerelease = this.includePrerelease();
    const shouldRefreshAll = snapshot.needsBackgroundRefresh;
    const entriesToRefresh = shouldRefreshAll
      ? snapshot.dependencies
      : snapshot.dependencies.filter((entry) => {
          return (
            snapshot.dirtyDependencyIds.has(entry.id) ||
            snapshot.states.get(entry.id)?.kind === "loading"
          );
        });

    if (entriesToRefresh.length === 0) {
      snapshot.needsBackgroundRefresh = false;
      snapshot.lastResolvedAt = Date.now();
      snapshot.refreshing = false;
      this.endRefresh();
      return;
    }

    try {
      await runWithConcurrency(settings.maxConcurrentRequests, entriesToRefresh, async (entry) => {
        try {
          const state = await this.registryClient.resolveDependency(
            entry,
            includePrerelease,
            document.fileName
          );
          snapshot.states.set(entry.id, state);
          snapshot.dirtyDependencyIds.delete(entry.id);
        } catch (error) {
          snapshot.states.set(entry.id, {
            kind: "error",
            detail: error instanceof Error ? error.message : "Registry error"
          });
          snapshot.dirtyDependencyIds.delete(entry.id);
        }
      });

      snapshot.needsBackgroundRefresh = false;
      snapshot.lastResolvedAt = Date.now();
    } finally {
      snapshot.refreshing = false;
      this.endRefresh();

      const current = this.snapshots.get(document.uri.toString());
      if (current && current.documentVersion === snapshot.documentVersion) {
        this.emitter.fire();
      }
    }
  }

  private handleDocumentChange(document: vscode.TextDocument): void {
    const manifestProvider = getManifestProvider(document, this.manifestProviders);
    if (!manifestProvider) {
      this.invalidate(document.uri.toString());
      return;
    }

    this.getSnapshot(document, manifestProvider);
    this.emitter.fire();
  }

  private reconcileSnapshot(
    existing: Snapshot,
    document: vscode.TextDocument,
    manifestProvider: ManifestProvider
  ): Snapshot {
    const dependencies = manifestProvider.parse(document);
    const nextStates = new Map<string, ResolvedDependencyState>();
    const dirtyDependencyIds = new Set<string>();
    const previousEntries = new Map(existing.dependencies.map((entry) => [entry.id, entry]));

    for (const dependency of dependencies) {
      const previousEntry = previousEntries.get(dependency.id);
      const previousState = existing.states.get(dependency.id);

      if (previousEntry && previousEntry.spec === dependency.spec && previousState) {
        nextStates.set(dependency.id, previousState);
        if (existing.dirtyDependencyIds.has(dependency.id)) {
          dirtyDependencyIds.add(dependency.id);
        }
        continue;
      }

      nextStates.set(
        dependency.id,
        dependency.spec
          ? { kind: "loading" }
          : { kind: "unsupported", detail: "Non-string dependency" }
      );
      dirtyDependencyIds.add(dependency.id);
    }

    const snapshot: Snapshot = {
      documentUri: document.uri.toString(),
      documentVersion: document.version,
      dependencies,
      states: nextStates,
      dirtyDependencyIds,
      needsBackgroundRefresh: false,
      refreshing: false,
      lastResolvedAt: dirtyDependencyIds.size > 0 ? undefined : existing.lastResolvedAt
    };

    this.snapshots.set(document.uri.toString(), snapshot);
    return snapshot;
  }

  private beginRefresh(): void {
    this.activeRefreshCount += 1;
    if (this.activeRefreshCount === 1) {
      this.busyEmitter.fire(true);
    }
  }

  private endRefresh(): void {
    this.activeRefreshCount = Math.max(0, this.activeRefreshCount - 1);
    if (this.activeRefreshCount === 0) {
      this.busyEmitter.fire(false);
    }
  }

  private createCodeLenses(
    document: vscode.TextDocument,
    entry: DependencyEntry,
    state: ResolvedDependencyState | undefined,
    manifestProvider: ManifestProvider
  ): vscode.CodeLens[] {
    const line = manifestProvider.getLensLine(document, entry);
    const range = new vscode.Range(line, 0, line, 0);

    if (!state || state.kind === "loading") {
      return [this.createPassiveLens(range, "Checking latest version...")];
    }

    if (state.kind === "unsupported") {
      return [this.createPassiveLens(range, state.detail ?? "Unsupported dependency spec")];
    }

    if (state.kind === "error") {
      return [this.createPassiveLens(range, `Registry error: ${state.detail ?? "unknown"}`)];
    }

    const currentVersion = semverVersionFromSpec(entry.spec);
    const targetVersion = state.targets?.latest;
    if (!targetVersion || targetVersion === currentVersion) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    for (const mode of ["patch", "minor", "major", "latest"] as const) {
      const version = state.targets?.[mode];
      if (!version || version === currentVersion) {
        continue;
      }

      lenses.push(
        this.createActionLens(
          range,
          `${mode} ${version}`,
          document,
          entry,
          version
        )
      );
    }

    return lenses;
  }

  private createPassiveLens(range: vscode.Range, title: string): vscode.CodeLens {
    const lens = new vscode.CodeLens(range);
    lens.command = {
      title,
      command: ""
    };
    return lens;
  }

  private createActionLens(
    range: vscode.Range,
    title: string,
    document: vscode.TextDocument,
    entry: DependencyEntry,
    targetVersion: string
  ): vscode.CodeLens {
    const lens = new vscode.CodeLens(range);
    lens.command = {
      title,
      command: "versionLensFast.updateDependency",
      arguments: [
        {
          documentUri: document.uri.toString(),
          section: entry.section,
          name: entry.name,
          targetVersion
        } satisfies UpdateDependencyCommandArgs
      ]
    };
    return lens;
  }
}

function semverVersionFromSpec(spec: string): string | undefined {
  return semver.minVersion(spec)?.version;
}

async function runWithConcurrency<T>(
  limit: number,
  items: readonly T[],
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }

      await worker(item);
    }
  });

  await Promise.all(workers);
}
