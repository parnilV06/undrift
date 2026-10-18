import { describe, expect, it } from "vitest";
import {
  computeContentHash,
  DEFAULT_EXCLUDE_GLOBS,
  extensionToLanguageId,
  isPathExcluded,
  isSupportedSourceFile,
  SUPPORTED_EXTENSIONS,
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike
} from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";
import {
  WorkspaceManager,
  WorkspaceSourceSnapshotProvider
} from "../../apps/vscode-extension/src/workspace";

// Helper to create simple UriLike objects
function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "/")
  };
}

// Helper to create mock OpenDocumentAccessor
function makeOpenDoc(
  uriStr: string,
  text: string,
  options?: { languageId?: string; version?: number; isDirty?: boolean; mutateOnRead?: boolean }
): OpenDocumentAccessor {
  let currentVersion = options?.version ?? 1;
  return {
    uri: makeUri(uriStr),
    languageId: options?.languageId ?? extensionToLanguageId(uriStr),
    get version() {
      return currentVersion;
    },
    isDirty: options?.isDirty ?? false,
    getText: () => {
      if (options?.mutateOnRead) {
        currentVersion += 1;
      }
      return text;
    }
  };
}

// Helper to create mock WorkspaceAccessor
function createMockAccessor(params: {
  folders?: string[];
  diskFiles?: Record<string, string | Error>;
  openDocuments?: OpenDocumentAccessor[];
  filesExclude?: Record<string, boolean>;
  searchExclude?: Record<string, boolean>;
  findFilesError?: Error;
}): WorkspaceAccessor {
  const folders: WorkspaceFolderLike[] | undefined = params.folders?.map((uriStr, index) => ({
    uri: makeUri(uriStr),
    name: `folder-${index}`,
    index
  }));

  const diskFiles = new Map<string, string | Error>(Object.entries(params.diskFiles ?? {}));

  return {
    getWorkspaceFolders: () => folders,
    findFiles: async (_includePattern, _excludePattern) => {
      if (params.findFilesError) {
        throw params.findFilesError;
      }

      // Return disk files that match
      const uris: UriLike[] = [];
      for (const [uriStr] of diskFiles.entries()) {
        uris.push(makeUri(uriStr));
      }
      return uris;
    },
    readFile: async (uri) => {
      const uriStr = uri.toString();
      const content = diskFiles.get(uriStr);
      if (content === undefined) {
        throw new Error(`File not found: ${uriStr}`);
      }
      if (content instanceof Error) {
        throw content;
      }
      return Buffer.from(content, "utf8");
    },
    getOpenDocuments: () => params.openDocuments ?? [],
    getConfiguration: (section) => ({
      get: <T>(key: string): T | undefined => {
        if (section === "files" && key === "exclude") {
          return params.filesExclude as T | undefined;
        }
        if (section === "search" && key === "exclude") {
          return params.searchExclude as T | undefined;
        }
        return undefined;
      }
    })
  };
}

describe("Workspace Discovery and Source Snapshots (Chunk 1.4)", () => {
  describe("1. Supported Extensions and Language ID Mapping", () => {
    it("recognizes all supported JavaScript and TypeScript extensions", () => {
      expect(SUPPORTED_EXTENSIONS).toEqual([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);

      expect(isSupportedSourceFile("file:///project/src/index.js")).toBe(true);
      expect(isSupportedSourceFile("file:///project/src/module.mjs")).toBe(true);
      expect(isSupportedSourceFile("file:///project/src/common.cjs")).toBe(true);
      expect(isSupportedSourceFile("file:///project/src/component.jsx")).toBe(true);
      expect(isSupportedSourceFile("file:///project/src/service.ts")).toBe(true);
      expect(isSupportedSourceFile("file:///project/src/app.tsx")).toBe(true);
    });

    it("rejects unsupported file extensions", () => {
      expect(isSupportedSourceFile("file:///project/package.json")).toBe(false);
      expect(isSupportedSourceFile("file:///project/README.md")).toBe(false);
      expect(isSupportedSourceFile("file:///project/styles.css")).toBe(false);
      expect(isSupportedSourceFile("file:///project/script.py")).toBe(false);
      expect(isSupportedSourceFile("file:///project/main.rs")).toBe(false);
      expect(isSupportedSourceFile("file:///project/image.png")).toBe(false);
    });

    it("maps extensions to canonical language identifiers", () => {
      expect(extensionToLanguageId("file:///project/index.js")).toBe("javascript");
      expect(extensionToLanguageId("file:///project/module.mjs")).toBe("javascript");
      expect(extensionToLanguageId("file:///project/common.cjs")).toBe("javascript");
      expect(extensionToLanguageId("file:///project/component.jsx")).toBe("javascriptreact");
      expect(extensionToLanguageId("file:///project/service.ts")).toBe("typescript");
      expect(extensionToLanguageId("file:///project/app.tsx")).toBe("typescriptreact");
      expect(extensionToLanguageId("file:///project/unknown.foo")).toBe("plaintext");
    });
  });

  describe("2. Deterministic Content Fingerprints", () => {
    it("computes deterministic SHA-256 hash without altering whitespace or line endings", () => {
      const textLf = "function hello() {\n  return 'world';\n}\n";
      const textCrlf = "function hello() {\r\n  return 'world';\r\n}\r\n";

      const hashLf = computeContentHash(textLf);
      const hashCrlf = computeContentHash(textCrlf);

      expect(hashLf).toHaveLength(64);
      expect(hashCrlf).toHaveLength(64);
      // LF and CRLF must produce different hashes (no silent normalization)
      expect(hashLf).not.toBe(hashCrlf);

      // Same text produces identical hash
      expect(computeContentHash(textLf)).toBe(hashLf);
    });

    it("is sensitive to any character or whitespace difference", () => {
      const text1 = "const x = 1;";
      const text2 = "const x = 1; "; // trailing space
      const text3 = "const x = 2;";

      expect(computeContentHash(text1)).not.toBe(computeContentHash(text2));
      expect(computeContentHash(text1)).not.toBe(computeContentHash(text3));
    });
  });

  describe("3. Workspace Exclusion Behavior", () => {
    it("excludes default generated and dependency directories", () => {
      expect(
        isPathExcluded("file:///workspace/node_modules/express/index.js", DEFAULT_EXCLUDE_GLOBS)
      ).toBe(true);
      expect(isPathExcluded("file:///workspace/.git/config.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/dist/bundle.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/build/out.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/out/index.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(
        isPathExcluded("file:///workspace/coverage/lcov-report/index.js", DEFAULT_EXCLUDE_GLOBS)
      ).toBe(true);
      expect(isPathExcluded("file:///workspace/.turbo/cache.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/.next/server/page.js", DEFAULT_EXCLUDE_GLOBS)).toBe(
        true
      );
      expect(isPathExcluded("file:///workspace/.nuxt/dist.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/.cache/temp.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("file:///workspace/assets/vendor.min.js", DEFAULT_EXCLUDE_GLOBS)).toBe(
        true
      );
      expect(isPathExcluded("file:///workspace/assets/vendor.min.cjs", DEFAULT_EXCLUDE_GLOBS)).toBe(
        true
      );
      expect(isPathExcluded("file:///workspace/assets/vendor.min.mjs", DEFAULT_EXCLUDE_GLOBS)).toBe(
        true
      );
    });

    it("does not exclude valid source files that happen to share name prefixes", () => {
      expect(isPathExcluded("file:///workspace/src/distance.js", DEFAULT_EXCLUDE_GLOBS)).toBe(
        false
      );
      expect(isPathExcluded("file:///workspace/src/outline.ts", DEFAULT_EXCLUDE_GLOBS)).toBe(false);
      expect(isPathExcluded("file:///workspace/src/distribution.tsx", DEFAULT_EXCLUDE_GLOBS)).toBe(
        false
      );
      expect(isPathExcluded("file:///workspace/src/builder.ts", DEFAULT_EXCLUDE_GLOBS)).toBe(false);
    });

    it("respects VS Code files.exclude and search.exclude user configuration", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/app.ts": "export const app = 1;",
          "file:///workspace/temp/temp.ts": "export const temp = 2;",
          "file:///workspace/legacy/old.js": "var old = 3;"
        },
        filesExclude: {
          "**/temp/**": true
        },
        searchExclude: {
          "**/legacy/**": true
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].uri).toBe("file:///workspace/src/app.ts");
    });
  });

  describe("4. Workspace Boundary and Multi-Folder Support", () => {
    it("strictly excludes files outside the opened workspace boundaries", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace/project-a"],
        diskFiles: {
          "file:///workspace/project-a/index.ts": "export const a = 1;",
          "file:///workspace/project-b/index.ts": "export const b = 2;", // outside root
          "file:///other/outside.ts": "export const c = 3;" // completely outside
        },
        openDocuments: [makeOpenDoc("file:///unrelated/open.ts", "console.log('external');")]
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].uri).toBe("file:///workspace/project-a/index.ts");
    });

    it("supports multiple workspace folders seamlessly", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace/frontend", "file:///workspace/backend"],
        diskFiles: {
          "file:///workspace/frontend/src/App.tsx": "export function App() {}",
          "file:///workspace/backend/src/server.ts": "export function start() {}",
          "file:///workspace/ignored/index.ts": "export const ignored = 1;"
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.workspaceRootUris).toEqual([
        "file:///workspace/frontend",
        "file:///workspace/backend"
      ]);
      expect(result.documents).toHaveLength(2);
      const uris = result.documents.map((d) => d.uri);
      expect(uris).toContain("file:///workspace/frontend/src/App.tsx");
      expect(uris).toContain("file:///workspace/backend/src/server.ts");
    });
  });

  describe("5. Open Document Precedence and Dirty Buffers", () => {
    it("prefers unsaved open document buffer over disk content", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/app.ts": "export const version = 1; // disk content"
        },
        openDocuments: [
          makeOpenDoc(
            "file:///workspace/src/app.ts",
            "export const version = 2; // unsaved buffer",
            { version: 42, isDirty: true }
          )
        ]
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);
      const doc = result.documents[0];
      expect(doc.text).toBe("export const version = 2; // unsaved buffer");
      expect(doc.documentVersion).toBe(42);
      expect(doc.isDirty).toBe(true);
      expect(doc.contentHash).toBe(
        computeContentHash("export const version = 2; // unsaved buffer")
      );
    });

    it("sets documentVersion to undefined and isDirty to false for disk-only files", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/index.js": "console.log('from disk');"
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);
      const doc = result.documents[0];
      expect(doc.documentVersion).toBeUndefined();
      expect(doc.isDirty).toBe(false);
    });

    it("includes unsaved, newly created open documents inside workspace even if not yet on disk", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {},
        openDocuments: [
          makeOpenDoc("file:///workspace/src/new-file.ts", "export const brandNew = true;", {
            version: 1,
            isDirty: true
          })
        ]
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].uri).toBe("file:///workspace/src/new-file.ts");
      expect(result.documents[0].text).toBe("export const brandNew = true;");
    });
  });

  describe("6. Revision Consistency and Mutation Race Handling", () => {
    it("detects document revision changes during snapshot creation and records structured failure", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/stable.ts": "export const stable = 1;"
        },
        openDocuments: [
          makeOpenDoc(
            "file:///workspace/src/mutating.ts",
            "export const mutated = true;",
            { version: 10, mutateOnRead: true } // version changes while reading
          )
        ]
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      // Because one succeeded and one failed, status is partial
      expect(result.status).toBe("partial");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].uri).toBe("file:///workspace/src/stable.ts");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].uri).toBe("file:///workspace/src/mutating.ts");
      expect(result.failures[0].error).toContain(
        "Document revision changed during snapshot creation"
      );
    });
  });

  describe("7. Empty Workspaces and Absent Workspace Handling", () => {
    it("returns 'no-workspace' status when no workspace folders are open", async () => {
      const accessor = createMockAccessor({
        folders: undefined
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("no-workspace");
      expect(result.workspaceRootUris).toEqual([]);
      expect(result.documents).toEqual([]);
      expect(result.totalDiscovered).toBe(0);
      expect(result.totalAcquired).toBe(0);
    });

    it("returns 'empty' status when workspace has no supported source files", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/README.md": "# Docs",
          "file:///workspace/package.json": "{}",
          "file:///workspace/assets/logo.png": "binary"
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("empty");
      expect(result.workspaceRootUris).toEqual(["file:///workspace"]);
      expect(result.documents).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.totalDiscovered).toBe(0);
      expect(result.totalAcquired).toBe(0);
    });
  });

  describe("8. Unreadable and Disappeared File Failure Handling", () => {
    it("handles unreadable disk files gracefully and produces structured failures with 'partial' status", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/readable.ts": "export const ok = 1;",
          "file:///workspace/src/unreadable.ts": new Error("EACCES: permission denied")
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("partial");
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].uri).toBe("file:///workspace/src/readable.ts");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].uri).toBe("file:///workspace/src/unreadable.ts");
      expect(result.failures[0].error).toBe("EACCES: permission denied");
    });

    it("returns 'failed' status if all discovered files fail to read", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/broken.ts": new Error("ENOENT: file disappeared")
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("failed");
      expect(result.documents).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error).toBe("ENOENT: file disappeared");
    });

    it("handles discovery failure gracefully if findFiles throws", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        findFilesError: new Error("File search crashed")
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("failed");
      expect(result.documents).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error).toContain(
        "Workspace file discovery failed: File search crashed"
      );
    });
  });

  describe("9. WorkspaceManager Integration and Single-Document Capture", () => {
    it("captures an individual document snapshot via captureDocument", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/file.ts": "export const a = 1;"
        },
        openDocuments: [
          makeOpenDoc("file:///workspace/src/open.tsx", "export const UI = () => <div />;", {
            version: 5,
            isDirty: true
          })
        ]
      });

      const manager = new WorkspaceManager(accessor);

      expect(manager.getWorkspaceRoots()).toEqual(["file:///workspace"]);

      // Capture open document
      const openDoc = await manager.captureDocument("file:///workspace/src/open.tsx");
      expect(openDoc.uri).toBe("file:///workspace/src/open.tsx");
      expect(openDoc.languageId).toBe("typescriptreact");
      expect(openDoc.documentVersion).toBe(5);
      expect(openDoc.isDirty).toBe(true);

      // Capture disk document
      const diskDoc = await manager.captureDocument("file:///workspace/src/file.ts");
      expect(diskDoc.uri).toBe("file:///workspace/src/file.ts");
      expect(diskDoc.languageId).toBe("typescript");
      expect(diskDoc.documentVersion).toBeUndefined();
      expect(diskDoc.isDirty).toBe(false);
    });

    it("rejects captureDocument on unsupported files", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"]
      });

      const manager = new WorkspaceManager(accessor);
      await expect(manager.captureDocument("file:///workspace/README.md")).rejects.toThrow(
        "is not a supported JavaScript/TypeScript source file"
      );
    });

    it("delegates createWorkspaceSnapshot via WorkspaceManager", async () => {
      const accessor = createMockAccessor({
        folders: ["file:///workspace"],
        diskFiles: {
          "file:///workspace/src/app.ts": "export const app = 1;"
        }
      });

      const manager = new WorkspaceManager(accessor);
      const result = await manager.createWorkspaceSnapshot();

      expect(result.status).toBe("success");
      expect(result.totalAcquired).toBe(1);
      expect(result.documents[0].uri).toBe("file:///workspace/src/app.ts");
    });
  });
});
