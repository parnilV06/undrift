// Storage filesystem abstraction providing a clean seam for VS Code workspace.fs,
// Node.js fs/promises, and in-memory testing implementations.

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import type { UriLike } from "../workspace/source-snapshot-provider";

/**
 * Common filesystem operations required by the state persistence adapter.
 * Mirrors vscode.FileSystem methods and signatures.
 */
export interface StorageFileSystem {
  readFile(uri: UriLike): Promise<Uint8Array>;
  writeFile(uri: UriLike, content: Uint8Array): Promise<void>;
  delete(uri: UriLike, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void>;
  rename(source: UriLike, target: UriLike, options?: { overwrite?: boolean }): Promise<void>;
  createDirectory(uri: UriLike): Promise<void>;
  stat(uri: UriLike): Promise<{ type: number; size: number; mtime: number }>;
}

/**
 * Resolves child URI segments from a base URI.
 */
export function joinStorageUri(base: UriLike, ...segments: string[]): UriLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require("vscode");
    if (vscode.Uri?.joinPath && base instanceof vscode.Uri) {
      return vscode.Uri.joinPath(base, ...segments);
    }
  } catch {
    // Not running inside VS Code extension host
  }

  const baseStr = base.toString().replace(/\/+$/, "");
  const joinedPath = segments.map((s) => s.replace(/^\/+|\/+$/g, "")).join("/");
  const fullStr = `${baseStr}/${joinedPath}`;
  const fsPath = base.fsPath ? path.join(base.fsPath, ...segments) : undefined;

  return {
    toString: () => fullStr,
    scheme: base.scheme ?? (fullStr.startsWith("file:") ? "file" : undefined),
    path: base.path ? path.posix.join(base.path, ...segments) : undefined,
    fsPath
  };
}

function toVsCodeUri(vscode: typeof import("vscode"), uri: UriLike): import("vscode").Uri {
  if (uri instanceof vscode.Uri) {
    return uri;
  }
  return vscode.Uri.parse(uri.toString());
}

/**
 * Creates a StorageFileSystem delegating to vscode.workspace.fs.
 */
export function createVsCodeStorageFileSystem(): StorageFileSystem {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode");
  return {
    readFile: async (uri) => vscode.workspace.fs.readFile(toVsCodeUri(vscode, uri)),
    writeFile: async (uri, content) =>
      vscode.workspace.fs.writeFile(toVsCodeUri(vscode, uri), content),
    delete: async (uri, options) => vscode.workspace.fs.delete(toVsCodeUri(vscode, uri), options),
    rename: async (source, target, options) =>
      vscode.workspace.fs.rename(toVsCodeUri(vscode, source), toVsCodeUri(vscode, target), options),
    createDirectory: async (uri) => vscode.workspace.fs.createDirectory(toVsCodeUri(vscode, uri)),
    stat: async (uri) => vscode.workspace.fs.stat(toVsCodeUri(vscode, uri))
  };
}

function uriToFilePath(uri: UriLike): string {
  if (uri.fsPath) {
    return uri.fsPath;
  }
  const str = uri.toString();
  if (str.startsWith("file://")) {
    try {
      return fileURLToPath(str);
    } catch {
      // Fallback below
    }
  }
  return str.replace(/^[a-zA-Z]+:\/\//, "");
}

/**
 * Creates a StorageFileSystem delegating to Node.js fs/promises.
 */
export function createNodeStorageFileSystem(): StorageFileSystem {
  return {
    readFile: async (uri) => {
      const filePath = uriToFilePath(uri);
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },
    writeFile: async (uri, content) => {
      const filePath = uriToFilePath(uri);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    },
    delete: async (uri, options) => {
      const filePath = uriToFilePath(uri);
      await fs.rm(filePath, { recursive: options?.recursive ?? false, force: true });
    },
    rename: async (source, target) => {
      const sourcePath = uriToFilePath(source);
      const targetPath = uriToFilePath(target);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(sourcePath, targetPath);
    },
    createDirectory: async (uri) => {
      const filePath = uriToFilePath(uri);
      await fs.mkdir(filePath, { recursive: true });
    },
    stat: async (uri) => {
      const filePath = uriToFilePath(uri);
      const s = await fs.stat(filePath);
      return {
        type: s.isDirectory() ? 2 : 1,
        size: s.size,
        mtime: s.mtimeMs
      };
    }
  };
}

/**
 * In-memory storage filesystem for deterministic, hermetic unit tests.
 */
export interface InMemoryStorageFileSystem extends StorageFileSystem {
  readonly files: Map<string, Uint8Array>;
  readonly directories: Set<string>;
  faultInjection?: {
    failOnWrite?: boolean;
    failOnRename?: boolean;
    failOnRead?: boolean;
    failOnDelete?: boolean;
  };
}

/**
 * Creates an in-memory StorageFileSystem.
 */
export function createInMemoryStorageFileSystem(): InMemoryStorageFileSystem {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();

  function normalizeKey(uri: UriLike): string {
    return uri.toString().replace(/\/+$/, "");
  }

  const fsImpl: InMemoryStorageFileSystem = {
    files,
    directories,
    readFile: async (uri) => {
      if (fsImpl.faultInjection?.failOnRead) {
        throw new Error("Fault injected: read failed");
      }
      const key = normalizeKey(uri);
      const data = files.get(key);
      if (!data) {
        const err = new Error(`File not found: ${key}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      return new Uint8Array(data);
    },
    writeFile: async (uri, content) => {
      if (fsImpl.faultInjection?.failOnWrite) {
        throw new Error("Fault injected: write failed");
      }
      const key = normalizeKey(uri);
      // Ensure parent directory exists
      const parent = key.substring(0, key.lastIndexOf("/"));
      if (parent) {
        directories.add(parent);
      }
      files.set(key, new Uint8Array(content));
    },
    delete: async (uri, options) => {
      if (fsImpl.faultInjection?.failOnDelete) {
        throw new Error("Fault injected: delete failed");
      }
      const key = normalizeKey(uri);
      if (options?.recursive) {
        for (const k of Array.from(files.keys())) {
          if (k === key || k.startsWith(`${key}/`)) {
            files.delete(k);
          }
        }
        for (const d of Array.from(directories)) {
          if (d === key || d.startsWith(`${key}/`)) {
            directories.delete(d);
          }
        }
      } else {
        files.delete(key);
        directories.delete(key);
      }
    },
    rename: async (source, target, options) => {
      if (fsImpl.faultInjection?.failOnRename) {
        throw new Error("Fault injected: rename failed");
      }
      const srcKey = normalizeKey(source);
      const tgtKey = normalizeKey(target);
      const data = files.get(srcKey);
      if (!data) {
        const err = new Error(`File not found: ${srcKey}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      if (files.has(tgtKey) && options?.overwrite === false) {
        throw new Error(`Target file already exists: ${tgtKey}`);
      }
      files.delete(srcKey);
      const parent = tgtKey.substring(0, tgtKey.lastIndexOf("/"));
      if (parent) {
        directories.add(parent);
      }
      files.set(tgtKey, data);
    },
    createDirectory: async (uri) => {
      const key = normalizeKey(uri);
      directories.add(key);
    },
    stat: async (uri) => {
      const key = normalizeKey(uri);
      if (files.has(key)) {
        return {
          type: 1, // File
          size: files.get(key)!.byteLength,
          mtime: Date.now()
        };
      }
      if (directories.has(key)) {
        return {
          type: 2, // Directory
          size: 0,
          mtime: Date.now()
        };
      }
      const err = new Error(`Entry not found: ${key}`) as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    }
  };

  return fsImpl;
}
