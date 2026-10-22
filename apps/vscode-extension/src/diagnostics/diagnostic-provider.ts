// Diagnostic provider mapping UNDRIFT drift findings to VS Code native diagnostics
// strictly adhering to LLD.md Section 14.4 and Chunk 4.5.

import * as vscode from "vscode";
import type {
  AnalysisSnapshot,
  DocumentUri,
  Finding,
  FindingSeverity,
  PersistedFindingRecord,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import type { CoordinatorAnalysisResult } from "../activation/coordinator";
import type { ExtensionLogger } from "../logging/output-channel";
import type { WorkspaceSnapshotFailure } from "../workspace";

/**
 * Diagnostic source label displayed in VS Code problems panel and hover.
 */
export const DIAGNOSTIC_SOURCE = "UNDRIFT";

/**
 * Name assigned to the VS Code DiagnosticCollection.
 */
export const DIAGNOSTIC_COLLECTION_NAME = "undrift";

/**
 * Lightweight abstraction over VS Code DiagnosticCollection for deterministic testing.
 */
export interface DiagnosticCollectionLike {
  readonly name: string;
  set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void;
  delete(uri: vscode.Uri): void;
  clear(): void;
  get(uri: vscode.Uri): readonly vscode.Diagnostic[] | undefined;
  has(uri: vscode.Uri): boolean;
  forEach?(
    callback: (
      uri: vscode.Uri,
      diagnostics: readonly vscode.Diagnostic[],
      collection: DiagnosticCollectionLike
    ) => unknown,
    thisArg?: unknown
  ): void;
  dispose(): void;
}

/**
 * In-memory DiagnosticCollection implementation for headless and isolated testing.
 */
export class InMemoryDiagnosticCollection implements DiagnosticCollectionLike {
  public readonly name: string;
  private readonly map = new Map<string, readonly vscode.Diagnostic[]>();

  constructor(name = DIAGNOSTIC_COLLECTION_NAME) {
    this.name = name;
  }

  public set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void {
    const key = uri.toString();
    if (!diagnostics || diagnostics.length === 0) {
      this.map.delete(key);
    } else {
      this.map.set(key, [...diagnostics]);
    }
  }

  public delete(uri: vscode.Uri): void {
    this.map.delete(uri.toString());
  }

  public clear(): void {
    this.map.clear();
  }

  public get(uri: vscode.Uri): readonly vscode.Diagnostic[] | undefined {
    return this.map.get(uri.toString());
  }

  public has(uri: vscode.Uri): boolean {
    return this.map.has(uri.toString());
  }

  public forEach(
    callback: (
      uri: vscode.Uri,
      diagnostics: readonly vscode.Diagnostic[],
      collection: DiagnosticCollectionLike
    ) => unknown,
    thisArg?: unknown
  ): void {
    for (const [uriStr, diags] of this.map.entries()) {
      const uri = parseDocumentUri(uriStr) ?? (uriStr as unknown as vscode.Uri);
      callback.call(thisArg, uri, diags, this);
    }
  }

  public dispose(): void {
    this.map.clear();
  }
}

/**
 * Options for configuring DriftDiagnosticProvider.
 */
export interface DriftDiagnosticProviderOptions {
  /** Injected diagnostic collection; if omitted, creates native vscode collection. */
  collection?: DiagnosticCollectionLike | vscode.DiagnosticCollection;
  /** Injected vscode module reference for testing environments. */
  vscodeModule?: typeof vscode;
  /** Optional diagnostic logger. */
  logger?: ExtensionLogger;
}

/**
 * Maps UNDRIFT finding severity to VS Code DiagnosticSeverity.
 */
export function mapFindingSeverityToDiagnosticSeverity(
  severity: FindingSeverity
): vscode.DiagnosticSeverity {
  switch (severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

/**
 * Any finding or persisted record carrying diagnostic-mappable attributes.
 */
export type DiagnosticFindingSource = Finding | PersistedFindingRecord;

/**
 * Formats a concise, useful user-facing diagnostic message without losing essential context.
 */
export function formatDiagnosticMessage(finding: DiagnosticFindingSource): string {
  const customMessage = (finding as { message?: string }).message;
  if (customMessage && typeof customMessage === "string" && customMessage.trim().length > 0) {
    return customMessage.trim();
  }
  if (finding.summary && typeof finding.summary === "string" && finding.summary.trim().length > 0) {
    return finding.summary.trim();
  }
  if (finding.title && typeof finding.title === "string" && finding.title.trim().length > 0) {
    return finding.title.trim();
  }
  return "UNDRIFT contract drift detected.";
}

/**
 * Converts a SourceSpan with UTF-16 line/character positions to a valid VS Code Range.
 * Handles missing or invalid optional locations conservatively without throwing or fabricating evidence.
 */
export function sourceSpanToVsCodeRange(span?: SourceSpan): vscode.Range | undefined {
  if (!span) return undefined;

  const start = span.start;
  const end = span.end;

  if (
    !start ||
    !end ||
    typeof start.line !== "number" ||
    typeof start.character !== "number" ||
    typeof end.line !== "number" ||
    typeof end.character !== "number" ||
    isNaN(start.line) ||
    isNaN(start.character) ||
    isNaN(end.line) ||
    isNaN(end.character) ||
    start.line < 0 ||
    start.character < 0 ||
    end.line < 0 ||
    end.character < 0
  ) {
    return undefined;
  }

  // Ensure start does not exceed end position
  if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
    return new vscode.Range(
      new vscode.Position(start.line, start.character),
      new vscode.Position(start.line, start.character)
    );
  }

  return new vscode.Range(
    new vscode.Position(start.line, start.character),
    new vscode.Position(end.line, end.character)
  );
}

/**
 * Safely parses a document URI string to a vscode.Uri instance.
 */
export function parseDocumentUri(uriStr?: string): vscode.Uri | undefined {
  if (!uriStr || typeof uriStr !== "string" || uriStr.trim().length === 0) {
    return undefined;
  }
  try {
    if (uriStr.startsWith("file://") || uriStr.includes("://")) {
      return vscode.Uri.parse(uriStr);
    }
    return vscode.Uri.file(uriStr);
  } catch {
    return undefined;
  }
}

/**
 * Diagnostic provider managing VS Code native diagnostics for UNDRIFT contract drift findings.
 * Connects strictly to accepted coordinator analysis results and enforces incomplete-scan safety.
 */
export class DriftDiagnosticProvider {
  public readonly collection: DiagnosticCollectionLike | vscode.DiagnosticCollection;
  private readonly vscodeModule?: typeof vscode;
  private readonly logger?: ExtensionLogger;

  /** Tracked document URIs per workspace identity for safe scope-bounded cleanup. */
  private readonly workspaceTrackedUris = new Map<WorkspaceId, Set<string>>();

  private disposed = false;

  constructor(options?: DriftDiagnosticProviderOptions) {
    this.vscodeModule = options?.vscodeModule;
    this.logger = options?.logger;
    this.collection = options?.collection ?? this.resolveDefaultCollection();
  }

  private resolveDefaultCollection(): DiagnosticCollectionLike | vscode.DiagnosticCollection {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = this.vscodeModule ?? require("vscode");
      if (mod.languages?.createDiagnosticCollection) {
        return mod.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
      }
    } catch {
      // Fallback if not inside running VS Code host
    }
    return new InMemoryDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
  }

  private getVsCode(): typeof vscode {
    if (this.vscodeModule) return this.vscodeModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("vscode");
    } catch {
      return vscode;
    }
  }

  /**
   * Updates diagnostics from an accepted coordinator analysis result.
   * Strictly respects acceptance boundaries: cancelled, failed, or superseded results
   * are rejected and do not change existing diagnostics.
   */
  public updateDiagnostics(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed) return;

    switch (outcome.status) {
      case "failed":
      case "cancelled":
      case "superseded": {
        // Requirement 8: Failed, cancelled, and superseded outcomes do not change diagnostic state
        this.logger?.info(`Diagnostic update skipped: scan status is "${outcome.status}".`);
        return;
      }

      case "no-workspace": {
        this.clear();
        return;
      }

      case "success": {
        const workspaceId = outcome.workspaceId;
        if (!workspaceId) return;
        const findings = outcome.result?.findings ?? [];
        this.replaceWorkspaceDiagnostics(workspaceId, findings);
        return;
      }

      case "incomplete": {
        const workspaceId = outcome.workspaceId;
        if (!workspaceId) return;
        const failures = outcome.failures ?? [];
        const findings = outcome.result?.findings ?? [];
        this.applyIncompleteWorkspaceDiagnostics(workspaceId, findings, failures);
        return;
      }
    }
  }

  /**
   * Convenient alias for updateDiagnostics.
   */
  public handleAnalysisResult(outcome: CoordinatorAnalysisResult): void {
    this.updateDiagnostics(outcome);
  }

  /**
   * Publishes verified diagnostics from a restored session snapshot.
   */
  public publishSnapshot(workspaceId: WorkspaceId, snapshot: AnalysisSnapshot): void {
    if (this.disposed) return;
    this.replaceWorkspaceDiagnostics(workspaceId, snapshot.findings);
  }

  /**
   * Replaces all diagnostics for a workspace scope after a complete, accepted analysis.
   * Clears diagnostics for findings no longer present.
   */
  private replaceWorkspaceDiagnostics(
    workspaceId: WorkspaceId,
    findings: readonly DiagnosticFindingSource[]
  ): void {
    const diagnosticsByUri = this.groupFindingsByUri(findings);
    const previousUris = this.workspaceTrackedUris.get(workspaceId) ?? new Set<string>();
    const currentUris = new Set<string>();

    // 1. Set new diagnostics for URIs that have findings
    for (const [uriStr, { uri, diagnostics }] of diagnosticsByUri.entries()) {
      currentUris.add(uriStr);
      this.collection.set(uri, diagnostics);
    }

    // 2. Clear diagnostics for URIs previously tracked in this workspace that now have no findings
    for (const prevUriStr of previousUris) {
      if (!currentUris.has(prevUriStr)) {
        const uri = parseDocumentUri(prevUriStr);
        if (uri) {
          this.collection.delete(uri);
        }
      }
    }

    this.workspaceTrackedUris.set(workspaceId, currentUris);
  }

  /**
   * Updates diagnostics after an incomplete scan while preserving safety invariants:
   * - Does NOT clear diagnostics for files that were not successfully acquired/analyzed.
   * - Does NOT treat absence of findings in an incomplete scan as proof of resolution.
   * - Updates diagnostics only for files with directly observed findings.
   */
  private applyIncompleteWorkspaceDiagnostics(
    workspaceId: WorkspaceId,
    findings: readonly DiagnosticFindingSource[],
    _failures: readonly WorkspaceSnapshotFailure[]
  ): void {
    const newDiagnosticsByUri = this.groupFindingsByUri(findings);
    const trackedUris = this.workspaceTrackedUris.get(workspaceId) ?? new Set<string>();

    // Update diagnostics for files that produced active findings in this incomplete scan
    for (const [uriStr, { uri, diagnostics }] of newDiagnosticsByUri.entries()) {
      this.collection.set(uri, diagnostics);
      trackedUris.add(uriStr);
    }

    // Preserves previously tracked URIs without deleting:
    // Absence from an incomplete result must never be interpreted as resolution!
    this.workspaceTrackedUris.set(workspaceId, trackedUris);
  }

  /**
   * Groups active findings by their primary source URI and maps each to a VS Code Diagnostic.
   */
  private groupFindingsByUri(
    findings: readonly DiagnosticFindingSource[]
  ): Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }> {
    const map = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

    for (const finding of findings) {
      // Only active findings produce editor diagnostics
      if (finding.state !== "active") {
        continue;
      }

      const primarySpan = finding.sourceLocations?.[0];
      if (!primarySpan) {
        // Handle missing location conservatively: never fabricate source evidence
        continue;
      }

      const primaryUri = parseDocumentUri(primarySpan.uri);
      const primaryRange = sourceSpanToVsCodeRange(primarySpan);
      if (!primaryUri || !primaryRange) {
        continue;
      }

      const diagnostic = this.createDiagnostic(finding, primaryRange);
      if (!diagnostic) {
        continue;
      }

      const uriStr = primaryUri.toString();
      let entry = map.get(uriStr);
      if (!entry) {
        entry = { uri: primaryUri, diagnostics: [] };
        map.set(uriStr, entry);
      }
      entry.diagnostics.push(diagnostic);
    }

    return map;
  }

  /**
   * Creates a single VS Code Diagnostic from a finding and its primary Range.
   * Attaches DiagnosticRelatedInformation for consumer/provider side references.
   */
  public createDiagnostic(
    finding: DiagnosticFindingSource,
    range: vscode.Range
  ): vscode.Diagnostic {
    const vs = this.getVsCode();
    const severity = mapFindingSeverityToDiagnosticSeverity(finding.severity);
    const message = formatDiagnosticMessage(finding);

    const diagnostic = new vs.Diagnostic(range, message, severity);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = finding.ruleId;

    // Attach related information for additional source locations (consumer and provider sides)
    if (Array.isArray(finding.sourceLocations) && finding.sourceLocations.length > 1) {
      const relatedInfoList: vscode.DiagnosticRelatedInformation[] = [];

      for (let i = 1; i < finding.sourceLocations.length; i++) {
        const relatedSpan = finding.sourceLocations[i];
        const relatedUri = parseDocumentUri(relatedSpan.uri);
        const relatedRange = sourceSpanToVsCodeRange(relatedSpan);

        if (relatedUri && relatedRange) {
          const relatedMessage = `Related contract location: ${finding.title || finding.ruleId}`;
          const location = new vs.Location(relatedUri, relatedRange);
          relatedInfoList.push(new vs.DiagnosticRelatedInformation(location, relatedMessage));
        }
      }

      if (relatedInfoList.length > 0) {
        diagnostic.relatedInformation = relatedInfoList;
      }
    }

    return diagnostic;
  }

  /**
   * Retrieves diagnostics for a specific file URI.
   */
  public getDiagnostics(uri: vscode.Uri | string): readonly vscode.Diagnostic[] {
    const parsed = typeof uri === "string" ? parseDocumentUri(uri) : uri;
    if (!parsed) return [];
    return this.collection.get(parsed) ?? [];
  }

  /**
   * Returns tracked document URI strings for a workspace.
   */
  public getTrackedUris(workspaceId?: WorkspaceId): readonly string[] {
    if (workspaceId) {
      const set = this.workspaceTrackedUris.get(workspaceId);
      return set ? Array.from(set) : [];
    }
    const all = new Set<string>();
    for (const set of this.workspaceTrackedUris.values()) {
      for (const uri of set) {
        all.add(uri);
      }
    }
    return Array.from(all);
  }

  /**
   * Clears diagnostics for a specific workspace.
   */
  public clearForWorkspace(workspaceId: WorkspaceId): void {
    const tracked = this.workspaceTrackedUris.get(workspaceId);
    if (tracked) {
      for (const uriStr of tracked) {
        const uri = parseDocumentUri(uriStr);
        if (uri) {
          this.collection.delete(uri);
        }
      }
      this.workspaceTrackedUris.delete(workspaceId);
    }
  }

  /**
   * Clears all diagnostics across all workspaces.
   */
  public clear(): void {
    this.collection.clear();
    this.workspaceTrackedUris.clear();
  }

  /**
   * Disposes the diagnostic provider and frees all collection resources.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.collection.dispose();
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }
}
