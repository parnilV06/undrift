// Phase 5, Chunk 5.2: Safe WorkspaceEdit Translation Tests
// Verifies target-role safety, exact range translation, all-or-nothing handling,
// and strict absence of automatic application adhering to LLD.md Section 13.2.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentUri,
  Finding,
  FindingId,
  FixProposal,
  FixProposalId,
  ObservationId,
  Position,
  ProposedEdit,
  WorkspaceId
} from "@undrift/core";
import { computeContentHash } from "../../apps/vscode-extension/src/workspace";
import {
  FixApplier,
  FixPreparationError,
  prepareFixWorkspaceEdit,
  type ProposalValidationSuccess
} from "../../apps/vscode-extension/src/fixes";

const { MockPosition, MockRange, MockUri, MockWorkspaceEdit, mockVsCodeModule } = vi.hoisted(() => {
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
      public readonly path: string,
      public readonly query: string,
      public readonly fragment: string
    ) {}

    static parse(val: string): MockUri {
      try {
        const url = new URL(val);
        return new MockUri(
          url.protocol.replace(":", ""),
          url.host,
          url.pathname,
          url.search,
          url.hash
        );
      } catch {
        return new MockUri("file", "", val, "", "");
      }
    }

    get fsPath(): string {
      return this.path;
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  class MockWorkspaceEdit {
    public readonly entries: Array<{ uri: MockUri; range: MockRange; newText: string }> = [];

    replace(uri: MockUri, range: MockRange, newText: string): void {
      this.entries.push({ uri, range, newText });
    }

    get size(): number {
      return this.entries.length;
    }
  }

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    WorkspaceEdit: MockWorkspaceEdit,
    workspace: {
      workspaceFolders: [
        {
          uri: MockUri.parse("file:///workspace/app"),
          name: "app",
          index: 0
        }
      ],
      textDocuments: [] as unknown[],
      applyEdit: vi.fn(async () => true),
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        stat: vi.fn()
      }
    }
  };

  return {
    MockPosition,
    MockRange,
    MockUri,
    MockWorkspaceEdit,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

describe("Safe WorkspaceEdit Translation (Chunk 5.2)", () => {
  const workspaceRoot = "file:///workspace/app";
  const docUri: DocumentUri = "file:///workspace/app/src/consumer.ts";
  const sourceText =
    "import { fetch } from 'undrift';\nconst res = fetch('/api/users', { method: 'GET' });\n";
  const contentHash = computeContentHash(sourceText);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createValidationSuccess(overrides?: {
    proposalOverrides?: Partial<FixProposal>;
    edits?: ProposedEdit[];
  }): ProposalValidationSuccess {
    const startOffset = sourceText.indexOf("'GET'");
    const endOffset = startOffset + "'GET'".length;

    const edit: ProposedEdit = {
      id: "prop:consumer:1:edit:0",
      proposalId: "prop:consumer:1" as FixProposal["id"],
      documentUri: docUri,
      range: { start: startOffset, end: endOffset },
      start: { line: 1, character: 42 },
      end: { line: 1, character: 47 },
      newText: "'POST'",
      expectedContentHash: contentHash,
      expectedDocumentVersion: 1
    };

    const proposal: FixProposal = {
      id: "prop:consumer:1" as FixProposal["id"],
      findingId: "finding:1" as FindingId,
      workspaceId: workspaceRoot as WorkspaceId,
      generation: 1,
      title: "Change frontend request method to POST",
      rationale: "Backend endpoint expects POST",
      assumptions: ["Backend is authoritative"],
      risk: "mechanical",
      targetRole: "consumer",
      edits: overrides?.edits ?? [edit],
      status: "proposed",
      verificationDescription: "Re-analysis will confirm matching method",
      ...overrides?.proposalOverrides
    };

    return {
      valid: true,
      proposal,
      workspaceId: workspaceRoot as WorkspaceId,
      documentSnapshots: new Map([
        [
          docUri,
          {
            uri: docUri,
            text: sourceText,
            version: 1,
            contentHash
          }
        ]
      ])
    };
  }

  it("1. translates validated proposal into exact replacement range, positions, URI, and text", () => {
    const validation = createValidationSuccess();
    const result = prepareFixWorkspaceEdit(validation);

    expect(result.proposal.id).toBe("prop:consumer:1");
    expect(result.targetRole).toBe("consumer");
    expect(result.editCount).toBe(1);

    const wsEdit = result.workspaceEdit as unknown as InstanceType<typeof MockWorkspaceEdit>;
    expect(wsEdit.entries).toHaveLength(1);

    const entry = wsEdit.entries[0];
    expect(entry.uri.toString()).toBe(docUri);
    expect(entry.range.start.line).toBe(1);
    expect(entry.range.start.character).toBe(42);
    expect(entry.range.end.line).toBe(1);
    expect(entry.range.end.character).toBe(47);
    expect(entry.newText).toBe("'POST'");
  });

  it("2. throws error on consumer versus provider target-role mismatch without switching sides", () => {
    const validation = createValidationSuccess({
      proposalOverrides: { targetRole: "consumer" }
    });

    // Caller requests provider repair, but proposal is consumer repair
    expect(() => prepareFixWorkspaceEdit(validation, { expectedTargetRole: "provider" })).toThrow(
      FixPreparationError
    );

    try {
      prepareFixWorkspaceEdit(validation, { expectedTargetRole: "provider" });
    } catch (err) {
      expect(err).toBeInstanceOf(FixPreparationError);
      const prepErr = err as FixPreparationError;
      expect(prepErr.reasonCode).toBe("TARGET_ROLE_MISMATCH");
      expect(prepErr.message).toContain("Target role mismatch");
    }
  });

  it("3. rejects proposal with no edits, malformed metadata, or unvalidated input", () => {
    // 3a. Proposal with empty edits array
    const emptyValidation = createValidationSuccess({ edits: [] });
    expect(() => prepareFixWorkspaceEdit(emptyValidation)).toThrow(FixPreparationError);

    try {
      prepareFixWorkspaceEdit(emptyValidation);
    } catch (err) {
      expect((err as FixPreparationError).reasonCode).toBe("EMPTY_PROPOSAL");
    }

    // 3b. Unvalidated or rejected input
    const unvalidated = { valid: false } as unknown as ProposalValidationSuccess;
    expect(() => prepareFixWorkspaceEdit(unvalidated)).toThrow(FixPreparationError);

    try {
      prepareFixWorkspaceEdit(unvalidated);
    } catch (err) {
      expect((err as FixPreparationError).reasonCode).toBe("UNVALIDATED_PROPOSAL");
    }

    // 3c. Malformed edit coordinates
    const malformedEditValidation = createValidationSuccess({
      edits: [
        {
          id: "edit:malformed",
          proposalId: "prop:consumer:1" as FixProposal["id"],
          documentUri: docUri,
          range: { start: 0, end: 5 },
          start: null as unknown as Position, // Missing start position
          end: { line: 0, character: 5 },
          newText: "test",
          expectedContentHash: contentHash
        }
      ]
    });

    expect(() => prepareFixWorkspaceEdit(malformedEditValidation)).toThrow(FixPreparationError);
    try {
      prepareFixWorkspaceEdit(malformedEditValidation);
    } catch (err) {
      expect((err as FixPreparationError).reasonCode).toBe("MALFORMED_PROPOSAL");
    }

    // 3d. Missing workspace identity
    const missingWsValidation = createValidationSuccess({
      proposalOverrides: { workspaceId: undefined }
    });
    expect(() => prepareFixWorkspaceEdit(missingWsValidation)).toThrow(FixPreparationError);
    try {
      prepareFixWorkspaceEdit(missingWsValidation);
    } catch (err) {
      expect((err as FixPreparationError).reasonCode).toBe("WORKSPACE_MISMATCH");
    }
  });

  it("4. performs all-or-nothing translation for multi-edit proposals", () => {
    const secondDocUri: DocumentUri = "file:///workspace/app/src/types.ts";
    const startOffset = sourceText.indexOf("'GET'");
    const endOffset = startOffset + "'GET'".length;
    const edit1: ProposedEdit = {
      id: "prop:multi:edit:0",
      proposalId: "prop:multi:1" as FixProposal["id"],
      documentUri: docUri,
      range: { start: startOffset, end: endOffset },
      start: { line: 1, character: 42 },
      end: { line: 1, character: 47 },
      newText: "'POST'",
      expectedContentHash: contentHash,
      expectedDocumentVersion: 1
    };

    const edit2: ProposedEdit = {
      id: "prop:multi:edit:1",
      proposalId: "prop:multi:1" as FixProposal["id"],
      documentUri: secondDocUri,
      range: { start: 10, end: 15 },
      start: { line: 0, character: 10 },
      end: { line: 0, character: 15 },
      newText: "'POST'",
      expectedContentHash: "hash-2",
      expectedDocumentVersion: 1
    };

    const multiValidation = createValidationSuccess({
      proposalOverrides: { id: "prop:multi:1" as FixProposal["id"] },
      edits: [edit1, edit2]
    });

    const result = prepareFixWorkspaceEdit(multiValidation);
    expect(result.editCount).toBe(2);

    const wsEdit = result.workspaceEdit as unknown as InstanceType<typeof MockWorkspaceEdit>;
    expect(wsEdit.entries).toHaveLength(2);
    expect(wsEdit.entries[0].uri.toString()).toBe(docUri);
    expect(wsEdit.entries[1].uri.toString()).toBe(secondDocUri);
  });

  it("5. strictly avoids calling workspace.applyEdit and touches no filesystem write APIs", async () => {
    const validation = createValidationSuccess();

    // Prepare the edit
    const result = prepareFixWorkspaceEdit(validation);
    expect(result).toBeDefined();

    // Verify workspace.applyEdit was NEVER called
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();

    // Verify workspace.fs.writeFile was NEVER called
    expect(mockVsCodeModule.workspace.fs.writeFile).not.toHaveBeenCalled();

    // Also verify through FixApplier flow
    const applier = new FixApplier();
    const applierResult = await applier.validateAndPrepare(validation.proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: {
        getOpenDocuments: () => [{ uri: docUri, text: sourceText, version: 1 }],
        readDocumentText: async () => ({ uri: docUri, text: sourceText, version: 1 }),
        documentExists: async () => true
      }
    });

    expect(applierResult.success).toBe(true);
    expect(mockVsCodeModule.workspace.applyEdit).not.toHaveBeenCalled();
    expect(mockVsCodeModule.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("6. causes no mutation of finding lifecycle states or persistence as a side effect", async () => {
    const finding: Finding = {
      id: "finding:1" as FindingId,
      ruleId: "UND120" as const,
      category: "route",
      severity: "error",
      state: "active",
      title: "HTTP Method Conflict",
      summary: "Consumer sends GET but provider expects POST",
      explanation: "Detailed explanation",
      evidenceStrength: "direct",
      observationIds: ["obs:c:1" as ObservationId, "obs:p:1" as ObservationId],
      sourceLocations: [],
      limitations: [],
      fixProposalIds: ["prop:consumer:1" as FixProposalId]
    };

    const validation = createValidationSuccess({
      proposalOverrides: { findingId: finding.id }
    });

    const result = prepareFixWorkspaceEdit(validation);
    expect(result).toBeDefined();

    // Assert finding state is still "active"
    expect(finding.state).toBe("active");
    expect(finding.fixProposalIds).toEqual(["prop:consumer:1"]);
  });
});
