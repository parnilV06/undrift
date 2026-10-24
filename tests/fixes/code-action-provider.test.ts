// Phase 5, Chunk 5.3: VS Code Code Action Provider Tests
// Verifies review action generation, consumer/provider distinction,
// diagnostics association, and strict review-only flow without edit application.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticFindingSource } from "../../apps/vscode-extension/src/diagnostics";
import type { FixProposal, FixProposalId, FindingId, WorkspaceId } from "@undrift/core";
import { DriftCodeActionProvider } from "../../apps/vscode-extension/src/fixes/code-action-provider";
import type { FixProposalService } from "../../apps/vscode-extension/src/fixes/fix-service";

const { MockCodeAction, MockCodeActionKind, MockRange, MockPosition, MockUri, mockVsCodeModule } =
  vi.hoisted(() => {
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

      toString(): string {
        return `${this.scheme}://${this.authority}${this.path}`;
      }
    }

    const MockCodeActionKind = {
      QuickFix: { value: "quickfix" }
    };

    class MockCodeAction {
      public command?: { command: string; title: string; arguments?: unknown[] };
      public diagnostics?: unknown[];
      public isPreferred?: boolean;

      constructor(
        public readonly title: string,
        public readonly kind?: unknown
      ) {}
    }

    const mockVsCodeModule = {
      Position: MockPosition,
      Range: MockRange,
      Uri: MockUri,
      CodeAction: MockCodeAction,
      CodeActionKind: MockCodeActionKind
    };

    return {
      MockPosition,
      MockRange,
      MockUri,
      MockCodeAction,
      MockCodeActionKind,
      mockVsCodeModule
    };
  });

vi.mock("vscode", () => mockVsCodeModule);

describe("DriftCodeActionProvider (Chunk 5.3)", () => {
  const wsId = "file:///workspace/app" as WorkspaceId;
  const consumerUri = "file:///workspace/app/src/consumer.ts";
  const providerUri = "file:///workspace/app/src/routes.ts";

  function createSampleFinding(
    overrides?: Partial<DiagnosticFindingSource>
  ): DiagnosticFindingSource {
    return {
      id: "finding:und120:1" as FindingId,
      ruleId: "UND120",
      category: "existence",
      severity: "error",
      title: "HTTP method mismatch for /api/users",
      summary: "Consumer calls GET but provider registers POST",
      state: "detected",
      observedAt: 1000,
      sourceLocations: [
        {
          uri: consumerUri,
          start: { line: 10, character: 4 },
          end: { line: 10, character: 40 }
        },
        {
          uri: providerUri,
          start: { line: 20, character: 2 },
          end: { line: 20, character: 35 }
        }
      ],
      evidenceStrength: "exact",
      ...overrides
    };
  }

  function createSampleProposal(
    targetRole: "consumer" | "provider",
    overrides?: Partial<FixProposal>
  ): FixProposal {
    return {
      id: `prop:${targetRole}:1` as FixProposalId,
      findingId: "finding:und120:1" as FindingId,
      workspaceId: wsId,
      generation: 1,
      targetRole,
      title:
        targetRole === "consumer"
          ? "Update fetch method from GET to POST"
          : "Update Express route method from POST to GET",
      rationale:
        targetRole === "consumer"
          ? "Aligns consumer call with backend provider POST method"
          : "Aligns provider route with frontend consumer GET method",
      assumptions: {
        authoritativeSide: targetRole === "consumer" ? "provider" : "consumer",
        breakingChange: targetRole === "provider"
      },
      riskLevel: "low",
      verificationExpectation: "Method conflict UND120 will be resolved on next analysis.",
      edits: [
        {
          id: `edit:${targetRole}:1`,
          proposalId: `prop:${targetRole}:1` as FixProposalId,
          targetUri: targetRole === "consumer" ? consumerUri : providerUri,
          span: {
            uri: targetRole === "consumer" ? consumerUri : providerUri,
            start: { line: 10, character: 35 },
            end: { line: 10, character: 40 }
          },
          currentText: targetRole === "consumer" ? "'GET'" : "post",
          replacementText: targetRole === "consumer" ? "'POST'" : "get",
          expectedContentHash: "hash-1",
          expectedDocumentVersion: 1
        }
      ],
      createdAt: 1000,
      ...overrides
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers distinct, clearly labelled QuickFix review actions for consumer and provider alternatives", () => {
    const finding = createSampleFinding();
    const consumerProposal = createSampleProposal("consumer");
    const providerProposal = createSampleProposal("provider");

    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([
        { proposal: consumerProposal, finding },
        { proposal: providerProposal, finding }
      ])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);

    const mockDoc = {
      uri: MockUri.parse(consumerUri)
    } as unknown as import("vscode").TextDocument;

    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;

    const mockContext = {
      diagnostics: [
        {
          source: "UNDRIFT",
          code: "UND120",
          range: mockRange
        }
      ]
    } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(2);

    const consumerAction = actions.find((a) => a.title.includes("consumer-side"));
    const providerAction = actions.find((a) => a.title.includes("provider-side"));

    expect(consumerAction).toBeDefined();
    expect(consumerAction?.title).toBe("UNDRIFT: Review consumer-side method repair");
    expect(consumerAction?.command).toEqual({
      command: "undrift.showReport",
      title: "Review Repair Proposal",
      arguments: ["finding:und120:1", "prop:consumer:1"]
    });
    expect(consumerAction?.isPreferred).toBe(false);

    expect(providerAction).toBeDefined();
    expect(providerAction?.title).toBe("UNDRIFT: Review provider-side method repair");
    expect(providerAction?.command).toEqual({
      command: "undrift.showReport",
      title: "Review Repair Proposal",
      arguments: ["finding:und120:1", "prop:provider:1"]
    });
  });

  it("never directly applies edits from code action selection", () => {
    const finding = createSampleFinding();
    const proposal = createSampleProposal("consumer");

    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([{ proposal, finding }])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);
    const mockDoc = { uri: MockUri.parse(consumerUri) } as unknown as import("vscode").TextDocument;
    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;
    const mockContext = { diagnostics: [] } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(1);
    // CodeAction must NOT have an edit property (which would apply edits automatically)
    expect((actions[0] as unknown as { edit?: unknown }).edit).toBeUndefined();
    // It must only route to report review flow
    expect(actions[0].command?.command).toBe("undrift.showReport");
  });

  it("offers no actions for findings with unsupported rules", () => {
    const unsupportedFinding = createSampleFinding({ ruleId: "UND100" as unknown as "UND120" });
    const proposal = createSampleProposal("consumer");

    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([{ proposal, finding: unsupportedFinding }])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);
    const mockDoc = { uri: MockUri.parse(consumerUri) } as unknown as import("vscode").TextDocument;
    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;
    const mockContext = { diagnostics: [] } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(0);
  });

  it("offers no actions when fixService returns no matching proposals", () => {
    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);
    const mockDoc = { uri: MockUri.parse(consumerUri) } as unknown as import("vscode").TextDocument;
    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;
    const mockContext = { diagnostics: [] } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(0);
  });

  it("deduplicates actions for the same proposal id", () => {
    const finding = createSampleFinding();
    const proposal = createSampleProposal("consumer");

    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([
        { proposal, finding },
        { proposal, finding } // duplicated
      ])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);
    const mockDoc = { uri: MockUri.parse(consumerUri) } as unknown as import("vscode").TextDocument;
    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;
    const mockContext = { diagnostics: [] } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(1);
  });

  it("associates actions with context diagnostics matching the finding rule", () => {
    const finding = createSampleFinding();
    const proposal = createSampleProposal("consumer");

    const mockFixService: Partial<FixProposalService> = {
      getProposalsForDocument: vi.fn().mockReturnValue([{ proposal, finding }])
    };

    const provider = new DriftCodeActionProvider(mockFixService as FixProposalService);
    const mockDoc = { uri: MockUri.parse(consumerUri) } as unknown as import("vscode").TextDocument;
    const mockRange = new MockRange(
      new MockPosition(10, 0),
      new MockPosition(10, 50)
    ) as unknown as import("vscode").Range;

    const undriftDiag = {
      source: "UNDRIFT",
      code: "UND120",
      range: mockRange
    };
    const otherDiag = {
      source: "eslint",
      code: "no-unused-vars",
      range: mockRange
    };

    const mockContext = {
      diagnostics: [undriftDiag, otherDiag]
    } as unknown as import("vscode").CodeActionContext;

    const actions = provider.provideCodeActions(mockDoc, mockRange, mockContext);

    expect(actions).toHaveLength(1);
    expect(actions[0].diagnostics).toEqual([undriftDiag]);
  });
});
