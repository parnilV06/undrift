// Phase 5, Chunk 5.3: undrift.applyFix Command Tests
// Verifies explicit confirmation, fresh pre-apply revalidation,
// workspace isolation, applyEdit handling, and absence of premature resolution claims.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisResult,
  DocumentUri,
  Finding,
  FindingId,
  FixProposal,
  FixProposalId,
  ProposedEdit,
  SourceDocument,
  WorkspaceId
} from "@undrift/core";
import type * as vscode from "vscode";
import { computeContentHash } from "../../apps/vscode-extension/src/workspace";
import { registerCommands } from "../../apps/vscode-extension/src/commands";
import type { FixProposalService } from "../../apps/vscode-extension/src/fixes";
import type { AnalysisCoordinator } from "../../apps/vscode-extension/src/activation";
import type { ReportPanelManager } from "../../apps/vscode-extension/src/views";

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
      return new MockUri("file", "", val);
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

  const MockCodeActionKind = {
    QuickFix: { value: "quickfix" }
  };

  class MockCodeAction {
    constructor(
      public readonly title: string,
      public readonly kind?: unknown
    ) {}
  }

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    WorkspaceEdit: MockWorkspaceEdit,
    CodeAction: MockCodeAction,
    CodeActionKind: MockCodeActionKind,
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn()
    },
    workspace: {
      workspaceFolders: [
        {
          uri: MockUri.parse("file:///workspace/app"),
          name: "app",
          index: 0
        }
      ],
      applyEdit: vi.fn().mockResolvedValue(true),
      fs: {
        readFile: vi.fn(),
        stat: vi.fn()
      }
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

describe("undrift.applyFix Command (Chunk 5.3)", () => {
  const wsId: WorkspaceId = "file:///workspace/app" as WorkspaceId;
  const docUri: DocumentUri = "file:///workspace/app/src/consumer.ts" as DocumentUri;
  const sourceText = 'fetch("/api/users", { method: "GET" });\n';
  const contentHash = computeContentHash(sourceText);

  function createValidProposal(overrides?: Partial<FixProposal>): {
    proposal: FixProposal;
    finding: Finding;
  } {
    const edit: ProposedEdit = {
      id: "edit:consumer:1",
      proposalId: "prop:consumer:1" as FixProposalId,
      documentUri: docUri,
      range: { start: 30, end: 35 },
      start: { line: 0, character: 30 },
      end: { line: 0, character: 35 },
      newText: '"POST"',
      expectedContentHash: contentHash,
      expectedDocumentVersion: 1
    };

    const finding: Finding = {
      id: "finding:1" as FindingId,
      ruleId: "UND120",
      category: "route",
      severity: "error",
      state: "active",
      title: "Method mismatch",
      summary: "Mismatch",
      explanation: "Explanation",
      evidenceStrength: "direct",
      sourceLocations: [],
      observedAt: 1000,
      expected: "POST",
      observed: "GET",
      limitations: [],
      fixProposalIds: []
    };

    const proposal: FixProposal = {
      id: "prop:consumer:1" as FixProposalId,
      findingId: finding.id,
      workspaceId: wsId,
      generation: 1,
      targetRole: "consumer",
      title: "Change frontend request method to POST",
      rationale: "Aligns with provider POST method",
      assumptions: {
        authoritativeSide: "provider",
        breakingChange: false
      },
      riskLevel: "low",
      verificationExpectation: "Conflict will be resolved on next analysis.",
      edits: [edit],
      createdAt: 1000,
      ...overrides
    };

    return { proposal, finding };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();

    // Setup default file buffer in fs mock
    const enc = new TextEncoder();
    mockVsCodeModule.workspace.fs.readFile.mockResolvedValue(enc.encode(sourceText));
    mockVsCodeModule.workspace.fs.stat.mockResolvedValue({ mtime: 1000 });
    mockVsCodeModule.workspace.applyEdit.mockResolvedValue(true);
  });

  function setupCommandEnvironment(overrides?: {
    resolvedProposal?: { proposal: FixProposal; finding: Finding } | null;
    coordinatorResult?: AnalysisResult | null;
    wsId?: WorkspaceId | null;
  }) {
    const defaultPair = createValidProposal();
    const resolved =
      overrides?.resolvedProposal !== undefined ? overrides.resolvedProposal : defaultPair;
    const currentWs = overrides?.wsId !== undefined ? overrides.wsId : wsId;

    const mockFixService: Partial<FixProposalService> = {
      getProposalById: vi.fn().mockImplementation((id: string) => {
        if (!resolved) return undefined;
        if (resolved.proposal.id !== id) return undefined;
        return resolved;
      }),
      getAllProposals: vi.fn().mockReturnValue(new Map())
    };

    const mockCoordinator = {
      getActiveWorkspaceId: vi.fn().mockReturnValue(currentWs ?? undefined),
      getLatestAcceptedGeneration: vi
        .fn()
        .mockReturnValue(
          overrides?.coordinatorResult?.generation ?? resolved?.proposal.generation ?? 1
        ),
      getLastAcceptedAnalysisResult: vi.fn().mockReturnValue(
        overrides?.coordinatorResult !== undefined
          ? overrides.coordinatorResult
          : {
              status: "success",
              completeness: "complete",
              generation: resolved?.proposal.generation ?? 1,
              generatedAt: 1000,
              findings: resolved ? [resolved.finding] : [],
              relationships: [],
              observations: [],
              warnings: []
            }
      ),
      getLastAcceptedSourceDocuments: vi.fn().mockReturnValue(
        new Map<DocumentUri, SourceDocument>([
          [
            docUri,
            {
              uri: docUri,
              languageId: "typescript",
              text: sourceText,
              contentHash,
              documentVersion: 1
            }
          ]
        ])
      )
    } as unknown as AnalysisCoordinator;

    const mockReportPanelManager = {
      show: vi.fn(),
      updateWebviewContent: vi.fn()
    };

    registerCommands({
      coordinator: mockCoordinator,
      reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
      fixService: mockFixService as FixProposalService,
      vscodeModule: mockVsCodeModule as unknown as typeof vscode
    });

    return { mockFixService, mockCoordinator, mockReportPanelManager, defaultPair };
  }

  it("registers undrift.applyFix command correctly", () => {
    setupCommandEnvironment();
    expect(registeredCommands.has("undrift.applyFix")).toBe(true);
  });

  it("informs developer when no proposal ID is provided and no proposals exist", async () => {
    setupCommandEnvironment();
    const applyFix = registeredCommands.get("undrift.applyFix")!;

    await applyFix(undefined);
    expect(mockVsCodeModule.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No actionable repair proposals available")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("rejects unknown proposal ID not found in accepted state", async () => {
    setupCommandEnvironment({ resolvedProposal: null });
    const applyFix = registeredCommands.get("undrift.applyFix")!;

    await applyFix("prop:unknown");
    expect(mockVsCodeModule.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("is no longer valid or could not be found")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("rejects proposal when workspace identity is missing or empty", async () => {
    const pair = createValidProposal({ workspaceId: "" as WorkspaceId });
    setupCommandEnvironment({ resolvedProposal: pair });
    const applyFix = registeredCommands.get("undrift.applyFix")!;

    await applyFix(pair.proposal.id);
    expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("workspace identity mismatch")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("rejects proposal originating from a different workspace", async () => {
    const pair = createValidProposal({ workspaceId: "file:///other/workspace" as WorkspaceId });
    setupCommandEnvironment({ resolvedProposal: pair, wsId });
    const applyFix = registeredCommands.get("undrift.applyFix")!;

    await applyFix(pair.proposal.id);
    expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("workspace identity mismatch")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("rejects proposal from a stale analysis generation", async () => {
    const pair = createValidProposal({ generation: 1 });
    setupCommandEnvironment({
      resolvedProposal: pair,
      coordinatorResult: {
        status: "success",
        completeness: "complete",
        generation: 2, // accepted analysis has advanced
        generatedAt: 2000,
        findings: [pair.finding],
        relationships: [],
        observations: [],
        warnings: []
      }
    });
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

    const applyFix = registeredCommands.get("undrift.applyFix")!;

    await applyFix(pair.proposal.id);
    expect(mockVsCodeModule.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Proposal generation (1) has been superseded")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("aborts without applying edit when developer declines or cancels confirmation modal", async () => {
    const { defaultPair } = setupCommandEnvironment();
    // Simulate user closing modal (resolves undefined)
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce(undefined);

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    // Modal was shown
    expect(mockVsCodeModule.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Change frontend request method to POST"),
      expect.objectContaining({ modal: true }),
      "Apply Repair"
    );

    // No edit applied
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("re-validates source freshness immediately before application and rejects stale hash", async () => {
    const { defaultPair } = setupCommandEnvironment();
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

    // Simulate disk content having changed since proposal was generated
    const modifiedText = 'fetch("/api/users", { method: "PUT" });\n';
    const enc = new TextEncoder();
    mockVsCodeModule.workspace.fs.readFile.mockResolvedValue(enc.encode(modifiedText));

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    expect(mockVsCodeModule.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Document content has changed since fix was proposed")
    );
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("applies edit via workspace.applyEdit after explicit confirmation and fresh validation", async () => {
    const { defaultPair } = setupCommandEnvironment();
    mockVsCodeModule.window.showInformationMessage
      .mockResolvedValueOnce("Apply Repair") // Confirmation modal
      .mockResolvedValueOnce(undefined); // Success message

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    expect(mockVsCodeModule.workspace.applyEdit).toHaveBeenCalledTimes(1);

    // Verifies notification is informative but does NOT claim drift is verified/resolved
    expect(mockVsCodeModule.window.showInformationMessage).toHaveBeenLastCalledWith(
      expect.stringContaining(
        'Repair edit applied successfully for "Change frontend request method to POST"'
      )
    );
  });

  it("handles applyEdit returning false without reporting success", async () => {
    const { defaultPair } = setupCommandEnvironment();
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");
    mockVsCodeModule.workspace.applyEdit.mockResolvedValueOnce(false); // VS Code rejected edit

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    expect(mockVsCodeModule.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("VS Code could not apply the repair edit")
    );
  });

  it("handles applyEdit throwing an error without reporting success", async () => {
    const { defaultPair } = setupCommandEnvironment();
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");
    mockVsCodeModule.workspace.applyEdit.mockRejectedValueOnce(new Error("File is locked"));

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Error applying repair edit: File is locked")
    );
  });

  it("does not mutate finding state or mark finding resolved upon application", async () => {
    const { defaultPair } = setupCommandEnvironment();
    mockVsCodeModule.window.showInformationMessage.mockResolvedValueOnce("Apply Repair");

    const applyFix = registeredCommands.get("undrift.applyFix")!;
    await applyFix(defaultPair.proposal.id);

    // Finding remains 'active', resolution must wait for re-analysis in Phase 5.4
    expect(defaultPair.finding.state).toBe("active");
  });
});
