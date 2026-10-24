import type * as vscode from "vscode";
import type { DocumentUri, FixProposalId, SourceSpan } from "@undrift/core";
import type { AnalysisCoordinator } from "../activation/coordinator";
import {
  FixStalenessValidator,
  FixVerificationCoordinator,
  computeExpectedPostEditHashes,
  prepareFixWorkspaceEdit,
  type FixProposalService
} from "../fixes";
import type { ExtensionLogger } from "../logging/output-channel";
import type { DriftStatusBar } from "../status";
import {
  openFindingLocation,
  type FindingsTreeDataProvider,
  type ReportPanelManager
} from "../views";
import { computeContentHash } from "../workspace";

/**
 * Formats user-facing warning message for an incomplete analysis scan.
 */
export function formatIncompleteScanMessage(
  filesCount: number,
  findingsCount: number,
  failuresCount: number
): string {
  const failureDetail =
    failuresCount > 0
      ? ` (${failuresCount} file${failuresCount === 1 ? "" : "s"} could not be acquired)`
      : "";
  return `UNDRIFT: Analysis incomplete${failureDetail}. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} finding${findingsCount === 1 ? "" : "s"}.`;
}

export interface CommandDependencies {
  coordinator: AnalysisCoordinator;
  reportPanelManager: ReportPanelManager;
  fixService?: FixProposalService;
  fixValidator?: FixStalenessValidator;
  verificationCoordinator?: FixVerificationCoordinator;
  treeProvider?: FindingsTreeDataProvider;
  statusBar?: DriftStatusBar;
  logger?: ExtensionLogger;
  vscodeModule?: typeof vscode;
}

/**
 * Registers all UNDRIFT extension commands and returns disposables for cleanup.
 */
export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vs = deps.vscodeModule ?? require("vscode");
  const disposables: vscode.Disposable[] = [];

  // 1. undrift.scanWorkspace
  disposables.push(
    vs.commands.registerCommand("undrift.scanWorkspace", async () => {
      deps.statusBar?.setAnalyzing();
      try {
        const outcome = await deps.coordinator.getScheduler().runImmediateScan();

        switch (outcome.status) {
          case "success": {
            const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
            const findingsCount = outcome.result?.findings.length ?? 0;
            if (outcome.persistenceStatus === "failed") {
              const reason = outcome.persistenceError ? `: ${outcome.persistenceError}` : "";
              deps.logger?.error(`State persistence failed${reason}`);
              void vs.window.showWarningMessage(
                `UNDRIFT: Analysis complete (${findingsCount} finding${findingsCount === 1 ? "" : "s"}), but failed to save analysis state${reason}.`
              );
            } else {
              void vs.window.showInformationMessage(
                `UNDRIFT: Analysis complete. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} contract drift finding${findingsCount === 1 ? "" : "s"}.`
              );
            }
            break;
          }

          case "incomplete": {
            const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
            const findingsCount = outcome.result?.findings.length ?? 0;
            const failuresCount = outcome.failures?.length ?? 0;
            void vs.window.showWarningMessage(
              formatIncompleteScanMessage(filesCount, findingsCount, failuresCount)
            );
            break;
          }

          case "cancelled": {
            deps.logger?.info("UNDRIFT: Workspace analysis was cancelled.");
            break;
          }

          case "superseded": {
            deps.logger?.info("UNDRIFT: Workspace analysis was superseded by a newer scan.");
            break;
          }

          case "no-workspace": {
            void vs.window.showInformationMessage(
              "UNDRIFT: No workspace folder is currently open in VS Code."
            );
            break;
          }

          case "failed": {
            const msg = outcome.errorMessage ?? "Workspace analysis failed.";
            deps.logger?.error(`Analysis failed: ${msg}`);
            void vs.window.showErrorMessage(`UNDRIFT: Analysis failed — ${msg}`);
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Unexpected error executing workspace scan", err);
        void vs.window.showErrorMessage(`UNDRIFT: Scan encountered an error: ${msg}`);
      }
    })
  );

  // 2. undrift.refresh
  disposables.push(
    vs.commands.registerCommand("undrift.refresh", async () => {
      deps.treeProvider?.refresh();
      deps.statusBar?.setAnalyzing();
      await deps.coordinator.getScheduler().runImmediateScan();
    })
  );

  // 3. undrift.showReport
  disposables.push(
    vs.commands.registerCommand(
      "undrift.showReport",
      async (targetFindingId?: string, targetProposalId?: string) => {
        if (targetProposalId !== undefined) {
          await deps.reportPanelManager.show(targetFindingId, targetProposalId);
        } else {
          await deps.reportPanelManager.show(targetFindingId);
        }
      }
    )
  );

  // 4. undrift.explainFinding
  disposables.push(
    vs.commands.registerCommand("undrift.explainFinding", async (arg?: unknown) => {
      let targetFindingId: string | undefined;

      if (typeof arg === "string" && arg) {
        targetFindingId = arg;
      } else if (arg && typeof arg === "object") {
        if (
          "finding" in arg &&
          arg.finding &&
          typeof (arg.finding as { id?: string }).id === "string"
        ) {
          targetFindingId = (arg.finding as { id: string }).id;
        } else if ("id" in arg && typeof (arg as { id?: string }).id === "string") {
          targetFindingId = (arg as { id: string }).id;
        }
      }

      if (targetFindingId) {
        await deps.reportPanelManager.show(targetFindingId);
        return;
      }

      // No argument provided: show quickpick from active findings
      const wsId = deps.coordinator.getActiveWorkspaceId();
      const snapshot = wsId ? deps.coordinator.getLastKnownSnapshot(wsId) : undefined;
      const findings = snapshot?.findings.filter((f) => f.state !== "resolved") ?? [];

      if (findings.length === 0) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No active contract drift findings to explain in the current workspace."
        );
        await deps.reportPanelManager.show();
        return;
      }

      if (findings.length === 1) {
        await deps.reportPanelManager.show(findings[0].id);
        return;
      }

      const quickPickItems = findings.map((f) => ({
        label: f.title,
        description: `[${f.ruleId}] ${f.severity}`,
        detail: f.summary,
        findingId: f.id
      }));

      const picked = await vs.window.showQuickPick(quickPickItems, {
        placeHolder: "Select a contract drift finding to explain"
      });

      if (picked) {
        await deps.reportPanelManager.show(picked.findingId);
      }
    })
  );

  // 5. undrift.resetHistory
  disposables.push(
    vs.commands.registerCommand("undrift.resetHistory", async () => {
      const wsId = deps.coordinator.getActiveWorkspaceId();
      if (!wsId) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No workspace folder is currently open in VS Code."
        );
        return;
      }

      const choice = await vs.window.showWarningMessage(
        `Reset UNDRIFT drift history for workspace "${wsId}"? This will clear all historical lifecycle events while preserving the latest snapshot.`,
        { modal: true },
        "Reset History"
      );

      if (choice !== "Reset History") {
        return;
      }

      try {
        await deps.coordinator.resetHistory(wsId);
        deps.reportPanelManager.handleHistoryReset(wsId);
        deps.treeProvider?.refresh();
        void vs.window.showInformationMessage(
          "UNDRIFT: Drift history reset successfully for this workspace."
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Failed to reset drift history", err);
        void vs.window.showErrorMessage(`UNDRIFT: Failed to reset drift history: ${msg}`);
      }
    })
  );

  // 6. undrift.clearCache
  disposables.push(
    vs.commands.registerCommand("undrift.clearCache", async () => {
      const wsId = deps.coordinator.getActiveWorkspaceId();
      if (!wsId) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No workspace folder is currently open in VS Code."
        );
        return;
      }

      try {
        await deps.coordinator.clearCache();
        deps.logger?.info("In-memory workspace state cache cleared; re-scanning workspace...");
        void vs.window.showInformationMessage(
          "UNDRIFT: In-memory workspace state cache cleared (saved snapshots and lifecycle history are preserved). Re-scanning workspace..."
        );
        deps.statusBar?.setAnalyzing();
        await deps.coordinator.getScheduler().runImmediateScan();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Failed to clear in-memory workspace state cache", err);
        void vs.window.showErrorMessage(
          `UNDRIFT: Failed to clear in-memory workspace state cache: ${msg}`
        );
      }
    })
  );

  // 7. undrift.openFindingLocation
  disposables.push(
    vs.commands.registerCommand("undrift.openFindingLocation", async (span?: SourceSpan) => {
      await openFindingLocation(span, vs);
    })
  );

  // 8. undrift.applyFix
  disposables.push(
    vs.commands.registerCommand("undrift.applyFix", async (proposalIdArg?: unknown) => {
      let proposalId: string | undefined;
      if (typeof proposalIdArg === "string" && proposalIdArg.trim() !== "") {
        proposalId = proposalIdArg.trim();
      } else if (
        proposalIdArg &&
        typeof proposalIdArg === "object" &&
        "proposalId" in proposalIdArg &&
        typeof (proposalIdArg as { proposalId: unknown }).proposalId === "string"
      ) {
        proposalId = (proposalIdArg as { proposalId: string }).proposalId.trim();
      }

      const wsId = deps.coordinator.getActiveWorkspaceId();
      if (!wsId) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No workspace folder is currently open in VS Code."
        );
        return;
      }

      if (!deps.fixService) {
        void vs.window.showErrorMessage("UNDRIFT: Fix proposal service is not available.");
        return;
      }

      if (!proposalId) {
        const allProposals = deps.fixService.getAllProposals(wsId);
        const items: Array<{
          label: string;
          description: string;
          detail: string;
          proposalId: string;
        }> = [];
        for (const [findingId, proposals] of allProposals.entries()) {
          for (const prop of proposals) {
            items.push({
              label: prop.title,
              description: `[${prop.targetRole}] finding: ${findingId}`,
              detail: prop.rationale,
              proposalId: prop.id
            });
          }
        }

        if (items.length === 0) {
          void vs.window.showInformationMessage(
            "UNDRIFT: No actionable repair proposals available in the current workspace."
          );
          return;
        }

        const picked = await vs.window.showQuickPick(items, {
          placeHolder: "Select a candidate repair proposal to review and apply"
        });
        if (!picked) {
          return;
        }
        proposalId = picked.proposalId;
      }

      const resolved = deps.fixService.getProposalById(proposalId as FixProposalId, wsId);
      if (!resolved) {
        void vs.window.showWarningMessage(
          `UNDRIFT: Repair proposal '${proposalId}' is no longer valid or could not be found. Please re-analyze the workspace for fresh proposals.`
        );
        return;
      }

      const { proposal, finding } = resolved;

      if (!proposal.workspaceId || proposal.workspaceId !== wsId) {
        void vs.window.showErrorMessage(
          `UNDRIFT: Cannot apply proposal '${proposal.id}': workspace identity mismatch (originates from '${proposal.workspaceId ?? "unknown"}', active workspace is '${wsId}').`
        );
        return;
      }

      const targetSide =
        proposal.targetRole === "consumer" ? "frontend consumer" : "backend provider";
      const choice = await vs.window.showInformationMessage(
        `Apply ${targetSide} repair: "${proposal.title}"?\n\nThis will edit ${proposal.edits.length} file(s). Post-edit re-analysis will verify contract alignment.`,
        { modal: true },
        "Apply Repair"
      );

      if (choice !== "Apply Repair") {
        return;
      }

      const validator =
        deps.fixValidator ??
        new FixStalenessValidator({
          documentAccessor: {
            getOpenDocuments: () => {
              if (!vs?.workspace?.textDocuments) return [];
              return vs.workspace.textDocuments.map((doc: vscode.TextDocument) => ({
                uri: doc.uri ? doc.uri.toString() : String(doc),
                text: typeof doc.getText === "function" ? doc.getText() : "",
                version: doc.version
              }));
            },
            readDocumentText: async (uriStr) => {
              if (!vs?.workspace) return undefined;
              const openDoc = vs.workspace.textDocuments?.find(
                (d: vscode.TextDocument) => d.uri?.toString() === uriStr
              );
              if (openDoc) {
                return {
                  uri: uriStr,
                  text: typeof openDoc.getText === "function" ? openDoc.getText() : "",
                  version: openDoc.version
                };
              }
              if (vs.workspace.fs?.readFile) {
                try {
                  const uri = vs.Uri.parse(uriStr);
                  const bytes = await vs.workspace.fs.readFile(uri);
                  const text = Buffer.from(bytes).toString("utf8");
                  return { uri: uriStr, text, version: undefined };
                } catch {
                  return undefined;
                }
              }
              return undefined;
            },
            documentExists: async (uriStr) => {
              if (!vs?.workspace) return false;
              const isOpen = vs.workspace.textDocuments?.some(
                (d: vscode.TextDocument) => d.uri?.toString() === uriStr
              );
              if (isOpen) return true;
              if (vs.workspace.fs?.stat) {
                try {
                  const uri = vs.Uri.parse(uriStr);
                  await vs.workspace.fs.stat(uri);
                  return true;
                } catch {
                  return false;
                }
              }
              return false;
            }
          }
        });

      const validationResult = await validator.validateProposal(proposal, {
        targetWorkspaceId: wsId,
        coordinator: deps.coordinator
      });

      if (!validationResult.valid) {
        deps.logger?.warn(`Fix proposal validation failed: ${validationResult.message}`);
        void vs.window.showWarningMessage(
          `UNDRIFT: Cannot apply repair: ${validationResult.message} Please re-scan the workspace.`
        );
        return;
      }

      let prepared;
      try {
        prepared = prepareFixWorkspaceEdit(validationResult, {
          expectedTargetRole: proposal.targetRole,
          workspaceEditFactory: () => new vs.WorkspaceEdit(),
          uriParser: (u) => vs.Uri.parse(u)
        });
      } catch (prepErr) {
        const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
        deps.logger?.error("Failed to prepare WorkspaceEdit", prepErr);
        void vs.window.showErrorMessage(`UNDRIFT: Failed to prepare repair edit: ${msg}`);
        return;
      }

      // 3.A: Register or establish observation path early enough that a fast subsequent analysis cannot be missed
      const verifier =
        deps.verificationCoordinator ??
        new FixVerificationCoordinator({
          coordinator: deps.coordinator,
          fixService: deps.fixService,
          reportPanelManager: deps.reportPanelManager,
          logger: deps.logger,
          vscodeModule: vs
        });

      const expectedHashes = computeExpectedPostEditHashes(
        proposal,
        validationResult.documentSnapshots
      );

      const session = verifier.beginVerification(proposal, finding, expectedHashes);

      try {
        const success = await vs.workspace.applyEdit(prepared.workspaceEdit);
        if (!success) {
          session.cancel();
          deps.logger?.error("vscode.workspace.applyEdit returned false.");
          void vs.window.showErrorMessage(
            "UNDRIFT: VS Code could not apply the repair edit. Please check if the target document is locked or has unsaved conflicting changes."
          );
          return;
        }

        deps.logger?.info(
          `Successfully applied repair proposal '${proposal.id}' for finding '${finding.id}'.`
        );
        void vs.window.showInformationMessage(
          `UNDRIFT: Repair edit applied successfully for "${proposal.title}". Verifying contract drift resolution...`
        );

        // 3.B: Record proposal as applied and trigger immediate post-edit workspace analysis
        await session.markAppliedAndScan();
      } catch (applyErr) {
        session.cancel();
        const msg = applyErr instanceof Error ? applyErr.message : String(applyErr);
        deps.logger?.error("Exception applying WorkspaceEdit", applyErr);
        void vs.window.showErrorMessage(`UNDRIFT: Error applying repair edit: ${msg}`);
      }
    })
  );

  return disposables;
}
