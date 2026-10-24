// Phase 5, Chunk 5.4: Post-Edit Re-analysis, Verification & Acceptance
// Coordinates post-edit verification, binds verification to updated source documents,
// evaluates finding resolution strictly via accepted analysis reconciliation,
// and manages honest FixProposalStatus transitions without premature claims.

import type * as vscode from "vscode";
import type {
  DocumentUri,
  Finding,
  FindingId,
  FixProposal,
  FixProposalId,
  FixProposalStatus,
  FixTargetRole,
  WorkspaceId
} from "@undrift/core";
import type { AnalysisCoordinator, CoordinatorAnalysisResult } from "../activation/coordinator";
import type { ExtensionLogger } from "../logging/output-channel";
import type { ReportPanelManager } from "../views/report-panel";
import { computeContentHash } from "../workspace/source-snapshot-provider";
import type { FixProposalService } from "./fix-service";

/**
 * In-memory record tracking the application and post-edit verification of a repair proposal.
 */
export interface VerificationRecord {
  readonly proposalId: FixProposalId;
  readonly findingId: FindingId;
  readonly workspaceId: WorkspaceId;
  readonly targetRole: FixTargetRole;
  readonly originalGeneration: number;
  readonly affectedDocumentUris: readonly DocumentUri[];
  readonly proposal: FixProposal;
  readonly finding: Finding;
  status: FixProposalStatus; // "applied" (pending) | "verified" | "still_active" | "unresolved"
  readonly appliedAt: number;
  verifiedAt?: number;
  verifiedGeneration?: number;
  explanation?: string;
  expectedPostEditHashes?: ReadonlyMap<DocumentUri, string>;
}

/**
 * Handle returned to command handlers when verification begins.
 */
export interface VerificationSession {
  readonly record: VerificationRecord;
  cancel(): void;
  markAppliedAndScan(): Promise<void>;
}

/**
 * Computes expected post-edit content hashes for all affected documents in a proposal.
 * Uses exact slice replacement with edit.range.start and edit.range.end in descending order.
 */
export function computeExpectedPostEditHashes(
  proposal: FixProposal,
  documentSnapshots: ReadonlyMap<DocumentUri, { text: string }>
): Map<DocumentUri, string> {
  const expectedHashes = new Map<DocumentUri, string>();
  for (const [uri, snapshot] of documentSnapshots.entries()) {
    let text = snapshot.text;
    const docEdits = proposal.edits
      .filter((e) => e.documentUri === uri)
      .slice()
      .sort((a, b) => b.range.start - a.range.start);
    for (const edit of docEdits) {
      text = text.slice(0, edit.range.start) + edit.newText + text.slice(edit.range.end);
    }
    expectedHashes.set(uri, computeContentHash(text));
  }
  return expectedHashes;
}

/**
 * Constructor options for FixVerificationCoordinator.
 */
export interface FixVerificationOptions {
  readonly coordinator: AnalysisCoordinator;
  readonly fixService: FixProposalService;
  readonly reportPanelManager?: ReportPanelManager;
  readonly logger?: ExtensionLogger;
  readonly vscodeModule?: typeof vscode;
}

function getVsCode(injected?: typeof vscode): typeof vscode | undefined {
  if (injected) return injected;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("vscode");
  } catch {
    return undefined;
  }
}

/**
 * Verification coordinator managing the DETECT -> PROPOSE -> APPLY -> RE-ANALYZE -> VERIFY lifecycle.
 */
export class FixVerificationCoordinator {
  private readonly coordinator: AnalysisCoordinator;
  private readonly fixService: FixProposalService;
  private readonly reportPanelManager?: ReportPanelManager;
  private readonly logger?: ExtensionLogger;
  private readonly vscodeModule?: typeof vscode;

  private readonly records = new Map<FixProposalId, VerificationRecord>();
  private readonly pendingVerifications = new Map<FixProposalId, VerificationRecord>();
  private readonly verificationListeners = new Set<(record: VerificationRecord) => void>();

  private coordinatorSubscription?: { dispose(): void };
  private disposed = false;

  constructor(options: FixVerificationOptions) {
    this.coordinator = options.coordinator;
    this.fixService = options.fixService;
    this.reportPanelManager = options.reportPanelManager;
    this.logger = options.logger;
    this.vscodeModule = options.vscodeModule;

    // Attach to coordinator analysis outcomes early to guarantee no completed scan is missed
    if (typeof this.coordinator?.onAnalysisCompleted === "function") {
      this.coordinatorSubscription = this.coordinator.onAnalysisCompleted((outcome) => {
        this.handleAnalysisCompleted(outcome);
      });
    }
  }

  /**
   * Registers a pending verification for an approved proposal before edits are applied.
   */
  public beginVerification(
    proposal: FixProposal,
    finding: Finding,
    expectedPostEditHashes?: ReadonlyMap<DocumentUri, string>
  ): VerificationSession {
    if (this.disposed) {
      throw new Error("Cannot begin verification: FixVerificationCoordinator is disposed.");
    }

    const wsId = proposal.workspaceId;
    if (!wsId || wsId.trim() === "") {
      throw new Error(`Cannot begin verification: proposal '${proposal.id}' has no workspaceId.`);
    }

    const originalGen =
      proposal.generation ??
      (typeof this.coordinator?.getCurrentGeneration === "function"
        ? this.coordinator.getCurrentGeneration(wsId)
        : 1);

    const record: VerificationRecord = {
      proposalId: proposal.id,
      findingId: finding.id,
      workspaceId: wsId,
      targetRole: proposal.targetRole,
      originalGeneration: originalGen,
      affectedDocumentUris: proposal.edits.map((e) => e.documentUri),
      proposal: { ...proposal, status: "applied" },
      finding,
      status: "applied",
      appliedAt: Date.now(),
      expectedPostEditHashes
    };

    this.records.set(proposal.id, record);
    this.pendingVerifications.set(proposal.id, record);

    this.logger?.info(
      `Registered pending verification for proposal '${proposal.id}', finding '${finding.id}', workspace '${wsId}', generation ${originalGen}.`
    );

    return {
      record,
      cancel: () => this.cancelVerification(proposal.id),
      markAppliedAndScan: async () => this.markAppliedAndScan(proposal.id)
    };
  }

  /**
   * Cancels a pending verification if edit application is declined, cancelled, or fails.
   */
  public cancelVerification(proposalId: FixProposalId): void {
    const record = this.pendingVerifications.get(proposalId);
    if (record) {
      this.pendingVerifications.delete(proposalId);
      this.records.delete(proposalId);
      this.logger?.info(`Cancelled pending verification for proposal '${proposalId}'.`);
    }
  }

  /**
   * Marks a proposal as applied and triggers an immediate workspace scan.
   */
  public async markAppliedAndScan(proposalId: FixProposalId): Promise<void> {
    const record = this.pendingVerifications.get(proposalId);
    if (!record) {
      return;
    }

    record.status = "applied";
    (record.proposal as { status: FixProposalStatus }).status = "applied";
    this.reportPanelManager?.updateWebviewContent();

    this.logger?.info(
      `Marked proposal '${proposalId}' as applied. Triggering immediate post-edit workspace re-scan...`
    );

    try {
      if (typeof this.coordinator?.getScheduler === "function") {
        await this.coordinator.getScheduler().runImmediateScan();
      }
    } catch (err) {
      this.logger?.error("Failed to trigger immediate post-edit scan", err);
    }
  }

  /**
   * Handles coordinator analysis outcomes and resolves pending verifications honestly.
   */
  public handleAnalysisCompleted(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed || this.pendingVerifications.size === 0) {
      return;
    }

    const wsId = outcome.workspaceId;
    if (!wsId) {
      return;
    }

    for (const [proposalId, record] of Array.from(this.pendingVerifications.entries())) {
      if (record.workspaceId !== wsId) {
        // Belongs to a different workspace -> ignore
        continue;
      }

      // Check generation monotonicity: outcome must be strictly newer than the proposal generation
      if (outcome.generation !== undefined && outcome.generation <= record.originalGeneration) {
        this.logger?.info(
          `Ignoring pre-edit outcome: generation ${outcome.generation} <= proposal generation ${record.originalGeneration}.`
        );
        continue;
      }

      // Check superseded status: tolerate superseding if an active scan is still running
      if (outcome.status === "superseded") {
        const activeScan = this.coordinator.getActiveScan(wsId);
        if (activeScan && !activeScan.isObsolete) {
          this.logger?.info(
            `Analysis generation ${outcome.generation} superseded; awaiting active scan generation ${activeScan.generation}.`
          );
          continue;
        }
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Analysis was superseded by another scan."
        );
        continue;
      }

      if (outcome.status === "cancelled") {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Post-edit analysis was cancelled."
        );
        continue;
      }

      if (outcome.status === "failed") {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          outcome.errorMessage ?? "Post-edit analysis failed."
        );
        continue;
      }

      const isComplete =
        outcome.result?.complete === true ||
        (outcome.result as unknown as Record<string, unknown>)?.completeness === "complete";
      const hasCoverage =
        outcome.reconciliation === undefined || outcome.reconciliation.coverageSufficient;

      if (outcome.status === "incomplete" || !isComplete || !hasCoverage) {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Analysis coverage was incomplete; cannot confirm resolution."
        );
        continue;
      }

      // Outcome status is complete and accepted!
      // Verify source document coverage and content hash binding
      const acceptedDocs =
        typeof this.coordinator?.getLastAcceptedSourceDocuments === "function"
          ? this.coordinator.getLastAcceptedSourceDocuments(wsId)
          : undefined;

      if (
        record.expectedPostEditHashes &&
        record.expectedPostEditHashes.size > 0 &&
        (!acceptedDocs || acceptedDocs.size === 0)
      ) {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "No accepted source documents found in analysis result."
        );
        continue;
      }

      let allDocsCovered = true;
      let hashMismatch = false;

      if (acceptedDocs) {
        for (const uri of record.affectedDocumentUris) {
          const doc = acceptedDocs.get(uri);
          if (!doc) {
            allDocsCovered = false;
            break;
          }
          if (record.expectedPostEditHashes && record.expectedPostEditHashes.has(uri)) {
            const expectedHash = record.expectedPostEditHashes.get(uri);
            if (doc.contentHash !== expectedHash) {
              hashMismatch = true;
              break;
            }
          }
        }
      } else if (record.expectedPostEditHashes && record.expectedPostEditHashes.size > 0) {
        allDocsCovered = false;
      }

      if (!allDocsCovered) {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Affected document was omitted from verified source scope."
        );
        continue;
      }

      if (hashMismatch) {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Source document content hash changed again before verification completed."
        );
        continue;
      }

      // Evaluate finding resolution:
      // 1. Reconciler explicit resolved transition
      const resolvedEvent = outcome.reconciliation?.eventsEmitted?.find(
        (e) => e.findingId === record.findingId && e.transitionKind === "resolved"
      );

      // 2. Active finding still present in outcome
      const findings = outcome.result?.findings ?? [];
      const stillActiveFinding = findings.find(
        (f) =>
          f.id === record.findingId ||
          (f.ruleId === record.finding.ruleId &&
            f.sourceLocations.some((loc) => record.affectedDocumentUris.includes(loc.uri)))
      );

      if (stillActiveFinding) {
        this.finalizeVerification(
          proposalId,
          record,
          "still_active",
          outcome.generation,
          "Re-analysis confirmed contract drift remains active."
        );
      } else if (resolvedEvent || outcome.reconciliation?.coverageSufficient) {
        this.finalizeVerification(
          proposalId,
          record,
          "verified",
          outcome.generation,
          `Finding resolved in accepted generation ${outcome.generation}.`
        );
      } else {
        this.finalizeVerification(
          proposalId,
          record,
          "unresolved",
          outcome.generation,
          "Analysis completed but could not establish resolution."
        );
      }
    }
  }

  private finalizeVerification(
    proposalId: FixProposalId,
    record: VerificationRecord,
    status: "verified" | "still_active" | "unresolved",
    generation: number | undefined,
    explanation: string
  ): void {
    // Remove from pending map so verification cannot be completed twice
    this.pendingVerifications.delete(proposalId);

    record.status = status;
    record.verifiedAt = Date.now();
    record.verifiedGeneration = generation;
    record.explanation = explanation;

    (record.proposal as { status: FixProposalStatus }).status = status;

    this.logger?.info(
      `Verification for proposal '${proposalId}' finalized as '${status}': ${explanation}`
    );

    // Notify listeners
    for (const listener of Array.from(this.verificationListeners)) {
      try {
        listener(record);
      } catch (err) {
        this.logger?.error("Verification listener error", err);
      }
    }

    // User-facing notifications
    const vs = getVsCode(this.vscodeModule);
    if (vs?.window) {
      if (status === "verified") {
        void vs.window.showInformationMessage(
          `UNDRIFT: Repair verified for "${record.proposal.title}". Original finding resolved (generation ${generation ?? "fresh"}).`
        );
      } else if (status === "still_active") {
        void vs.window.showWarningMessage(
          `UNDRIFT: Repair applied for "${record.proposal.title}", but contract drift remains active (generation ${generation ?? "fresh"}).`
        );
      } else {
        void vs.window.showWarningMessage(
          `UNDRIFT: Repair applied for "${record.proposal.title}", but resolution could not be verified (${explanation}).`
        );
      }
    }

    // Update report panel webview if active
    this.reportPanelManager?.updateWebviewContent();
  }

  /**
   * Retrieves a verification record for a proposal ID.
   */
  public getRecord(proposalId: FixProposalId): VerificationRecord | undefined {
    return this.records.get(proposalId);
  }

  /**
   * Retrieves all verification records, optionally filtered by workspace.
   */
  public getRecords(workspaceId?: WorkspaceId): VerificationRecord[] {
    const all = Array.from(this.records.values());
    return workspaceId ? all.filter((r) => r.workspaceId === workspaceId) : all;
  }

  /**
   * Returns the count of pending verifications.
   */
  public getPendingCount(): number {
    return this.pendingVerifications.size;
  }

  /**
   * Subscribes to verification completion events.
   */
  public onVerificationCompleted(listener: (record: VerificationRecord) => void): {
    dispose(): void;
  } {
    this.verificationListeners.add(listener);
    return {
      dispose: () => {
        this.verificationListeners.delete(listener);
      }
    };
  }

  /**
   * Waits for verification of a proposal to finalize (useful for deterministic tests).
   */
  public waitForVerification(
    proposalId: FixProposalId,
    timeoutMs = 5000
  ): Promise<VerificationRecord> {
    const existing = this.records.get(proposalId);
    if (existing && existing.status !== "applied") {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.dispose();
        reject(
          new Error(`Verification timeout for proposal '${proposalId}' after ${timeoutMs}ms.`)
        );
      }, timeoutMs);

      const sub = this.onVerificationCompleted((rec) => {
        if (rec.proposalId === proposalId) {
          clearTimeout(timer);
          sub.dispose();
          resolve(rec);
        }
      });
    });
  }

  /**
   * Safely disposes the coordinator and its listener subscriptions.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.coordinatorSubscription?.dispose();
    this.coordinatorSubscription = undefined;
    this.pendingVerifications.clear();
    this.verificationListeners.clear();
  }
}
