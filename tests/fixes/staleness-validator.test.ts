// Phase 5, Chunk 5.2: Fix Staleness Validator Tests
// Verifies workspace containment, content hash, document version, generation,
// and exact range validation adhering strictly to LLD.md Section 13.2.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentUri, FindingId, FixProposal, ProposedEdit, WorkspaceId } from "@undrift/core";
import { computeContentHash } from "../../apps/vscode-extension/src/workspace";
import {
  FixStalenessValidator,
  isUriContainedInRoot,
  isUriInWorkspaceFolders,
  validateFixProposal,
  type DocumentBufferSnapshot,
  type GenerationAccessor
} from "../../apps/vscode-extension/src/fixes";

const { MockPosition, MockRange, MockUri, mockVsCodeModule } = vi.hoisted(() => {
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

    static file(fsPath: string): MockUri {
      const normalized = fsPath.replace(/\\/g, "/");
      const pathPart = normalized.startsWith("/") ? normalized : "/" + normalized;
      return new MockUri("file", "", pathPart, "", "");
    }

    get fsPath(): string {
      return this.path;
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    workspace: {
      workspaceFolders: [
        {
          uri: MockUri.parse("file:///workspace/app"),
          name: "app",
          index: 0
        }
      ],
      textDocuments: [] as unknown[],
      fs: {
        readFile: vi.fn(),
        stat: vi.fn()
      }
    }
  };

  return {
    MockPosition,
    MockRange,
    MockUri,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

describe("FixStalenessValidator (Chunk 5.2)", () => {
  const workspaceRoot = "file:///workspace/app";
  const docUri: DocumentUri = "file:///workspace/app/src/consumer.ts";
  const baseSourceText =
    "import { fetch } from 'undrift';\nconst res = fetch('/api/users', { method: 'GET' });\n";

  function createValidProposal(overrides?: {
    proposalOverrides?: Partial<FixProposal>;
    editOverrides?: Partial<ProposedEdit>;
    sourceText?: string;
  }): { proposal: FixProposal; sourceText: string } {
    const text = overrides?.sourceText ?? baseSourceText;
    const hash = computeContentHash(text);

    // In baseSourceText: "method: 'GET'"
    // 'GET' starts at offset 74, ends at 79
    // Line 1, char 42 to line 1, char 47
    const startOffset = text.indexOf("'GET'");
    const endOffset = startOffset + "'GET'".length;

    const edit: ProposedEdit = {
      id: "prop:consumer:1:edit:0",
      proposalId: "prop:consumer:1" as FixProposal["id"],
      documentUri: docUri,
      range: { start: startOffset, end: endOffset },
      start: { line: 1, character: 42 },
      end: { line: 1, character: 47 },
      newText: "'POST'",
      expectedContentHash: hash,
      expectedDocumentVersion: 1,
      ...overrides?.editOverrides
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
      edits: [edit],
      status: "proposed",
      verificationDescription: "Re-analysis will confirm matching method",
      ...overrides?.proposalOverrides
    };

    return { proposal, sourceText: text };
  }

  function createMockAccessor(documents: Record<string, { text: string; version?: number }>) {
    return {
      getOpenDocuments: () =>
        Object.entries(documents).map(([uri, doc]) => ({
          uri,
          text: doc.text,
          version: doc.version
        })),
      readDocumentText: async (uri: DocumentUri) => {
        const found = documents[uri];
        return found ? { uri, text: found.text, version: found.version } : undefined;
      },
      documentExists: async (uri: DocumentUri) => uri in documents
    };
  }

  it("1. validates a proposal with matching workspace, accepted generation, content hash, document version, and ranges", async () => {
    const { proposal, sourceText } = createValidProposal();
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    const coordinator: GenerationAccessor = {
      getLatestAcceptedGeneration: (wsId) => (wsId === workspaceRoot ? 1 : undefined)
    };

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor,
      coordinator
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.proposal.id).toBe(proposal.id);
      expect(result.documentSnapshots.has(docUri)).toBe(true);
      expect(result.documentSnapshots.get(docUri)?.contentHash).toBe(
        proposal.edits[0].expectedContentHash
      );
    }
  });

  it("2. rejects when content has changed after proposal generation", async () => {
    const { proposal } = createValidProposal();
    const modifiedText = baseSourceText.replace("'GET'", "'PUT'");
    const accessor = createMockAccessor({
      [docUri]: { text: modifiedText, version: 2 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("CONTENT_HASH_MISMATCH");
      expect(result.message).toContain("Document content has changed");
      expect(result.details?.actual).toBe(computeContentHash(modifiedText));
    }
  });

  it("3. rejects when document version changed even when other metadata is valid", async () => {
    const { proposal, sourceText } = createValidProposal();
    // Same text, but editor revision incremented to 5
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 5 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("DOCUMENT_VERSION_MISMATCH");
      expect(result.message).toContain("Document revision changed");
      expect(result.details?.expected).toBe(1);
      expect(result.details?.actual).toBe(5);
    }
  });

  it("4a. accepts proposal with missing expected version when content hash matches", async () => {
    const { proposal, sourceText } = createValidProposal({
      editOverrides: { expectedDocumentVersion: undefined }
    });
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 10 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(true);
  });

  it("4b. rejects proposal with missing expected hash", async () => {
    const { proposal, sourceText } = createValidProposal({
      editOverrides: { expectedContentHash: "" }
    });
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("MISSING_EXPECTED_HASH");
      expect(result.message).toContain("missing required expected content hash");
    }
  });

  it("5. rejects when document is missing or source URI is invalid", async () => {
    const { proposal } = createValidProposal();
    // Accessor has no documents (file not found)
    const accessor = createMockAccessor({});

    const resultMissing = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(resultMissing.valid).toBe(false);
    if (!resultMissing.valid) {
      expect(resultMissing.reasonCode).toBe("DOCUMENT_NOT_FOUND");
    }

    // Invalid URI scheme
    const { proposal: proposalInvalidUri, sourceText } = createValidProposal({
      editOverrides: { documentUri: "http://malicious.com/exploit.ts" }
    });
    const accessor2 = createMockAccessor({
      "http://malicious.com/exploit.ts": { text: sourceText, version: 1 }
    });

    const resultInvalidScheme = await validateFixProposal(proposalInvalidUri, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor2
    });

    expect(resultInvalidScheme.valid).toBe(false);
    if (!resultInvalidScheme.valid) {
      expect(resultInvalidScheme.reasonCode).toBe("UNSUPPORTED_DOCUMENT_URI");
    }
  });

  it("6. rejects URI outside intended workspace, including misleading textual prefix", async () => {
    // Sibling directory sharing the exact prefix "file:///workspace/app"
    const outsideUri: DocumentUri = "file:///workspace/app-other/src/consumer.ts";
    const { proposal, sourceText } = createValidProposal({
      editOverrides: { documentUri: outsideUri }
    });

    const accessor = createMockAccessor({
      [outsideUri]: { text: sourceText, version: 1 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: ["file:///workspace/app"],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("WORKSPACE_MISMATCH");
      expect(result.message).toContain("outside the intended workspace roots");
    }

    // Also test isUriContainedInRoot directly
    expect(
      isUriContainedInRoot("file:///workspace/app-other/file.ts", "file:///workspace/app")
    ).toBe(false);
    expect(
      isUriContainedInRoot("file:///workspace/app/../app-other/file.ts", "file:///workspace/app")
    ).toBe(false);
    expect(isUriContainedInRoot("file:///workspace/app/src/file.ts", "file:///workspace/app")).toBe(
      true
    );
  });

  it("7. rejects proposal when workspace identity mismatches target workspace", async () => {
    const { proposal, sourceText } = createValidProposal({
      proposalOverrides: { workspaceId: "ws:workspace-alpha" as WorkspaceId }
    });
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      targetWorkspaceId: "ws:workspace-beta" as WorkspaceId,
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("WORKSPACE_MISMATCH");
      expect(result.message).toContain("does not match target workspace");
    }
  });

  it("8. rejects proposal generation superseded by newer accepted analysis in same workspace", async () => {
    const { proposal, sourceText } = createValidProposal({
      proposalOverrides: { generation: 2 }
    });
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    const coordinator: GenerationAccessor = {
      // Coordinator is at accepted generation 3 (newer than proposal generation 2)
      getLatestAcceptedGeneration: (wsId) => (wsId === workspaceRoot ? 3 : undefined)
    };

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor,
      coordinator
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("GENERATION_SUPERSEDED");
      expect(result.message).toContain("superseded by accepted generation (3)");
    }
  });

  it("9. newer analysis in a different workspace does not invalidate target workspace proposal", async () => {
    const { proposal, sourceText } = createValidProposal({
      proposalOverrides: {
        workspaceId: "ws:workspace-a" as WorkspaceId,
        generation: 2
      }
    });
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    const coordinator: GenerationAccessor = {
      getLatestAcceptedGeneration: (wsId) => {
        if (wsId === "ws:workspace-a") return 2; // Matches proposal in workspace A
        if (wsId === "ws:workspace-b") return 10; // Much higher in unrelated workspace B
        return undefined;
      }
    };

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      targetWorkspaceId: "ws:workspace-a" as WorkspaceId,
      documentAccessor: accessor,
      coordinator
    });

    expect(result.valid).toBe(true);
  });

  it("10. rejects negative, reversed, out-of-bounds, and position/offset-inconsistent ranges", async () => {
    const { proposal, sourceText } = createValidProposal();
    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 }
    });

    // 10a. Negative start offset
    const negativeProposal = {
      ...proposal,
      edits: [{ ...proposal.edits[0], range: { start: -5, end: 10 } }]
    };
    const resNeg = await validateFixProposal(negativeProposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });
    expect(resNeg.valid).toBe(false);
    if (!resNeg.valid) expect(resNeg.reasonCode).toBe("INVALID_RANGE");

    // 10b. Reversed offset (start > end)
    const reversedProposal = {
      ...proposal,
      edits: [{ ...proposal.edits[0], range: { start: 20, end: 10 } }]
    };
    const resRev = await validateFixProposal(reversedProposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });
    expect(resRev.valid).toBe(false);
    if (!resRev.valid) expect(resRev.reasonCode).toBe("INVALID_RANGE");

    // 10c. Out of bounds offset (end > length)
    const oobProposal = {
      ...proposal,
      edits: [{ ...proposal.edits[0], range: { start: 0, end: sourceText.length + 50 } }]
    };
    const resOob = await validateFixProposal(oobProposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });
    expect(resOob.valid).toBe(false);
    if (!resOob.valid) expect(resOob.reasonCode).toBe("INVALID_RANGE");

    // 10d. Position/offset inconsistency: line/col does not match offset
    const inconsistentPosProposal = {
      ...proposal,
      edits: [
        {
          ...proposal.edits[0],
          // Real offset 74..79 is line 1, char 42..47. Setting false line 1, char 10..20:
          start: { line: 1, character: 10 },
          end: { line: 1, character: 20 }
        }
      ]
    };
    const resInconsistent = await validateFixProposal(inconsistentPosProposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });
    expect(resInconsistent.valid).toBe(false);
    if (!resInconsistent.valid) {
      expect(resInconsistent.reasonCode).toBe("POSITION_OFFSET_MISMATCH");
    }
  });

  it("11. validates CRLF documents and Unicode preceding the edit location accurately", async () => {
    // CRLF document with emoji preceding the target edit
    const crlfUnicodeText =
      "// Greeting: 👋🌍 Rocket: 🚀\r\nconst res = fetch('/api/users', { method: 'GET' });\r\n";
    const hash = computeContentHash(crlfUnicodeText);

    const startOffset = crlfUnicodeText.indexOf("'GET'");
    const endOffset = startOffset + "'GET'".length;

    // Line 0: "// Greeting: 👋🌍 Rocket: 🚀\r\n"
    // Line 1: "const res = fetch('/api/users', { method: 'GET' });\r\n"
    // 'GET' is on Line 1, char 42
    const edit: ProposedEdit = {
      id: "prop:crlf:edit:0",
      proposalId: "prop:crlf:1" as FixProposal["id"],
      documentUri: docUri,
      range: { start: startOffset, end: endOffset },
      start: { line: 1, character: 42 },
      end: { line: 1, character: 47 },
      newText: "'POST'",
      expectedContentHash: hash,
      expectedDocumentVersion: 1
    };

    const proposal: FixProposal = {
      id: "prop:crlf:1" as FixProposal["id"],
      findingId: "finding:crlf" as FindingId,
      workspaceId: workspaceRoot as WorkspaceId,
      generation: 1,
      title: "Update method in CRLF Unicode file",
      rationale: "Contract consistency",
      assumptions: [],
      risk: "mechanical",
      targetRole: "consumer",
      edits: [edit],
      status: "proposed"
    };

    const accessor = createMockAccessor({
      [docUri]: { text: crlfUnicodeText, version: 1 }
    });

    const result = await validateFixProposal(proposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(true);
  });

  it("12. rejects the entire multi-edit proposal if any single edit is invalid", async () => {
    const { proposal, sourceText } = createValidProposal();
    const validEdit = proposal.edits[0];

    // Second edit on another document with invalid content hash
    const otherDocUri: DocumentUri = "file:///workspace/app/src/other.ts";
    const otherText = "export const config = { method: 'POST' };\n";
    const invalidSecondEdit: ProposedEdit = {
      id: "prop:consumer:1:edit:1",
      proposalId: proposal.id,
      documentUri: otherDocUri,
      range: { start: 33, end: 39 },
      start: { line: 0, character: 33 },
      end: { line: 0, character: 39 },
      newText: "'GET'",
      expectedContentHash: "stale-bogus-hash", // Mismatch!
      expectedDocumentVersion: 1
    };

    const multiEditProposal: FixProposal = {
      ...proposal,
      edits: [validEdit, invalidSecondEdit]
    };

    const accessor = createMockAccessor({
      [docUri]: { text: sourceText, version: 1 },
      [otherDocUri]: { text: otherText, version: 1 }
    });

    const result = await validateFixProposal(multiEditProposal, {
      workspaceRoots: [workspaceRoot],
      documentAccessor: accessor
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe("CONTENT_HASH_MISMATCH");
      expect(result.details?.editId).toBe("prop:consumer:1:edit:1");
      expect(result.details?.documentUri).toBe(otherDocUri);
    }
  });
});
