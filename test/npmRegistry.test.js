const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  installMockVscode,
  resetModules,
  clearMockVscode
} = require("./helpers/mockVscode");

const registryModulePath = "../dist/npmRegistry.js";
const configModulePath = "../dist/config.js";

test.afterEach(() => {
  clearMockVscode();
  resetModules(registryModulePath, configModulePath);
  delete global.fetch;
});

test("resolveDependency uses dist-tag latest and caches packuments", async () => {
  installMockVscode();
  resetModules(registryModulePath, configModulePath);
  const { NpmRegistryClient } = require(registryModulePath);

  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      async json() {
        return {
          "dist-tags": { latest: "2.0.0" },
          versions: {
            "1.0.0": {},
            "1.1.0": {},
            "2.0.0": {}
          }
        };
      }
    };
  };

  const client = new NpmRegistryClient();
  const entry = {
    id: "dependencies:demo",
    section: "dependencies",
    name: "demo",
    spec: "^1.0.0",
    propertyOffset: 0,
    valueOffset: 0,
    valueLength: 8
  };

  const first = await client.resolveDependency(entry, false);
  const second = await client.resolveDependency(entry, false);

  assert.equal(fetchCount, 1);
  assert.equal(first.kind, "ready");
  assert.equal(first.latestVersion, "2.0.0");
  assert.deepEqual(first.targets, {
    latest: "2.0.0",
    patch: undefined,
    minor: "1.1.0",
    major: "2.0.0"
  });
  assert.deepEqual(second, first);
});

test("buildNextSpec preserves prefix and unsupported specs short-circuit", async () => {
  installMockVscode();
  resetModules(registryModulePath, configModulePath);
  const { buildNextSpec, NpmRegistryClient } = require(registryModulePath);

  assert.equal(buildNextSpec("^1.2.3", "2.0.0"), "^2.0.0");
  assert.equal(buildNextSpec("~v1.2.3", "1.3.0"), "~v1.3.0");
  assert.equal(buildNextSpec("workspace:*", "2.0.0"), "2.0.0");

  const client = new NpmRegistryClient();
  const unsupported = await client.resolveDependency({
    id: "dependencies:demo",
    section: "dependencies",
    name: "demo",
    spec: "workspace:*",
    propertyOffset: 0,
    valueOffset: 0,
    valueLength: 8
  }, false);

  assert.deepEqual(unsupported, {
    kind: "unsupported",
    detail: "Unsupported spec"
  });
});

test("resolveDependency honors npm userconfig registry and auth token", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "version-lens-fast-npmrc-"));
  const npmrcPath = path.join(tempDir, ".npmrc");
  fs.writeFileSync(
    npmrcPath,
    [
      "registry=http://localhost:4873/",
      "//localhost:4873/:_authToken=local-token"
    ].join("\n"),
    "utf8"
  );

  const originalUserconfig = process.env.npm_config_userconfig;
  try {
    process.env.npm_config_userconfig = npmrcPath;

    installMockVscode();
    resetModules(registryModulePath, configModulePath);
    const { NpmRegistryClient } = require(registryModulePath);

    let capturedRequest;
    global.fetch = async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        async json() {
          return {
            "dist-tags": { latest: "1.2.0" },
            versions: {
              "1.0.0": {},
              "1.2.0": {}
            }
          };
        }
      };
    };

    const client = new NpmRegistryClient();
    const result = await client.resolveDependency({
      id: "dependencies:demo",
      section: "dependencies",
      name: "demo",
      spec: "^1.0.0",
      propertyOffset: 0,
      valueOffset: 0,
      valueLength: 8
    }, false);

    assert.equal(result.kind, "ready");
    assert.equal(capturedRequest.url, "http://localhost:4873/demo");
    assert.equal(capturedRequest.options.headers.Authorization, "Bearer local-token");
  } finally {
    process.env.npm_config_userconfig = originalUserconfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
