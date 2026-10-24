// Fix proposal staleness and workspace-boundary validator adhering strictly to
// LLD.md Section 13.2, PRD.md Section 13.3, and Phase 5 Chunk 5.2 requirements.

import * as path from "path";
import type { DocumentUri, FixProposal, ProposedEdit, WorkspaceId } from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import { deriveWorkspaceId } from "../activation/coordinator";
import { computeContentHash } from "../workspace/source-snapshot-provider";

/**
 * Structured reason code classifying why a fix proposal was rejected during staleness validation.
 */
export type ProposalValidationReasonCode =
  | "WORKSPACE_MISMATCH"
  | "DOCUMENT_NOT_FOUND"
  | "UNSUPPORTED_DOCUMENT_URI"
  | "MISSING_EXPECTED_HASH"
  | "CONTENT_HASH_MISMATCH"
  | "DOCUMENT_VERSION_MISMATCH"
  | "GENERATION_SUPERSEDED"
  | "INVALID_RANGE"
  | "POSITION_OFFSET_MISMATCH"
  | "EMPTY_PROPOSAL"
  | "TARGET_ROLE_MISMATCH"
  | "MALFORMED_PROPOSAL";

/**
 * Validated in-memory document snapshot captured during proposal validation.
 */
export interface ValidatedDocumentSnapshot {
  readonly uri: DocumentUri;
  readonly text: string;
  readonly version?: number;
  readonly contentHash: string;
}

/**
 * Outcome indicating a proposal passed all workspace containment, generation, hash,
 * version, and range checks.
 */
export interface ProposalValidationSuccess {
  readonly valid: true;
  readonly proposal: FixProposal;
  readonly workspaceId: WorkspaceId;
  readonly documentSnapshots: ReadonlyMap<DocumentUri, ValidatedDocumentSnapshot>;
}

/**
 * Outcome indicating a proposal was rejected with an explicit, structured reason.
 */
export interface ProposalValidationFailure {
  readonly valid: false;
  readonly proposal: FixProposal;
  readonly reasonCode: ProposalValidationReasonCode;
  readonly message: string;
  readonly details?: {
    readonly editId?: string;
    readonly documentUri?: DocumentUri;
    readonly expected?: unknown;
    readonly actual?: unknown;
  };
}

/**
 * Discriminated union of validation outcomes.
 */
export type ProposalValidationResult = ProposalValidationSuccess | ProposalValidationFailure;

/**
 * Lightweight abstraction over editor document buffers and disk reading.
 */
export interface DocumentBufferSnapshot {
  readonly uri: DocumentUri;
  readonly text: string;
  readonly version?: number;
}

/**
 * Document accessor seam enabling deterministic testing without a live VS Code instance.
 */
export interface DocumentTextAccessor {
  /** Retrieves all open documents in editor buffers. */
  getOpenDocuments?(): readonly DocumentBufferSnapshot[];
  /** Reads text from document URI (editor buffer or disk). */
  readDocumentText?(uri: DocumentUri): Promise<DocumentBufferSnapshot | undefined>;
  /** Checks if a document exists at URI. */
  documentExists?(uri: DocumentUri): Promise<boolean>;
}

/**
 * Coordinator interface subset needed for generation validation.
 */
export interface GenerationAccessor {
  getLatestAcceptedGeneration(workspaceId?: WorkspaceId): number | undefined;
}

/**
 * Configuration options for proposal staleness validation.
 */
export interface StalenessValidatorOptions {
  /** Target workspace ID if known. If omitted, derived from workspaceRoots or proposal.workspaceId. */
  readonly targetWorkspaceId?: WorkspaceId;
  /** Explicit workspace roots (URIs). Defaults to VS Code workspace folders. */
  readonly workspaceRoots?: readonly string[];
  /** Analysis coordinator for querying accepted generation per workspace. */
  readonly coordinator?: GenerationAccessor;
  /** Explicit accepted generation override for testing without a full coordinator. */
  readonly acceptedGenerationOverride?: number;
  /** Document accessor seam for test isolation. */
  readonly documentAccessor?: DocumentTextAccessor;
}

/**
 * Checks whether a document URI is safely contained within a workspace root URI.
 * Rejects naive substring prefixes (e.g. /app vs /app-fake), parent traversals (..),
 * and scheme mismatches.
 */
export function isUriContainedInRoot(documentUriStr: string, rootUriStr: string): boolean {
  let docUrl: URL;
  let rootUrl: URL;
  try {
    docUrl = new URL(documentUriStr);
    rootUrl = new URL(rootUriStr);
  } catch {
    return false;
  }

  // Scheme must match exactly (e.g. file: vs file:)
  if (docUrl.protocol.toLowerCase() !== rootUrl.protocol.toLowerCase()) {
    return false;
  }

  // Host / authority must match (e.g. UNC shares)
  if (docUrl.host.toLowerCase() !== rootUrl.host.toLowerCase()) {
    return false;
  }

  let docPath = decodeURIComponent(docUrl.pathname);
  let rootPath = decodeURIComponent(rootUrl.pathname);

  // Normalize Windows drive letters: /c:/foo -> c:/foo
  if (/^\/[a-zA-Z]:/.test(docPath)) {
    docPath = docPath.slice(1);
  }
  if (/^\/[a-zA-Z]:/.test(rootPath)) {
    rootPath = rootPath.slice(1);
  }

  const normDoc = path.normalize(docPath).replace(/\\/g, "/");
  const normRoot = path.normalize(rootPath).replace(/\\/g, "/");

  const isWindows = process.platform === "win32" || /^[a-zA-Z]:/.test(normDoc);
  const compareDoc = isWindows ? normDoc.toLowerCase() : normDoc;
  const compareRoot = isWindows ? normRoot.toLowerCase() : normRoot;

  if (compareDoc === compareRoot) {
    return true;
  }

  const rel = path.relative(compareRoot, compareDoc).replace(/\\/g, "/");
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return true;
  }

  return false;
}

/**
 * Checks whether a document URI belongs to any of the opened workspace folders.
 */
export function isUriInWorkspaceFolders(
  documentUriStr: string,
  rootUris: readonly string[]
): boolean {
  if (rootUris.length === 0) {
    return false;
  }
  return rootUris.some((root) => isUriContainedInRoot(documentUriStr, root));
}

/**
 * Creates the default document accessor delegating to live VS Code APIs.
 */
function createDefaultDocumentTextAccessor(): DocumentTextAccessor {
  let vscode: typeof import("vscode") | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    vscode = require("vscode");
  } catch {
    // Not running inside live VS Code extension host
  }

  return {
    getOpenDocuments: () => {
      if (!vscode?.workspace?.textDocuments) return [];
      return vscode.workspace.textDocuments.map((doc) => ({
        uri: doc.uri.toString(),
        text: doc.getText(),
        version: doc.version
      }));
    },
    readDocumentText: async (uriStr: DocumentUri) => {
      if (!vscode?.workspace) return undefined;

      // Check open documents buffer first (buffer priority)
      const openDoc = vscode.workspace.textDocuments?.find((d) => d.uri.toString() === uriStr);
      if (openDoc) {
        return {
          uri: uriStr,
          text: openDoc.getText(),
          version: openDoc.version
        };
      }

      // Read from filesystem via VS Code workspace.fs
      if (vscode.workspace.fs) {
        try {
          const uri = vscode.Uri.parse(uriStr);
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString("utf8");
          return {
            uri: uriStr,
            text,
            version: undefined
          };
        } catch {
          return undefined;
        }
      }

      return undefined;
    },
    documentExists: async (uriStr: DocumentUri) => {
      if (!vscode?.workspace) return false;
      const isOpen = vscode.workspace.textDocuments?.some((d) => d.uri.toString() === uriStr);
      if (isOpen) return true;
      if (vscode.workspace.fs) {
        try {
          const uri = vscode.Uri.parse(uriStr);
          await vscode.workspace.fs.stat(uri);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  };
}

/**
 * Resolves workspace root URIs from options or active VS Code workspace folders.
 */
function resolveWorkspaceRoots(options?: StalenessValidatorOptions): readonly string[] {
  if (options?.workspaceRoots && options.workspaceRoots.length > 0) {
    return options.workspaceRoots;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require("vscode");
    const folders = vscode?.workspace?.workspaceFolders;
    if (folders && Array.isArray(folders)) {
      return folders.map((f: { uri: { toString(): string } }) => f.uri.toString());
    }
  } catch {
    // Fall back to empty
  }

  return [];
}

/**
 * Validates a FixProposal against workspace identity, source content hash,
 * document version, accepted analysis generation, and exact range validity.
 */
export class FixStalenessValidator {
  private readonly defaultOptions?: StalenessValidatorOptions;

  constructor(defaultOptions?: StalenessValidatorOptions) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Performs complete staleness and validity checks for the given proposal.
   */
  async validateProposal(
    proposal: FixProposal,
    options?: StalenessValidatorOptions
  ): Promise<ProposalValidationResult> {
    const mergedOptions: StalenessValidatorOptions = {
      ...this.defaultOptions,
      ...options
    };

    // 1. Proposal structure sanity check
    if (!proposal || !proposal.id || !proposal.findingId) {
      return {
        valid: false,
        proposal,
        reasonCode: "MALFORMED_PROPOSAL",
        message: "Fix proposal is missing required identifier or finding identity."
      };
    }

    if (!proposal.edits || proposal.edits.length === 0) {
      return {
        valid: false,
        proposal,
        reasonCode: "EMPTY_PROPOSAL",
        message: `Fix proposal '${proposal.id}' does not contain any edits.`
      };
    }

    // 2. Mandatory workspace identity check
    if (!proposal.workspaceId || proposal.workspaceId.trim() === "") {
      return {
        valid: false,
        proposal,
        reasonCode: "WORKSPACE_MISMATCH",
        message: `Proposal '${proposal.id}' is missing required originating workspace identity and cannot be safely validated or applied.`
      };
    }

    const originatingWorkspaceId = proposal.workspaceId;

    // 3. Workspace roots resolution
    const workspaceRoots = resolveWorkspaceRoots(mergedOptions);

    // Target workspace identity must match originating workspace if specified
    if (
      mergedOptions.targetWorkspaceId &&
      originatingWorkspaceId !== mergedOptions.targetWorkspaceId
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "WORKSPACE_MISMATCH",
        message: `Proposal originates from workspace '${originatingWorkspaceId}', which does not match target workspace '${mergedOptions.targetWorkspaceId}'.`,
        details: {
          expected: mergedOptions.targetWorkspaceId,
          actual: originatingWorkspaceId
        }
      };
    }

    // 4. Accepted generation check
    const effectiveWorkspaceId = originatingWorkspaceId;
    const latestAcceptedGeneration =
      mergedOptions.acceptedGenerationOverride !== undefined
        ? mergedOptions.acceptedGenerationOverride
        : mergedOptions.coordinator?.getLatestAcceptedGeneration(effectiveWorkspaceId);

    if (
      latestAcceptedGeneration !== undefined &&
      proposal.generation !== undefined &&
      proposal.generation < latestAcceptedGeneration
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "GENERATION_SUPERSEDED",
        message: `Proposal generation (${proposal.generation}) has been superseded by accepted generation (${latestAcceptedGeneration}) for workspace '${effectiveWorkspaceId ?? "unknown"}'.`,
        details: {
          expected: latestAcceptedGeneration,
          actual: proposal.generation
        }
      };
    }

    // 5. Document accessor resolution
    const accessor = mergedOptions.documentAccessor ?? createDefaultDocumentTextAccessor();

    // 6. Preload open documents into an in-memory lookup map
    const openDocsMap = new Map<string, DocumentBufferSnapshot>();
    if (accessor.getOpenDocuments) {
      try {
        const openList = accessor.getOpenDocuments();
        for (const doc of openList) {
          openDocsMap.set(doc.uri, doc);
        }
      } catch {
        // Fall back gracefully
      }
    }

    const documentSnapshots = new Map<DocumentUri, ValidatedDocumentSnapshot>();

    // 7. Validate every edit in the proposal
    for (const edit of proposal.edits) {
      const editResult = await this.validateEdit(
        edit,
        proposal,
        workspaceRoots,
        accessor,
        openDocsMap,
        documentSnapshots
      );

      if (!editResult.valid) {
        return editResult;
      }
    }

    // All edits passed complete validation
    return {
      valid: true,
      proposal,
      workspaceId: effectiveWorkspaceId ?? ("ws:default" as WorkspaceId),
      documentSnapshots
    };
  }

  private async validateEdit(
    edit: ProposedEdit,
    proposal: FixProposal,
    workspaceRoots: readonly string[],
    accessor: DocumentTextAccessor,
    openDocsMap: Map<string, DocumentBufferSnapshot>,
    documentSnapshots: Map<DocumentUri, ValidatedDocumentSnapshot>
  ): Promise<ProposalValidationResult> {
    const uriStr = edit.documentUri;

    // A. Validate URI structure and scheme
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(uriStr);
    } catch {
      return {
        valid: false,
        proposal,
        reasonCode: "UNSUPPORTED_DOCUMENT_URI",
        message: `Invalid document URI '${uriStr}' in edit '${edit.id}'.`,
        details: { editId: edit.id, documentUri: uriStr }
      };
    }

    if (parsedUrl.protocol !== "file:") {
      // If workspace roots are defined, ensure scheme matches
      const rootProtocol = workspaceRoots[0] ? new URL(workspaceRoots[0]).protocol : "file:";
      if (parsedUrl.protocol !== rootProtocol) {
        return {
          valid: false,
          proposal,
          reasonCode: "UNSUPPORTED_DOCUMENT_URI",
          message: `Unsupported document URI scheme '${parsedUrl.protocol}' for edit '${edit.id}'. Only '${rootProtocol}' is supported.`,
          details: { editId: edit.id, documentUri: uriStr, actual: parsedUrl.protocol }
        };
      }
    }

    // B. Workspace containment check (non-naive prefix matching)
    if (workspaceRoots.length > 0 && !isUriInWorkspaceFolders(uriStr, workspaceRoots)) {
      return {
        valid: false,
        proposal,
        reasonCode: "WORKSPACE_MISMATCH",
        message: `Document URI '${uriStr}' in edit '${edit.id}' is outside the intended workspace roots.`,
        details: { editId: edit.id, documentUri: uriStr, expected: workspaceRoots }
      };
    }

    // C. Retrieve current document content (open editor buffer takes precedence)
    let snapshot = documentSnapshots.get(uriStr);

    if (!snapshot) {
      let docText: string | undefined;
      let docVersion: number | undefined;

      const openDoc = openDocsMap.get(uriStr);
      if (openDoc) {
        docText = openDoc.text;
        docVersion = openDoc.version;
      } else if (accessor.readDocumentText) {
        const readResult = await accessor.readDocumentText(uriStr);
        if (readResult) {
          docText = readResult.text;
          docVersion = readResult.version;
        }
      }

      if (docText === undefined) {
        return {
          valid: false,
          proposal,
          reasonCode: "DOCUMENT_NOT_FOUND",
          message: `Target document '${uriStr}' for edit '${edit.id}' does not exist or cannot be read.`,
          details: { editId: edit.id, documentUri: uriStr }
        };
      }

      const contentHash = computeContentHash(docText);
      snapshot = {
        uri: uriStr,
        text: docText,
        version: docVersion,
        contentHash
      };
      documentSnapshots.set(uriStr, snapshot);
    }

    // D. Required content hash metadata check
    if (!edit.expectedContentHash || edit.expectedContentHash.trim() === "") {
      return {
        valid: false,
        proposal,
        reasonCode: "MISSING_EXPECTED_HASH",
        message: `Proposed edit '${edit.id}' is missing required expected content hash metadata.`,
        details: { editId: edit.id, documentUri: uriStr }
      };
    }

    // E. Content hash match check
    if (snapshot.contentHash !== edit.expectedContentHash) {
      return {
        valid: false,
        proposal,
        reasonCode: "CONTENT_HASH_MISMATCH",
        message: `Document content has changed since fix was proposed for '${uriStr}'.`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          expected: edit.expectedContentHash,
          actual: snapshot.contentHash
        }
      };
    }

    // F. Document version match check (when expected version is provided)
    if (
      edit.expectedDocumentVersion !== undefined &&
      snapshot.version !== undefined &&
      snapshot.version !== edit.expectedDocumentVersion
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "DOCUMENT_VERSION_MISMATCH",
        message: `Document revision changed for '${uriStr}': expected version ${edit.expectedDocumentVersion}, but open editor buffer is at version ${snapshot.version}.`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          expected: edit.expectedDocumentVersion,
          actual: snapshot.version
        }
      };
    }

    // G. Exact range validation against current source text
    const textLen = snapshot.text.length;

    if (
      edit.range.start < 0 ||
      edit.range.end < 0 ||
      edit.range.start > edit.range.end ||
      edit.range.end > textLen
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "INVALID_RANGE",
        message: `Edit range [${edit.range.start}, ${edit.range.end}] is negative, reversed, or exceeds document length (${textLen}).`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          expected: `0 <= start <= end <= ${textLen}`,
          actual: `start: ${edit.range.start}, end: ${edit.range.end}`
        }
      };
    }

    if (
      edit.start.line < 0 ||
      edit.start.character < 0 ||
      edit.end.line < 0 ||
      edit.end.character < 0 ||
      edit.start.line > edit.end.line ||
      (edit.start.line === edit.end.line && edit.start.character > edit.end.character)
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "INVALID_RANGE",
        message: `Edit position coordinates are negative or reversed for '${edit.id}'.`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          actual: { start: edit.start, end: edit.end }
        }
      };
    }

    // H. Position-offset consistency verification (CRLF, LF, and Unicode aware)
    const mapper = new PositionMapper(snapshot.text, uriStr);
    const computedStart = mapper.utf16ToPosition(edit.range.start);
    const computedEnd = mapper.utf16ToPosition(edit.range.end);

    if (
      computedStart.line !== edit.start.line ||
      computedStart.character !== edit.start.character
    ) {
      return {
        valid: false,
        proposal,
        reasonCode: "POSITION_OFFSET_MISMATCH",
        message: `Start position coordinates (line ${edit.start.line}, col ${edit.start.character}) do not match offset ${edit.range.start} in document '${uriStr}'.`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          expected: computedStart,
          actual: edit.start
        }
      };
    }

    if (computedEnd.line !== edit.end.line || computedEnd.character !== edit.end.character) {
      return {
        valid: false,
        proposal,
        reasonCode: "POSITION_OFFSET_MISMATCH",
        message: `End position coordinates (line ${edit.end.line}, col ${edit.end.character}) do not match offset ${edit.range.end} in document '${uriStr}'.`,
        details: {
          editId: edit.id,
          documentUri: uriStr,
          expected: computedEnd,
          actual: edit.end
        }
      };
    }

    return {
      valid: true,
      proposal,
      workspaceId: "ws:temp" as WorkspaceId,
      documentSnapshots
    };
  }
}

/**
 * Functional convenience wrapper validating a proposal with default options.
 */
export async function validateFixProposal(
  proposal: FixProposal,
  options?: StalenessValidatorOptions
): Promise<ProposalValidationResult> {
  const validator = new FixStalenessValidator(options);
  return validator.validateProposal(proposal, options);
}
