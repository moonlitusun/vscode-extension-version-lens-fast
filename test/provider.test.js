const test = require("node:test");
const assert = require("node:assert/strict");
const {
  installMockVscode,
  resetModules,
  clearMockVscode,
  flushAsyncWork
} = require("./helpers/mockVscode");

const providerModulePath = "../dist/provider.js";
const configModulePath = "../dist/config.js";

test.afterEach(() => {
  clearMockVscode();
  resetModules(providerModulePath, configModulePath);
});

test("provider preserves unchanged dependency state and only refreshes dirty entries", async () => {
  const vscodeMock = installMockVscode({
    versionLensFast: {
      cacheTtlMinutes: 5
    }
  });
  resetModules(providerModulePath, configModulePath);
  const { FastVersionLensProvider } = require(providerModulePath);

  const resolveCalls = [];
  const registryClient = {
    clear() {},
    async resolveDependency(entry) {
      resolveCalls.push(`${entry.id}:${entry.spec}`);
      return {
        kind: "ready",
        latestVersion: entry.spec === "^2.0.0" ? "3.0.0" : "2.0.0",
        latestKind: "major",
        targets: {
          latest: entry.spec === "^2.0.0" ? "3.0.0" : "2.0.0",
          major: entry.spec === "^2.0.0" ? "3.0.0" : "2.0.0"
        }
      };
    }
  };

  const manifestProvider = {
    id: "fake",
    displayName: "fake",
    supports: () => true,
    parse: (document) => document.dependencies,
    getLensLine: (_document, entry) => entry.propertyOffset
  };

  const provider = new FastVersionLensProvider(
    registryClient,
    [manifestProvider],
    () => true,
    () => false
  );

  const firstDocument = {
    uri: { toString: () => "file:///workspace/package.json" },
    version: 1,
    dependencies: [
      { id: "dependencies:a", section: "dependencies", name: "a", spec: "^1.0.0", propertyOffset: 1, valueOffset: 1, valueLength: 1 },
      { id: "dependencies:b", section: "dependencies", name: "b", spec: "^1.0.0", propertyOffset: 2, valueOffset: 2, valueLength: 1 }
    ]
  };

  provider.provideCodeLenses(firstDocument, {});
  await flushAsyncWork();
  assert.deepEqual(resolveCalls, [
    "dependencies:a:^1.0.0",
    "dependencies:b:^1.0.0"
  ]);

  const secondDocument = {
    ...firstDocument,
    version: 2,
    dependencies: [
      { id: "dependencies:a", section: "dependencies", name: "a", spec: "^2.0.0", propertyOffset: 1, valueOffset: 1, valueLength: 1 },
      { id: "dependencies:b", section: "dependencies", name: "b", spec: "^1.0.0", propertyOffset: 2, valueOffset: 2, valueLength: 1 }
    ]
  };

  vscodeMock.fireTextDocumentChange(secondDocument);
  const snapshotAfterChange = provider.snapshots.get("file:///workspace/package.json");
  assert.deepEqual([...snapshotAfterChange.dirtyDependencyIds], ["dependencies:a"]);

  provider.provideCodeLenses(secondDocument, {});
  await flushAsyncWork();
  assert.deepEqual(resolveCalls, [
    "dependencies:a:^1.0.0",
    "dependencies:b:^1.0.0",
    "dependencies:a:^2.0.0"
  ]);
});

test("provider does not eagerly re-refresh fresh snapshots within cache ttl", async () => {
  installMockVscode({
    versionLensFast: {
      cacheTtlMinutes: 5
    }
  });
  resetModules(providerModulePath, configModulePath);
  const { FastVersionLensProvider } = require(providerModulePath);

  let resolveCount = 0;
  const registryClient = {
    clear() {},
    async resolveDependency() {
      resolveCount += 1;
      return {
        kind: "ready",
        latestVersion: "2.0.0",
        latestKind: "major",
        targets: { latest: "2.0.0", major: "2.0.0" }
      };
    }
  };

  const manifestProvider = {
    id: "fake",
    displayName: "fake",
    supports: () => true,
    parse: (document) => document.dependencies,
    getLensLine: (_document, entry) => entry.propertyOffset
  };

  const provider = new FastVersionLensProvider(
    registryClient,
    [manifestProvider],
    () => true,
    () => false
  );

  const document = {
    uri: { toString: () => "file:///workspace/package.json" },
    version: 1,
    dependencies: [
      { id: "dependencies:a", section: "dependencies", name: "a", spec: "^1.0.0", propertyOffset: 1, valueOffset: 1, valueLength: 1 }
    ]
  };

  provider.provideCodeLenses(document, {});
  await flushAsyncWork();
  assert.equal(resolveCount, 1);

  provider.provideCodeLenses(document, {});
  await flushAsyncWork();
  assert.equal(resolveCount, 1);
});
