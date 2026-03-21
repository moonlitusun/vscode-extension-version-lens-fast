import { modify, parse, parseTree } from "jsonc-parser";
import type { Edit } from "jsonc-parser";
import * as vscode from "vscode";
import type {
  DependencyEntry,
  DocumentContext,
  PackageJsonFormattingOptions,
  SortResult
} from "./types";

export function isSupportedPackageJsonDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file") {
    return false;
  }

  const fileName = document.fileName.replace(/\\/g, "/");
  return fileName.endsWith("/package.json");
}

export function getDocumentContext(document: vscode.TextDocument): DocumentContext {
  const matchingEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === document.uri.toString()
  );
  const editorConfig = vscode.workspace.getConfiguration("editor", document.uri);
  const insertSpaces = matchingEditor?.options.insertSpaces;
  const tabSize = matchingEditor?.options.tabSize;

  return {
    document,
    formatting: {
      insertSpaces: typeof insertSpaces === "boolean"
        ? insertSpaces
        : editorConfig.get<boolean>("insertSpaces", true),
      tabSize: typeof tabSize === "number"
        ? tabSize
        : editorConfig.get<number>("tabSize", 2),
      eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n"
    }
  };
}

export function parseDependencies(
  document: vscode.TextDocument,
  sections: readonly string[]
): DependencyEntry[] {
  const root = parseTree(document.getText());
  if (!root || root.type !== "object" || !root.children) {
    return [];
  }

  const allowedSections = new Set(sections);
  const dependencies: DependencyEntry[] = [];

  for (const sectionProperty of root.children) {
    const keyNode = sectionProperty.children?.[0];
    const valueNode = sectionProperty.children?.[1];
    if (!keyNode || !valueNode || keyNode.type !== "string") {
      continue;
    }

    const sectionName = String(keyNode.value ?? "");
    if (!allowedSections.has(sectionName) || valueNode.type !== "object" || !valueNode.children) {
      continue;
    }

    for (const dependencyProperty of valueNode.children) {
      const dependencyNameNode = dependencyProperty.children?.[0];
      const dependencyValueNode = dependencyProperty.children?.[1];
      if (!dependencyNameNode || dependencyNameNode.type !== "string" || !dependencyValueNode) {
        continue;
      }

      const dependencyName = String(dependencyNameNode.value ?? "");
      if (dependencyValueNode.type !== "string") {
        dependencies.push({
          id: `${sectionName}:${dependencyName}`,
          section: sectionName,
          name: dependencyName,
          spec: "",
          propertyOffset: dependencyProperty.offset,
          valueOffset: dependencyValueNode.offset,
          valueLength: dependencyValueNode.length
        });
        continue;
      }

      dependencies.push({
        id: `${sectionName}:${dependencyName}`,
        section: sectionName,
        name: dependencyName,
        spec: String(dependencyValueNode.value ?? ""),
        propertyOffset: dependencyProperty.offset,
        valueOffset: dependencyValueNode.offset,
        valueLength: dependencyValueNode.length
      });
    }
  }

  return dependencies;
}

export function applyDependencyVersionUpdate(
  text: string,
  entry: DependencyEntry,
  nextSpec: string,
  formatting: PackageJsonFormattingOptions
): string {
  const edits = modify(text, [entry.section, entry.name], nextSpec, {
    formattingOptions: {
      insertSpaces: formatting.insertSpaces,
      tabSize: formatting.tabSize
    }
  });

  return applyJsonEdits(text, edits);
}

export function sortDependencySections(
  text: string,
  sections: readonly string[],
  formatting: PackageJsonFormattingOptions
): SortResult {
  const packageJson = parse(text) as Record<string, unknown>;
  if (!packageJson || typeof packageJson !== "object") {
    return { text, changed: false };
  }

  let nextText = text;
  let changed = false;

  for (const section of sections) {
    const value = packageJson[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const sortedEntries = [...entries].sort(([left], [right]) => left.localeCompare(right));
    const sameOrder = entries.every(([name], index) => name === sortedEntries[index]?.[0]);
    if (sameOrder) {
      continue;
    }

    changed = true;
    nextText = applyJsonEdits(
      nextText,
      modify(
        nextText,
        [section],
        Object.fromEntries(sortedEntries),
        {
          formattingOptions: {
            insertSpaces: formatting.insertSpaces,
            tabSize: formatting.tabSize
          }
        }
      )
    );
  }

  return { text: nextText, changed };
}

function applyJsonEdits(text: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((left, right) => right.offset - left.offset)
    .reduce((currentText, edit) => {
      return (
        currentText.slice(0, edit.offset) +
        edit.content +
        currentText.slice(edit.offset + edit.length)
      );
    }, text);
}

export function getLineForDependency(document: vscode.TextDocument, entry: DependencyEntry): number {
  return document.positionAt(entry.propertyOffset).line;
}

export function createDependencyVersionRange(
  document: vscode.TextDocument,
  entry: DependencyEntry
): vscode.Range {
  return new vscode.Range(
    document.positionAt(entry.valueOffset),
    document.positionAt(entry.valueOffset + entry.valueLength)
  );
}

export function findDependencyEntry(
  document: vscode.TextDocument,
  section: string,
  name: string,
  sections: readonly string[]
): DependencyEntry | undefined {
  return parseDependencies(document, sections).find(
    (entry) => entry.section === section && entry.name === name
  );
}
