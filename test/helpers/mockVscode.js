const mock = require("mock-require");

function installMockVscode(options = {}) {
  const listeners = {
    changeTextDocument: [],
    closeTextDocument: [],
    changeConfiguration: []
  };

  const config = {
    versionLensFast: {
      showOnStartup: true,
      includePrerelease: false,
      cacheTtlMinutes: 5,
      registryUrl: "https://registry.npmjs.org/",
      maxConcurrentRequests: 12,
      sections: [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
        "bundledDependencies",
        "bundleDependencies"
      ],
      ...(options.versionLensFast ?? {})
    },
    editor: {
      insertSpaces: true,
      tabSize: 2,
      ...(options.editor ?? {})
    }
  };

  class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return {
          dispose: () => {
            this.listeners = this.listeners.filter((candidate) => candidate !== listener);
          }
        };
      };
    }

    fire(value) {
      for (const listener of [...this.listeners]) {
        listener(value);
      }
    }

    dispose() {
      this.listeners = [];
    }
  }

  class Disposable {
    constructor(dispose = () => {}) {
      this.dispose = dispose;
    }

    static from(...disposables) {
      return new Disposable(() => {
        for (const disposable of disposables) {
          disposable?.dispose?.();
        }
      });
    }
  }

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Range {
    constructor(start, end, endLine, endCharacter) {
      if (
        start &&
        end &&
        typeof start.line === "number" &&
        typeof start.character === "number" &&
        typeof end.line === "number" &&
        typeof end.character === "number"
      ) {
        this.start = start;
        this.end = end;
        return;
      }

      this.start = new Position(start, end);
      this.end = new Position(endLine, endCharacter);
    }
  }

  class CodeLens {
    constructor(range) {
      this.range = range;
      this.command = undefined;
    }
  }

  const vscode = {
    workspace: {
      getConfiguration(section) {
        const values = config[section] ?? {};
        return {
          get(key, fallback) {
            return key in values ? values[key] : fallback;
          }
        };
      },
      onDidChangeTextDocument(listener) {
        listeners.changeTextDocument.push(listener);
        return new Disposable(() => {
          listeners.changeTextDocument = listeners.changeTextDocument.filter((item) => item !== listener);
        });
      },
      onDidCloseTextDocument(listener) {
        listeners.closeTextDocument.push(listener);
        return new Disposable(() => {
          listeners.closeTextDocument = listeners.closeTextDocument.filter((item) => item !== listener);
        });
      },
      onDidChangeConfiguration(listener) {
        listeners.changeConfiguration.push(listener);
        return new Disposable(() => {
          listeners.changeConfiguration = listeners.changeConfiguration.filter((item) => item !== listener);
        });
      },
      applyEdit: options.applyEdit ?? (async () => true)
    },
    window: {
      visibleTextEditors: options.visibleTextEditors ?? []
    },
    EndOfLine: {
      LF: 1,
      CRLF: 2
    },
    EventEmitter,
    Disposable,
    Position,
    Range,
    CodeLens
  };

  mock("vscode", vscode);

  return {
    vscode,
    fireTextDocumentChange(document) {
      for (const listener of listeners.changeTextDocument) {
        listener({ document });
      }
    },
    fireConfigurationChange(event) {
      for (const listener of listeners.changeConfiguration) {
        listener(event);
      }
    }
  };
}

function resetModules(...modulePaths) {
  for (const modulePath of modulePaths) {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {
      // ignore missing cache entries
    }
  }
}

function clearMockVscode() {
  mock.stop("vscode");
}

function createTextDocument({
  text,
  uri = "file:///workspace/package.json",
  fileName = "/workspace/package.json",
  version = 1,
  eol = 1
}) {
  return {
    uri: {
      scheme: "file",
      toString: () => uri,
      fsPath: fileName
    },
    fileName,
    version,
    eol,
    getText: () => text,
    positionAt(offset) {
      const slice = text.slice(0, offset);
      const lines = slice.split("\n");
      return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length
      };
    }
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  installMockVscode,
  resetModules,
  clearMockVscode,
  createTextDocument,
  flushAsyncWork
};
