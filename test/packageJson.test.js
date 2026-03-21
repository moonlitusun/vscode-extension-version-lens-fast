const test = require("node:test");
const assert = require("node:assert/strict");
const {
  installMockVscode,
  resetModules,
  clearMockVscode,
  createTextDocument
} = require("./helpers/mockVscode");

const packageJsonModulePath = "../dist/packageJson.js";
const configModulePath = "../dist/config.js";

test.afterEach(() => {
  clearMockVscode();
  resetModules(packageJsonModulePath, configModulePath);
});

test("parseDependencies extracts package entries and editable ranges", () => {
  installMockVscode();
  resetModules(packageJsonModulePath, configModulePath);
  const {
    parseDependencies,
    findDependencyEntry,
    createDependencyVersionRange
  } = require(packageJsonModulePath);

  const text = `{
  "dependencies": {
    "react": "^18.2.0",
    "lodash": "~4.17.21"
  },
  "devDependencies": {
    "typescript": "5.8.3"
  }
}`;
  const document = createTextDocument({ text });

  const dependencies = parseDependencies(document, ["dependencies", "devDependencies"]);
  assert.equal(dependencies.length, 3);

  const react = findDependencyEntry(document, "dependencies", "react", ["dependencies", "devDependencies"]);
  assert.ok(react);
  assert.equal(react.spec, "^18.2.0");

  const reactRange = createDependencyVersionRange(document, react);
  const startOffset = text.indexOf('"^18.2.0"');
  const endOffset = startOffset + '"^18.2.0"'.length;
  assert.deepEqual(reactRange.start, document.positionAt(startOffset));
  assert.deepEqual(reactRange.end, document.positionAt(endOffset));
});

test("sortDependencySections sorts only configured sections", () => {
  installMockVscode();
  resetModules(packageJsonModulePath, configModulePath);
  const { sortDependencySections } = require(packageJsonModulePath);

  const text = `{
  "dependencies": {
    "zod": "^3.0.0",
    "axios": "^1.0.0"
  },
  "name": "demo"
}`;

  const result = sortDependencySections(text, ["dependencies"], {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n"
  });

  assert.equal(result.changed, true);
  assert.match(result.text, /"axios": "\^1\.0\.0",\n    "zod": "\^3\.0\.0"/);
});
