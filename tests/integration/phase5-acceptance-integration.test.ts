/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 5, Chunk 5.4: Post-Edit Re-analysis, Verification & Acceptance
// Full End-to-End Integration Tests covering DETECT -> EXPLAIN -> PROPOSE -> REVIEW/APPLY -> RE-ANALYZE -> VERIFY
// strictly adhering to LLD.md Sections 13, 14, 16 and Chunk 5.4 requirements.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentUri,
  Finding,
  FindingId,
  FixProposal,
  FixProposalId,
  SourceDocument,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine, StateReconciler } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator } from "../../apps/vscode-extension/src/activation/coordinator";
import { registerCommands } from "../../apps/vscode-extension/src/commands/register-commands";
import { DriftDiagnosticProvider } from "../../apps/vscode-extension/src/diagnostics/diagnostic-provider";
import {
  FixProposalService,
  FixStalenessValidator,
  FixVerificationCoordinator,
  prepareFixWorkspaceEdit
} from "../../apps/vscode-extension/src/fixes";
import { ReportPanelManager } from "../../apps/vscode-extension/src/views/report-panel";
import { computeContentHash } from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";
import type { WorkspaceManager } from "../../apps/vscode-extension/src/workspace/workspace-manager";

// ----------------------------------------------------------------------------
// VS Code Mock Harness
// ----------------------------------------------------------------------------

const {
  MockPosition,
  MockRange,
  MockUri,
  MockWorkspaceEdit,
  mockVsCodeModule,
  registeredCommands
} = vi.hoisted(() => {
  class MockPosition {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  }

  class MockRange {
    constructor(
      public readonly start: MockPosition,
      public readonly end: MockPosition
    ) {}
  }

  class MockUri {
    constructor(
      public readonly scheme: string,
      public readonly authority: string,
      public readonly path: string
    ) {}

    static parse(val: string): MockUri {
      try {
        const u = new URL(val);
        return new MockUri(u.protocol.replace(":", ""), u.host, u.pathname);
      } catch {
        return new MockUri("file", "", val);
      }
    }

    static file(fsPath: string): MockUri {
      return new MockUri("file", "", fsPath);
    }

    get fsPath(): string {
      return this.path;
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  class MockWorkspaceEdit {
    public entries: Array<{ uri: MockUri; range: MockRange; newText: string }> = [];

    replace(uri: MockUri, range: MockRange, newText: string): void {
      this.entries.push({ uri, range, newText });
    }

    get size(): number {
      return this.entries.length;
    }
  }

  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    WorkspaceEdit: MockWorkspaceEdit,
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(),
      createWebviewPanel: vi.fn(() => ({
        webview: {
          html: "",
          onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
          postMessage: vi.fn().mockResolvedValue(true)
        },
        reveal: vi.fn(),
        onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        dispose: vi.fn()
      }))
    },
    workspace: {
      workspaceFolders: [
        {
          uri: MockUri.parse("file:///workspace/api-app"),
          name: "api-app",
          index: 0
        }
      ],
      applyEdit: vi.fn().mockResolvedValue(true),
      fs: {
        readFile: vi.fn(),
        stat: vi.fn()
      },
      textDocuments: [] as unknown[]
    },
    commands: {
      registerCommand: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
        registeredCommands.set(name, callback);
        return {
          dispose: () => {
            registeredCommands.delete(name);
          }
        };
      }),
      executeCommand: vi.fn((name: string, ...args: unknown[]) => {
        const handler = registeredCommands.get(name);
        if (!handler) {
          throw new Error(`Command ${name} not registered`);
        }
        return handler(...args);
      })
    }
  };

  return {
    MockPosition,
    MockRange,
    MockUri,
    MockWorkspaceEdit,
    mockVsCodeModule,
    registeredCommands
  };
});

vi.mock("vscode", () => mockVsCodeModule);

// ----------------------------------------------------------------------------
// Acceptance Test Suite
// ----------------------------------------------------------------------------

describe("Phase 5, Chunk 5.4: Post-Edit Re-analysis, Verification & Acceptance Integration", () => {
  const wsId: WorkspaceId = "file:///workspace/api-app" as WorkspaceId;
  const clientUri: DocumentUri = "file:///workspace/api-app/src/client.ts" as DocumentUri;
  const serverUri: DocumentUri = "file:///workspace/api-app/src/server.ts" as DocumentUri;

  // Realistic source fixtures: frontend fetch calling GET /api/users, backend Express declaring POST /api/users
  const initialClientSource =
    [
      "export async function getUsers() {",
      '  return fetch("/api/users", {',
      '    method: "GET"',
      "  });",
      "}"
    ].join("\n") + "\n";

  const initialServerSource =
    [
      'import express from "express";',
      "const app = express();",
      "",
      'app.post("/api/users", (req, res) => {',
      "  res.json({ users: [] });",
      "});"
    ].join("\n") + "\n";

  let parser: TreeSitterParserAdapter;
  let analyzer: JsTsAnalyzer;
  let engine: AnalysisEngine;
  let reconciler: StateReconciler;
  let coordinator: AnalysisCoordinator;
  let fixService: FixProposalService;
  let reportPanelManager: ReportPanelManager;
  let verificationCoordinator: FixVerificationCoordinator;
  let documentStore: Map<DocumentUri, string>;

  function createTestWorkspaceManager(): WorkspaceManager {
    return {
      getWorkspaceRoots: () => [wsId],
      createWorkspaceSnapshot: async () => {
        const documents: SourceDocument[] = [];
        for (const [uri, text] of documentStore.entries()) {
          documents.push({
            uri,
            languageId: "typescript",
            text,
            contentHash: computeContentHash(text),
            documentVersion: 1
          });
        }
        return {
          status: "success",
          workspaceRootUris: [wsId],
          documents,
          failures: [],
          totalDiscovered: documents.length,
          totalAcquired: documents.length
        };
      }
    } as unknown as WorkspaceManager;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();

    documentStore = new Map<DocumentUri, string>([
      [clientUri, initialClientSource],
      [serverUri, initialServerSource]
    ]);

    // Setup mock VS Code fs to reflect documentStore
    const enc = new TextEncoder();
    mockVsCodeModule.workspace.fs.readFile.mockImplementation(
      async (uri: { toString(): string }) => {
        const text = documentStore.get(uri.toString() as DocumentUri);
        if (text === undefined) {
          throw new Error(`File not found: ${uri.toString()}`);
        }
        return enc.encode(text);
      }
    );

    mockVsCodeModule.workspace.fs.stat.mockResolvedValue({ mtime: 1000 });

    // Mock applyEdit to update documentStore in-memory
    mockVsCodeModule.workspace.applyEdit.mockImplementation(async (edit: MockWorkspaceEdit) => {
      for (const entry of edit.entries) {
        const uriStr = entry.uri.toString() as DocumentUri;
        const current = documentStore.get(uriStr);
        if (current === undefined) continue;

        // Apply line/character replacements
        const lines = current.split("\n");
        const startLine = entry.range.start.line;
        const startChar = entry.range.start.character;
        const endLine = entry.range.end.line;
        const endChar = entry.range.end.character;

        if (startLine === endLine) {
          const line = lines[startLine];
          lines[startLine] = line.slice(0, startChar) + entry.newText + line.slice(endChar);
        } else {
          const before = lines[startLine].slice(0, startChar);
          const after = lines[endLine].slice(endChar);
          lines.splice(startLine, endLine - startLine + 1, before + entry.newText + after);
        }
        documentStore.set(uriStr, lines.join("\n"));
      }
      return true;
    });

    // Real analysis components
    parser = new TreeSitterParserAdapter();
    analyzer = new JsTsAnalyzer();
    engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [analyzer]
    });
    reconciler = new StateReconciler();

    coordinator = new AnalysisCoordinator({
      workspaceManager: createTestWorkspaceManager(),
      engine,
      ownsEngine: true,
      reconciler,
      diagnosticProvider: new DriftDiagnosticProvider()
    });

    fixService = new FixProposalService(coordinator);

    reportPanelManager = new ReportPanelManager({
      coordinator,
      fixService,
      vscodeModule: mockVsCodeModule as any
    });

    verificationCoordinator = new FixVerificationCoordinator({
      coordinator,
      fixService,
      reportPanelManager,
      vscodeModule: mockVsCodeModule as any
    });

    fixService.setVerificationCoordinator(verificationCoordinator);

    registerCommands({
      coordinator,
      reportPanelManager,
      fixService,
      verificationCoordinator,
      vscodeModule: mockVsCodeModule as any
    });
  });

  afterEach(async () => {
    verificationCoordinator.dispose();
    reportPanelManager.dispose();
    await coordinator.dispose();
    parser.dispose();
  });

  // ==========================================================================
  // Section A: Minimum Complete Repair Workflow
  // ==========================================================================

  describe("Section A: Minimum Complete Repair Workflow", () => {
    it("executes complete repair loop for consumer alternative: DETECT -> PROPOSE -> APPLY -> RE-ANALYZE -> VERIFY", async () => {
      // 1. Initial Analysis detects UND120
      const initialOutcome = await coordinator.runWorkspaceScan();
      expect(initialOutcome.status).toBe("success");
      expect(initialOutcome.result.findings.length).toBe(1);

      const finding = initialOutcome.result.findings[0];
      expect(finding.ruleId).toBe("UND120");
      expect(finding.expected).toBe("GET");
      expect(finding.observed).toBe("POST");

      // 2. Proposal generation produces separate consumer and provider alternatives
      const proposals = fixService.getProposalsForFinding(finding.id, wsId);
      expect(proposals.length).toBe(2);

      const consumerProposal = proposals.find((p) => p.targetRole === "consumer");
      const providerProposal = proposals.find((p) => p.targetRole === "provider");
      expect(consumerProposal).toBeDefined();
      expect(providerProposal).toBeDefined();

      expect(consumerProposal!.title).toContain("Change frontend request method to POST");
      expect(consumerProposal!.status).toBe("proposed");

      // 3. User reviews and confirms consumer repair
      mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

      const applyFix = registeredCommands.get("undrift.applyFix")!;
      expect(applyFix).toBeDefined();

      // Track verification completion deterministically
      const verificationPromise = verificationCoordinator.waitForVerification(consumerProposal!.id);

      // Execute apply repair
      await applyFix(consumerProposal!.id);

      // 4. Source contains exact intended replacement with surrounding code preserved
      const updatedClientText = documentStore.get(clientUri)!;
      expect(updatedClientText).toContain('method: "POST"');
      expect(updatedClientText).toContain("export async function getUsers()");
      expect(updatedClientText).not.toContain('method: "GET"');

      // 5. Post-edit verification coordinator binds verification to fresh analysis
      const verifiedRecord = await verificationPromise;
      expect(verifiedRecord.status).toBe("verified");
      expect(verifiedRecord.verifiedGeneration).toBeGreaterThan(consumerProposal!.generation!);
      expect(verifiedRecord.explanation).toContain("Finding resolved in accepted generation");

      // 6. Proposal lifecycle status is verified
      const updatedProposal = fixService.getProposalById(consumerProposal!.id, wsId);
      expect(updatedProposal).toBeDefined();
      expect(updatedProposal!.proposal.status).toBe("verified");

      // 7. Report panel shows honest verified outcome
      reportPanelManager.show();
      const html = (reportPanelManager as any).currentPanel?.webview.html;
      expect(html).toContain("badge-verified");
      expect(html).toContain("Verified — original finding resolved");
      expect(html).toContain("Repair edit verified against post-edit source.");
    });

    it("executes complete repair loop for provider alternative: DETECT -> PROPOSE -> APPLY -> RE-ANALYZE -> VERIFY", async () => {
      // 1. Initial Analysis
      const initialOutcome = await coordinator.runWorkspaceScan();
      expect(initialOutcome.status).toBe("success");
      const finding = initialOutcome.result.findings[0];

      // 2. Retrieve provider proposal
      const proposals = fixService.getProposalsForFinding(finding.id, wsId);
      const providerProposal = proposals.find((p) => p.targetRole === "provider")!;
      expect(providerProposal).toBeDefined();
      expect(providerProposal.title).toContain("Change backend endpoint method to GET");

      // 3. User reviews and confirms provider repair
      mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

      const applyFix = registeredCommands.get("undrift.applyFix")!;
      const verificationPromise = verificationCoordinator.waitForVerification(providerProposal.id);

      // Execute repair
      await applyFix(providerProposal.id);

      // 4. Verify server source changed from app.post to app.get
      const updatedServerText = documentStore.get(serverUri)!;
      expect(updatedServerText).toContain('app.get("/api/users"');
      expect(updatedServerText).not.toContain('app.post("/api/users"');

      // 5. Post-edit analysis confirms resolution
      const verifiedRecord = await verificationPromise;
      expect(verifiedRecord.status).toBe("verified");
      expect(verifiedRecord.verifiedGeneration).toBeGreaterThan(providerProposal.generation!);

      // 6. Report panel reflects verified status
      reportPanelManager.show();
      const html = (reportPanelManager as any).currentPanel?.webview.html;
      expect(html).toContain("badge-verified");
      expect(html).toContain("Verified — original finding resolved");
    });
  });

  // ==========================================================================
  // Section B: Negative and Race Cases
  // ==========================================================================

  describe("Section B: Negative and Race Cases", () => {
    it("aborts safely when developer rejects or cancels proposal confirmation", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      // User cancels dialog
      mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce(undefined);

      const applyFix = registeredCommands.get("undrift.applyFix")!;
      await applyFix(proposal.id);

      // Source is unmodified
      expect(documentStore.get(clientUri)).toBe(initialClientSource);
      // No verification was initiated
      expect(verificationCoordinator.getRecord(proposal.id)).toBeUndefined();
      expect(verificationCoordinator.getPendingCount()).toBe(0);
    });

    it("rejects application when proposal is stale due to pre-apply file changes", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      // Modify client file externally before developer clicks apply
      documentStore.set(clientUri, initialClientSource + "// user modification\n");

      mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

      const applyFix = registeredCommands.get("undrift.applyFix")!;
      await applyFix(proposal.id);

      // Warning shown to developer
      expect(mockVsCodeModule.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("Document content has changed since fix was proposed")
      );
      // No edit was applied
      expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
      // No verification pending
      expect(verificationCoordinator.getPendingCount()).toBe(0);
    });

    it("handles applyEdit returning false without false verified status", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");
      // VS Code rejects edit
      mockVsCodeModule.workspace.applyEdit.mockResolvedValueOnce(false);

      const applyFix = registeredCommands.get("undrift.applyFix")!;
      await applyFix(proposal.id);

      expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("VS Code could not apply the repair edit")
      );
      expect(verificationCoordinator.getRecord(proposal.id)).toBeUndefined();
      expect(verificationCoordinator.getPendingCount()).toBe(0);
    });

    it("marks proposal as still_active when fresh analysis confirms drift persists", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      const session = verificationCoordinator.beginVerification(proposal, finding);

      // Trigger analysis outcome that still contains the finding
      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: wsId,
        generation: 2,
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 2,
          generatedAt: 2000,
          findings: [finding], // Finding still active!
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: true,
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("still_active");
      expect(record.explanation).toContain("Re-analysis confirmed contract drift remains active");

      // Report panel reflects still_active
      reportPanelManager.show();
      const html = (reportPanelManager as any).currentPanel?.webview.html;
      expect(html).toContain("badge-active");
      expect(html).toContain("Applied — finding still active");
    });

    it("marks proposal as unresolved when post-edit analysis is incomplete", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      verificationCoordinator.beginVerification(proposal, finding);

      // Incomplete outcome
      verificationCoordinator.handleAnalysisCompleted({
        status: "incomplete",
        workspaceId: wsId,
        generation: 2,
        result: {
          status: "success",
          completeness: "partial",
          generation: 2,
          generatedAt: 2000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: [{ code: "WARN_INCOMPLETE", message: "Incomplete", affectsCompleteness: true }]
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: false, // Incomplete coverage!
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("unresolved");
      expect(record.explanation).toContain("Analysis coverage was incomplete");

      // Report reflects unresolved
      reportPanelManager.show();
      const html = (reportPanelManager as any).currentPanel?.webview.html;
      expect(html).toContain("badge-unresolved");
      expect(html).toContain("Applied — resolution could not be verified");
    });

    it("marks proposal as unresolved when post-edit analysis fails or is cancelled", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      // Failed outcome
      verificationCoordinator.beginVerification(proposal, finding);
      verificationCoordinator.handleAnalysisCompleted({
        status: "failed",
        workspaceId: wsId,
        generation: 2,
        errorMessage: "Analysis worker crashed"
      });

      let record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("unresolved");
      expect(record.explanation).toContain("Analysis worker crashed");

      // Cancelled outcome
      verificationCoordinator.beginVerification(proposal, finding);
      verificationCoordinator.handleAnalysisCompleted({
        status: "cancelled",
        workspaceId: wsId,
        generation: 3
      });

      record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("unresolved");
      expect(record.explanation).toContain("cancelled");
    });

    it("ignores outcomes from earlier or same generation to prevent pre-edit false verification", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      // Proposal generation is 1
      verificationCoordinator.beginVerification(proposal, finding);

      // Outcome from generation 1 arrives (pre-edit scan)
      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: wsId,
        generation: 1, // Same as proposal generation!
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 1,
          generatedAt: 1000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: true,
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      // Still pending because outcome generation <= proposal generation
      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("applied");
      expect(verificationCoordinator.getPendingCount()).toBe(1);
    });

    it("maintains cross-workspace isolation so scans from other workspaces are ignored", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      verificationCoordinator.beginVerification(proposal, finding);

      // Outcome for a different workspace
      const otherWs: WorkspaceId = "file:///workspace/other-project" as WorkspaceId;
      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: otherWs,
        generation: 5,
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 5,
          generatedAt: 5000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: otherWs,
          coverageSufficient: true,
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      // Still pending for wsId
      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("applied");
      expect(verificationCoordinator.getPendingCount()).toBe(1);
    });

    it("marks proposal unresolved if file changes again between edit and verification scan", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      // Expected hash is computed for post-edit text
      const expectedPostEditHash = "hash-expected-123";
      const expectedHashes = new Map<DocumentUri, string>([[clientUri, expectedPostEditHash]]);

      verificationCoordinator.beginVerification(proposal, finding, expectedHashes);

      // Coordinator accepts result, but document on disk has a different hash (user typed again)
      vi.spyOn(coordinator, "getLastAcceptedSourceDocuments").mockReturnValue(
        new Map<DocumentUri, SourceDocument>([
          [
            clientUri,
            {
              uri: clientUri,
              languageId: "typescript",
              text: "different text",
              contentHash: "hash-different-456",
              documentVersion: 2
            }
          ]
        ])
      );

      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: wsId,
        generation: 2,
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 2,
          generatedAt: 2000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: true,
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("unresolved");
      expect(record.explanation).toContain("Source document content hash changed again");
    });

    it("does not falsely claim resolution if diagnostic disappears without accepted analysis", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      verificationCoordinator.beginVerification(proposal, finding);

      // Diagnostic collection cleared externally
      const diagProvider = coordinator.getDiagnosticProvider();
      diagProvider?.dispose();

      // Verification remains applied / pending
      const record = verificationCoordinator.getRecord(proposal.id)!;
      expect(record.status).toBe("applied");
      expect(verificationCoordinator.getPendingCount()).toBe(1);
    });

    it("prevents duplicate verification completion from repeated triggers", async () => {
      const initialOutcome = await coordinator.runWorkspaceScan();
      const finding = initialOutcome.result.findings[0];
      const proposal = fixService.getProposalsForFinding(finding.id, wsId)[0];

      const session = verificationCoordinator.beginVerification(proposal, finding);

      const listenerSpy = vi.fn();
      verificationCoordinator.onVerificationCompleted(listenerSpy);

      // First outcome resolves
      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: wsId,
        generation: 2,
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 2,
          generatedAt: 2000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: true,
          eventsEmitted: [
            {
              findingId: finding.id,
              ruleId: "UND120",
              transitionKind: "resolved",
              fromState: "active",
              toState: "resolved",
              timestamp: 2000
            }
          ],
          currentSnapshot: {} as any
        }
      });

      expect(listenerSpy).toHaveBeenCalledTimes(1);
      expect(verificationCoordinator.getPendingCount()).toBe(0);

      // Second redundant outcome arrives (e.g. from rapid document event)
      verificationCoordinator.handleAnalysisCompleted({
        status: "success",
        workspaceId: wsId,
        generation: 3,
        result: {
          status: "success",
          complete: true,
          completeness: "complete",
          generation: 3,
          generatedAt: 3000,
          findings: [],
          relationships: [],
          observations: [],
          warnings: []
        },
        reconciliation: {
          workspaceId: wsId,
          coverageSufficient: true,
          eventsEmitted: [],
          currentSnapshot: {} as any
        }
      });

      // Still called only once!
      expect(listenerSpy).toHaveBeenCalledTimes(1);
    });

    it("cleans up subscriptions and pending listeners safely upon disposal", () => {
      const coord = new FixVerificationCoordinator({
        coordinator,
        fixService
      });

      const listener = vi.fn();
      const sub = coord.onVerificationCompleted(listener);

      expect(coord.getPendingCount()).toBe(0);
      sub.dispose();
      coord.dispose();

      // Double disposal is safe
      expect(() => coord.dispose()).not.toThrow();
    });
  });
});
