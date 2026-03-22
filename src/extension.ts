import * as vscode from "vscode";
import { getSettings, prereleaseStateKey, visibilityStateKey } from "./config";
import { PackageJsonManifestProvider } from "./manifests";
import { buildNextSpec, NpmRegistryClient } from "./npmRegistry";
import {
  createDependencyVersionRange,
  findDependencyEntry,
  getDocumentContext,
  isSupportedPackageJsonDocument,
  sortDependencySections
} from "./packageJson";
import { FastVersionLensProvider } from "./provider";
import type { UpdateDependencyCommandArgs, UpdateMode } from "./types";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const registryClient = new NpmRegistryClient();
  const manifestProviders = [new PackageJsonManifestProvider()] as const;
  const provider = new FastVersionLensProvider(
    registryClient,
    manifestProviders,
    () => isVisible(context),
    () => includePrerelease(context)
  );

  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider(
      [
        { language: "json", scheme: "file" },
        { language: "jsonc", scheme: "file" }
      ],
      provider
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void updateContextKeys(context);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("versionLensFast")) {
        void updateContextKeys(context);
      }
    }),
    provider.onDidChangeBusyState(() => {
      void updateContextKeys(context, provider);
    }),
    vscode.commands.registerCommand("versionLensFast.refreshing", () => {
      return undefined;
    }),
    vscode.commands.registerCommand("versionLensFast.toggle", async () => {
      const nextVisible = !isVisible(context);
      await context.workspaceState.update(visibilityStateKey, nextVisible);
      await updateContextKeys(context, provider);
      if (nextVisible) {
        provider.softRefresh();
        provider.refresh();
      } else {
        provider.refresh();
      }
    }),
    vscode.commands.registerCommand("versionLensFast.togglePrereleases", async () => {
      await context.workspaceState.update(prereleaseStateKey, !includePrerelease(context));
      await updateContextKeys(context, provider);
      provider.clear();
    }),
    vscode.commands.registerCommand("versionLensFast.clearCache", async () => {
      provider.clear();
      void vscode.window.showInformationMessage("Version Lens Fast cache cleared.");
    }),
    vscode.commands.registerCommand(
      "versionLensFast.updateDependency",
      async (args: UpdateDependencyCommandArgs) => {
        const uri = vscode.Uri.parse(args.documentUri);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const entry = findDependencyEntry(
          editor.document,
          args.section,
          args.name,
          getSettings().sections
        );
        if (!entry) {
          return;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          editor.document.uri,
          createDependencyVersionRange(editor.document, entry),
          JSON.stringify(buildNextSpec(entry.spec, args.targetVersion))
        );
        await vscode.workspace.applyEdit(edit);
      }
    ),
    vscode.commands.registerCommand("versionLensFast.updateAllLatest", async () => {
      await bulkUpdate(provider, "latest");
    }),
    vscode.commands.registerCommand("versionLensFast.updateAllMajor", async () => {
      await bulkUpdate(provider, "major");
    }),
    vscode.commands.registerCommand("versionLensFast.updateAllMinor", async () => {
      await bulkUpdate(provider, "minor");
    }),
    vscode.commands.registerCommand("versionLensFast.updateAllPatch", async () => {
      await bulkUpdate(provider, "patch");
    }),
    vscode.commands.registerCommand("versionLensFast.sortDependencies", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedPackageJsonDocument(editor.document)) {
        return;
      }

      const contextInfo = getDocumentContext(editor.document);
      const settings = getSettings();
      const result = sortDependencySections(
        editor.document.getText(),
        settings.sections,
        contextInfo.formatting
      );

      if (!result.changed) {
        void vscode.window.showInformationMessage("Dependencies are already sorted.");
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      const endPosition = editor.document.positionAt(editor.document.getText().length);
      edit.replace(
        editor.document.uri,
        new vscode.Range(new vscode.Position(0, 0), endPosition),
        result.text
      );
      await vscode.workspace.applyEdit(edit);
    })
  );

  await updateContextKeys(context, provider);
}

export function deactivate(): void {}

async function bulkUpdate(provider: FastVersionLensProvider, mode: UpdateMode): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSupportedPackageJsonDocument(editor.document)) {
    return;
  }

  const plan = await provider.getPlanForMode(editor.document, mode);
  if (plan.length === 0) {
    void vscode.window.showInformationMessage(`No ${mode} updates available.`);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const item of plan) {
    edit.replace(
      editor.document.uri,
      createDependencyVersionRange(editor.document, item.entry),
      JSON.stringify(buildNextSpec(item.entry.spec, item.version))
    );
  }

  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(`Updated ${plan.length} dependencies (${mode}).`);
}

async function updateContextKeys(
  context: vscode.ExtensionContext,
  provider?: FastVersionLensProvider
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  const supportedEditor = Boolean(activeEditor && isSupportedPackageJsonDocument(activeEditor.document));

  await vscode.commands.executeCommand("setContext", "versionLensFast.supportedEditor", supportedEditor);
  await vscode.commands.executeCommand("setContext", "versionLensFast.visible", isVisible(context));
  await vscode.commands.executeCommand("setContext", "versionLensFast.busy", provider?.isBusy ?? false);
  await vscode.commands.executeCommand(
    "setContext",
    "versionLensFast.prereleases",
    includePrerelease(context)
  );
}

function isVisible(context: vscode.ExtensionContext): boolean {
  const stored = context.workspaceState.get<boolean>(visibilityStateKey);
  if (typeof stored === "boolean") {
    return stored;
  }

  return getSettings().showOnStartup;
}

function includePrerelease(context: vscode.ExtensionContext): boolean {
  const stored = context.workspaceState.get<boolean>(prereleaseStateKey);
  if (typeof stored === "boolean") {
    return stored;
  }

  return getSettings().includePrerelease;
}
