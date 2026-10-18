// Workspace source-snapshot provider for discovering supported source files
// and creating immutable SourceDocument snapshots as specified in LLD.md Section 4.4 and Section 14.

import * as crypto from "crypto";
import * as path from "path";
import type { DocumentUri, SourceDocument } from "@undrift/core";

/**
 * File extensions supported by UNDRIFT's JavaScript/TypeScript parser and analyzer.
 */
export const SUPPORTED_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"] as const;

export type SupportedFileExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Default directory and file patterns excluded from workspace discovery
 * as mandated by TRD.md and LLD.md.
 */
export const DEFAULT_EXCLUDE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.cache/**",
  "**/*.min.js",
  "**/*.min.cjs",
  "**/*.min.mjs"
] as const;

/**
 * Computes deterministic SHA-256 fingerprint for the exact source text snapshot.
 *
 * Line endings and whitespace are strictly preserved without alteration.
 */
export function computeContentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Maps a file extension or path to its canonical language ID.
 */
export function extensionToLanguageId(pathOrUri: string): string {
  const ext = path.extname(pathOrUri).toLowerCase();
  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    default:
      return "plaintext";
  }
}

/**
 * Checks whether the given file path or URI ends with a supported extension.
 */
export function isSupportedSourceFile(pathOrUri: string): boolean {
  const lower = pathOrUri.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Converts a glob pattern into a regular expression for in-memory exclusion checks.
 */
function globToRegex(glob: string): RegExp {
  let normalized = glob.replace(/\\/g, "/");
  let regexStr = "^";

  if (normalized.startsWith("**/")) {
    regexStr += "(?:.*/)?";
    normalized = normalized.slice(3);
  } else if (!normalized.startsWith("/")) {
    regexStr += "(?:.*/)?";
  }

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === "*" && normalized[i + 1] === "*") {
      if (normalized[i + 2] === "/") {
        regexStr += "(?:.*/)?";
        i += 2;
      } else {
        regexStr += ".*";
        i += 1;
      }
    } else if (c === "*") {
      regexStr += "[^/]*";
    } else if (c === "?") {
      regexStr += "[^/]";
    } else if (["[", "]", "(", ")", "{", "}", "+", ".", "^", "$", "|"].includes(c)) {
      regexStr += "\\" + c;
    } else {
      regexStr += c;
    }
  }

  if (!regexStr.endsWith(".*") && !regexStr.endsWith("/")) {
    regexStr += "(?:/.*)?$";
  } else {
    regexStr += "$";
  }

  return new RegExp(regexStr, "i");
}

/**
 * Checks whether a file path or URI matches any of the provided exclusion patterns.
 */
export function isPathExcluded(filePathOrUri: string, excludePatterns: readonly string[]): boolean {
  const normalized = filePathOrUri.replace(/\\/g, "/");
  return excludePatterns.some((pattern) => {
    try {
      return globToRegex(pattern).test(normalized);
    } catch {
      return false;
    }
  });
}

/**
 * Lightweight URI abstraction avoiding direct coupling to VS Code runtime in test seams.
 */
export interface UriLike {
  toString(): string;
  readonly scheme?: string;
  readonly path?: string;
  readonly fsPath?: string;
}

/**
 * Lightweight WorkspaceFolder abstraction.
 */
export interface WorkspaceFolderLike {
  readonly uri: UriLike;
  readonly name?: string;
  readonly index?: number;
}

/**
 * Abstraction for an active editor text document buffer.
 */
export interface OpenDocumentAccessor {
  readonly uri: UriLike;
  readonly languageId: string;
  readonly version: number;
  readonly isDirty: boolean;
  getText(): string;
}

/**
 * Workspace accessor seam decoupling discovery logic from the concrete vscode module.
 * Enables deterministic testing in Node.js/Vitest without full extension host mocks.
 */
export interface WorkspaceAccessor {
  getWorkspaceFolders(): readonly WorkspaceFolderLike[] | undefined;
  findFiles(
    includePattern: string,
    excludePattern?: string,
    maxResults?: number,
    token?: unknown
  ): Promise<readonly UriLike[]>;
  readFile(uri: UriLike): Promise<Uint8Array>;
  getOpenDocuments(): readonly OpenDocumentAccessor[];
  getConfiguration?(section: string): { get<T>(key: string): T | undefined };
}

/**
 * Discovery execution outcome status.
 */
export type WorkspaceSnapshotStatus = "success" | "partial" | "empty" | "failed" | "no-workspace";

/**
 * Structured record of an unreadable or inaccessible file encountered during snapshot creation.
 */
export interface WorkspaceSnapshotFailure {
  uri: DocumentUri;
  error: string;
}

/**
 * Result of a workspace source-snapshot operation.
 */
export interface WorkspaceSnapshotResult {
  status: WorkspaceSnapshotStatus;
  workspaceRootUris: DocumentUri[];
  documents: SourceDocument[];
  failures: WorkspaceSnapshotFailure[];
  totalDiscovered: number;
  totalAcquired: number;
}

/**
 * Configuration options for workspace source-snapshot creation.
 */
export interface WorkspaceSnapshotOptions {
  /** Additional glob exclusion patterns beyond the defaults. */
  additionalExcludeGlobs?: string[];
  /** Whether to respect VS Code files.exclude and search.exclude settings (default true). */
  useVsCodeExcludes?: boolean;
  /** Maximum number of files to discover. */
  maxResults?: number;
}

/**
 * Creates the default accessor delegating to the live vscode extension API.
 */
function createDefaultVsCodeAccessor(): WorkspaceAccessor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode");
  return {
    getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
    findFiles: async (include, exclude, maxResults, token) =>
      vscode.workspace.findFiles(
        include,
        exclude,
        maxResults,
        token as import("vscode").CancellationToken
      ),
    readFile: async (uri) =>
      vscode.workspace.fs.readFile(
        typeof uri === "string" ? vscode.Uri.parse(uri) : (uri as import("vscode").Uri)
      ),
    getOpenDocuments: () => vscode.workspace.textDocuments,
    getConfiguration: (section) => vscode.workspace.getConfiguration(section)
  };
}

/**
 * Provider responsible for discovering supported workspace source files and creating
 * consistent, immutable SourceDocument snapshots for downstream UNDRIFT analysis.
 */
export class WorkspaceSourceSnapshotProvider {
  private readonly accessor: WorkspaceAccessor;
  private readonly options: WorkspaceSnapshotOptions;

  constructor(accessor?: WorkspaceAccessor, options?: WorkspaceSnapshotOptions) {
    this.accessor = accessor ?? createDefaultVsCodeAccessor();
    this.options = options ?? {};
  }

  /**
   * Discovers all supported source files in the active workspace and creates an immutable snapshot.
   */
  async createSnapshot(cancellationToken?: {
    isCancellationRequested: boolean;
  }): Promise<WorkspaceSnapshotResult> {
    const folders = this.accessor.getWorkspaceFolders();

    if (!folders || folders.length === 0) {
      return {
        status: "no-workspace",
        workspaceRootUris: [],
        documents: [],
        failures: [],
        totalDiscovered: 0,
        totalAcquired: 0
      };
    }

    const workspaceRootUris = folders.map((f) => f.uri.toString());

    // Build exclusion list
    const excludePatterns = this.resolveExclusions();
    const excludeGlobString =
      excludePatterns.length === 0
        ? undefined
        : excludePatterns.length === 1
          ? excludePatterns[0]
          : `{${excludePatterns.join(",")}}`;
    const includePattern = `**/*{${SUPPORTED_EXTENSIONS.join(",")}}`;

    // 1. Discover on-disk files via workspace findFiles
    let discoveredUris: readonly UriLike[] = [];
    try {
      discoveredUris = await this.accessor.findFiles(
        includePattern,
        excludeGlobString,
        this.options.maxResults,
        cancellationToken
      );
    } catch (err) {
      return {
        status: "failed",
        workspaceRootUris,
        documents: [],
        failures: [
          {
            uri: workspaceRootUris[0] ?? "",
            error: `Workspace file discovery failed: ${err instanceof Error ? err.message : String(err)}`
          }
        ],
        totalDiscovered: 0,
        totalAcquired: 0
      };
    }

    // 2. Map open documents for buffer precedence and untracked buffer discovery
    const openDocsMap = new Map<string, OpenDocumentAccessor>();
    for (const openDoc of this.accessor.getOpenDocuments()) {
      openDocsMap.set(openDoc.uri.toString(), openDoc);
    }

    // Combine discovered URIs with any open documents inside the workspace folders
    const allCandidateUriMap = new Map<string, UriLike>();
    for (const uri of discoveredUris) {
      const uriStr = uri.toString();
      if (
        !isPathExcluded(uriStr, excludePatterns) &&
        isSupportedSourceFile(uriStr) &&
        this.isUriInWorkspaceFolders(uriStr, workspaceRootUris)
      ) {
        allCandidateUriMap.set(uriStr, uri);
      }
    }

    for (const [uriStr, openDoc] of openDocsMap.entries()) {
      if (
        isSupportedSourceFile(uriStr) &&
        !isPathExcluded(uriStr, excludePatterns) &&
        this.isUriInWorkspaceFolders(uriStr, workspaceRootUris)
      ) {
        allCandidateUriMap.set(uriStr, openDoc.uri);
      }
    }

    const totalDiscovered = allCandidateUriMap.size;
    if (totalDiscovered === 0) {
      return {
        status: "empty",
        workspaceRootUris,
        documents: [],
        failures: [],
        totalDiscovered: 0,
        totalAcquired: 0
      };
    }

    // 3. Acquire source snapshot for each discovered file
    const documents: SourceDocument[] = [];
    const failures: WorkspaceSnapshotFailure[] = [];

    for (const [uriStr, uri] of allCandidateUriMap.entries()) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      const openDoc = openDocsMap.get(uriStr);

      if (openDoc) {
        // Open document buffer takes precedence over disk
        try {
          const snapshot = this.captureOpenDocument(openDoc);
          documents.push(snapshot);
        } catch (err) {
          failures.push({
            uri: uriStr,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      } else {
        // Read from workspace storage / filesystem
        try {
          const snapshot = await this.readDiskDocument(uri);
          documents.push(snapshot);
        } catch (err) {
          failures.push({
            uri: uriStr,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }

    // Determine status
    let status: WorkspaceSnapshotStatus;
    if (failures.length === 0) {
      status = "success";
    } else if (documents.length > 0) {
      status = "partial";
    } else {
      status = "failed";
    }

    return {
      status,
      workspaceRootUris,
      documents,
      failures,
      totalDiscovered,
      totalAcquired: documents.length
    };
  }

  /**
   * Captures a single source-document snapshot for a specific file URI.
   */
  async captureDocument(uri: DocumentUri | UriLike): Promise<SourceDocument> {
    const uriStr = typeof uri === "string" ? uri : uri.toString();
    const uriObj: UriLike = typeof uri === "string" ? { toString: () => uriStr } : uri;

    if (!isSupportedSourceFile(uriStr)) {
      throw new Error(`File '${uriStr}' is not a supported JavaScript/TypeScript source file.`);
    }

    // Check open documents first
    for (const openDoc of this.accessor.getOpenDocuments()) {
      if (openDoc.uri.toString() === uriStr) {
        return this.captureOpenDocument(openDoc);
      }
    }

    return this.readDiskDocument(uriObj);
  }

  /**
   * Captures an open editor document snapshot with version-consistency verification.
   */
  private captureOpenDocument(openDoc: OpenDocumentAccessor): SourceDocument {
    const initialVersion = openDoc.version;
    const text = openDoc.getText();
    const finalVersion = openDoc.version;

    // Detect if document was mutated during reading
    if (initialVersion !== finalVersion) {
      throw new Error(
        `Document revision changed during snapshot creation for '${openDoc.uri.toString()}'.`
      );
    }

    const uriStr = openDoc.uri.toString();
    const languageId = openDoc.languageId || extensionToLanguageId(uriStr);
    const contentHash = computeContentHash(text);

    return {
      uri: uriStr,
      languageId,
      text,
      contentHash,
      documentVersion: initialVersion,
      isDirty: openDoc.isDirty
    };
  }

  /**
   * Reads a file from workspace storage and builds an immutable SourceDocument snapshot.
   */
  private async readDiskDocument(uri: UriLike): Promise<SourceDocument> {
    const uriStr = uri.toString();
    const bytes = await this.accessor.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    const languageId = extensionToLanguageId(uriStr);
    const contentHash = computeContentHash(text);

    return {
      uri: uriStr,
      languageId,
      text,
      contentHash,
      documentVersion: undefined,
      isDirty: false
    };
  }

  /**
   * Combines default exclusions, options, and VS Code user settings.
   */
  private resolveExclusions(): string[] {
    const exclusions = new Set<string>(DEFAULT_EXCLUDE_GLOBS);

    if (this.options.additionalExcludeGlobs) {
      for (const pattern of this.options.additionalExcludeGlobs) {
        exclusions.add(pattern);
      }
    }

    if (this.options.useVsCodeExcludes !== false && this.accessor.getConfiguration) {
      try {
        const filesConfig = this.accessor.getConfiguration("files");
        const filesExclude = filesConfig.get<Record<string, boolean>>("exclude");
        if (filesExclude) {
          for (const [pattern, enabled] of Object.entries(filesExclude)) {
            if (enabled) {
              exclusions.add(pattern);
            }
          }
        }

        const searchConfig = this.accessor.getConfiguration("search");
        const searchExclude = searchConfig.get<Record<string, boolean>>("exclude");
        if (searchExclude) {
          for (const [pattern, enabled] of Object.entries(searchExclude)) {
            if (enabled) {
              exclusions.add(pattern);
            }
          }
        }
      } catch {
        // Fall back gracefully if configuration cannot be inspected
      }
    }

    return Array.from(exclusions);
  }

  /**
   * Checks whether a URI belongs to one of the opened workspace folders.
   */
  private isUriInWorkspaceFolders(uriStr: string, rootUris: readonly string[]): boolean {
    return rootUris.some((root) => {
      const normalizedRoot = root.endsWith("/") ? root : root + "/";
      return uriStr.startsWith(normalizedRoot) || uriStr === root;
    });
  }
}
