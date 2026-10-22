// Phase 4, Chunk 4.5: VS Code Diagnostic Integration Tests
// Verifies native VS Code diagnostic mapping, coordinator/scheduler connection,
// incomplete-scan safety, and lifecycle disposal strictly adhering to LLD.md Section 14.4.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisStatistics,
  DocumentUri,
  Finding,
  FindingSeverity,
  SourceDocument,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import {
  DriftDiagnosticProvider,
  formatDiagnosticMessage,
  InMemoryDiagnosticCollection,
  mapFindingSeverityToDiagnosticSeverity,
  parseDocumentUri,
  sourceSpanToVsCodeRange
} from "../../apps/vscode-extension/src/diagnostics";
import {
  AnalysisCoordinator,
  deriveWorkspaceId,
  type CoordinatorAnalysisResult
} from "../../apps/vscode-extension/src/activation";
import {
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike,
  WorkspaceManager,
  type WorkspaceSnapshotResult
} from "../../apps/vscode-extension/src/workspace";
import { activate, deactivate } from "../../apps/vscode-extension/src/extension";

const {
  MockPosition,
  MockRange,
  MockLocation,
  MockDiagnosticRelatedInformation,
  MockDiagnosticSeverity,
  MockDiagnostic,
  MockUri,
  mockVsCodeModule
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

  class MockLocation {
    constructor(
      public readonly uri: MockUri,
      public readonly range: MockRange
    ) {}
  }

  class MockDiagnosticRelatedInformation {
    constructor(
      public readonly location: MockLocation,
      public readonly message: string
    ) {}
  }

  enum MockDiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
  }

  class MockDiagnostic {
    public source?: string;
    public code?: string | number | { value: string | number; target: MockUri };
    public relatedInformation?: MockDiagnosticRelatedInformation[];

    constructor(
      public range: MockRange,
      public message: string,
      public severity: MockDiagnosticSeverity = MockDiagnosticSeverity.Error
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
    Diagnostic: MockDiagnostic,
    DiagnosticSeverity: MockDiagnosticSeverity,
    DiagnosticRelatedInformation: MockDiagnosticRelatedInformation,
    Position: MockPosition,
    Range: MockRange,
    Location: MockLocation,
    Uri: MockUri,
    languages: {
      createDiagnosticCollection: vi.fn((name?: string) => {
        const store = new Map<string, readonly MockDiagnostic[]>();
        return {
          name: name ?? "undrift",
          set: vi.fn((uri: MockUri, diags: readonly MockDiagnostic[] | undefined) => {
            if (!diags || diags.length === 0) {
              store.delete(uri.toString());
            } else {
              store.set(uri.toString(), diags);
            }
          }),
          delete: vi.fn((uri: MockUri) => {
            store.delete(uri.toString());
          }),
          clear: vi.fn(() => {
            store.clear();
          }),
          get: vi.fn((uri: MockUri) => store.get(uri.toString())),
          has: vi.fn((uri: MockUri) => store.has(uri.toString())),
          dispose: vi.fn(() => {
            store.clear();
          })
        };
      })
    },
    commands: {
      registerCommand: vi.fn((_cmd: string, handler: (...args: unknown[]) => unknown) => ({
        dispose: vi.fn(),
        _handler: handler
      }))
    },
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
        show: vi.fn()
      }))
    },
    workspace: {
      workspaceFolders: [],
      onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreateFiles: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
      onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() }))
    }
  };

  return {
    MockPosition,
    MockRange,
    MockLocation,
    MockDiagnosticRelatedInformation,
    MockDiagnosticSeverity,
    MockDiagnostic,
    MockUri,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

import Module from "module";

// Intercept Module.prototype.require for CJS require("vscode")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

function createSpan(
  uri: DocumentUri,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): SourceSpan {
  return {
    uri,
    range: { start: 0, end: 100 },
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar }
  };
}

function createFinding(overrides: Partial<Finding> = {}): Finding {
  const uri = overrides.sourceLocations?.[0]?.uri ?? "file:///workspace/src/consumer.ts";
  return {
    id: overrides.id ?? ("finding-1" as Finding["id"]),
    ruleId: overrides.ruleId ?? ("UND200" as Finding["ruleId"]),
    category: overrides.category ?? "type",
    severity: overrides.severity ?? "error",
    state: overrides.state ?? "active",
    title: overrides.title ?? "Type Mismatch",
    summary: overrides.summary ?? "Consumer expects string, provider returns number.",
    explanation: overrides.explanation ?? "Detailed explanation of type mismatch.",
    evidenceStrength: overrides.evidenceStrength ?? "direct",
    observationIds: overrides.observationIds ?? [],
    sourceLocations: overrides.sourceLocations ?? [createSpan(uri, 5, 2, 5, 18)],
    limitations: overrides.limitations ?? [],
    fixProposalIds: overrides.fixProposalIds ?? [],
    ...overrides
  };
}

function createSampleStatistics(): AnalysisStatistics {
  return {
    filesConsidered: 2,
    filesParsed: 2,
    filesWithWarnings: 0,
    consumerObservations: 1,
    providerObservations: 1,
    relationships: 1,
    activeFindings: 1,
    unresolvedPatterns: 0,
    durationMs: 10
  };
}

class FakeAnalysisEngine implements AnalysisEnginePort {
  public analyzeFn?: (request: AnalysisRequest, signal?: AbortSignal) => Promise<AnalysisResult>;

  async analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult> {
    if (this.analyzeFn) {
      return this.analyzeFn(request, signal);
    }
    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      complete: true,
      findings: [],
      warnings: [],
      statistics: createSampleStatistics(),
      generatedAt: new Date().toISOString()
    };
  }

  async dispose(): Promise<void> {}
}

class TestWorkspaceAccessor implements WorkspaceAccessor {
  constructor(public folders: WorkspaceFolderLike[]) {}

  getWorkspaceFolders(): WorkspaceFolderLike[] | undefined {
    return this.folders;
  }

  findFiles(): Promise<UriLike[]> {
    return Promise.resolve([]);
  }
}

class TestOpenDocumentAccessor implements OpenDocumentAccessor {
  constructor(
    public documents: {
      uri: UriLike;
      getText(): string;
      languageId?: string;
      version?: number;
    }[] = []
  ) {}

  getOpenTextDocuments() {
    return this.documents;
  }
}

describe("DriftDiagnosticProvider", () => {
  let collection: InMemoryDiagnosticCollection;
  let provider: DriftDiagnosticProvider;

  beforeEach(() => {
    collection = new InMemoryDiagnosticCollection("undrift-test");
    provider = new DriftDiagnosticProvider({
      collection,
      vscodeModule: mockVsCodeModule as unknown as typeof import("vscode")
    });
  });

  // 1. Correct mapping of error, warning, and informational finding severities
  it("correctly maps error, warning, and informational finding severities", () => {
    expect(mapFindingSeverityToDiagnosticSeverity("error")).toBe(MockDiagnosticSeverity.Error);
    expect(mapFindingSeverityToDiagnosticSeverity("warning")).toBe(MockDiagnosticSeverity.Warning);
    expect(mapFindingSeverityToDiagnosticSeverity("info")).toBe(MockDiagnosticSeverity.Information);
  });

  // 2. Correct diagnostic messages, source, and rule codes
  it("correctly formats diagnostic message, source 'UNDRIFT', and rule code", () => {
    const finding = createFinding({
      ruleId: "UND120" as Finding["ruleId"],
      title: "Route Parameter Drift",
      summary: "Consumer route parameter ':id' does not match provider parameter ':userId'."
    });

    const range = new MockRange(new MockPosition(1, 0), new MockPosition(1, 10));
    const diagnostic = provider.createDiagnostic(
      finding,
      range as unknown as import("vscode").Range
    );

    expect(diagnostic.source).toBe("UNDRIFT");
    expect(diagnostic.code).toBe("UND120");
    expect(diagnostic.message).toBe(
      "Consumer route parameter ':id' does not match provider parameter ':userId'."
    );
    expect(diagnostic.severity).toBe(MockDiagnosticSeverity.Error);
  });

  // 3. Correct source range mapping and handling of missing locations
  it("correctly maps UTF-16 line and character coordinates to VS Code Range", () => {
    const span = createSpan("file:///workspace/src/app.ts", 12, 4, 12, 28);
    const range = sourceSpanToVsCodeRange(span);

    expect(range).toBeDefined();
    expect(range!.start.line).toBe(12);
    expect(range!.start.character).toBe(4);
    expect(range!.end.line).toBe(12);
    expect(range!.end.character).toBe(28);
  });

  it("handles missing, undefined, or empty source locations conservatively without throwing", () => {
    expect(sourceSpanToVsCodeRange(undefined)).toBeUndefined();
    expect(sourceSpanToVsCodeRange({} as SourceSpan)).toBeUndefined();

    // Invalid negative coordinates
    const negativeSpan = createSpan("file:///workspace/src/app.ts", -1, 0, 5, 10);
    expect(sourceSpanToVsCodeRange(negativeSpan)).toBeUndefined();

    // Inverted coordinates clamp safely
    const invertedSpan = createSpan("file:///workspace/src/app.ts", 10, 5, 8, 2);
    const clampedRange = sourceSpanToVsCodeRange(invertedSpan);
    expect(clampedRange).toBeDefined();
    expect(clampedRange!.start.line).toBe(10);
    expect(clampedRange!.end.line).toBe(10);

    // Finding with no locations is conservatively skipped
    const findingWithoutLocations = createFinding({ sourceLocations: [] });
    const outcome: CoordinatorAnalysisResult = {
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [findingWithoutLocations],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    };

    expect(() => provider.updateDiagnostics(outcome)).not.toThrow();
    expect(
      collection.get(
        MockUri.parse("file:///workspace/src/consumer.ts") as unknown as import("vscode").Uri
      )
    ).toBeUndefined();
  });

  // 4. Findings referring to both consumer and provider source locations
  it("attaches DiagnosticRelatedInformation for findings spanning consumer and provider locations", () => {
    const consumerUri = "file:///workspace/src/client.ts";
    const providerUri = "file:///workspace/src/server.ts";

    const finding = createFinding({
      ruleId: "UND201" as Finding["ruleId"],
      title: "Missing Response Field",
      sourceLocations: [
        createSpan(consumerUri, 4, 10, 4, 25), // primary: consumer
        createSpan(providerUri, 20, 2, 20, 30) // related: provider
      ]
    });

    const outcome: CoordinatorAnalysisResult = {
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [finding],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    };

    provider.updateDiagnostics(outcome);

    const primaryUri = MockUri.parse(consumerUri) as unknown as import("vscode").Uri;
    const diagnostics = provider.getDiagnostics(primaryUri);
    expect(diagnostics).toHaveLength(1);

    const diag = diagnostics[0];
    expect(diag.range.start.line).toBe(4);
    expect(diag.range.start.character).toBe(10);
    expect(diag.relatedInformation).toBeDefined();
    expect(diag.relatedInformation).toHaveLength(1);

    const related = diag.relatedInformation![0];
    expect(related.location.uri.toString()).toBe(providerUri);
    expect(related.location.range.start.line).toBe(20);
    expect(related.message).toContain("Missing Response Field");
  });

  // 5. A complete accepted result replaces prior diagnostics
  it("replaces prior diagnostics when a complete accepted result arrives", () => {
    const docUri = "file:///workspace/src/api.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    // Scan 1: finding A
    const findingA = createFinding({
      id: "finding-A" as Finding["id"],
      summary: "First drift finding",
      sourceLocations: [createSpan(docUri, 10, 0, 10, 15)]
    });
    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [findingA],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    expect(provider.getDiagnostics(uri)).toHaveLength(1);
    expect(provider.getDiagnostics(uri)[0].message).toBe("First drift finding");

    // Scan 2: finding B replaces finding A
    const findingB = createFinding({
      id: "finding-B" as Finding["id"],
      summary: "Updated drift finding",
      sourceLocations: [createSpan(docUri, 15, 0, 15, 20)]
    });
    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 2,
        complete: true,
        findings: [findingB],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    const updated = provider.getDiagnostics(uri);
    expect(updated).toHaveLength(1);
    expect(updated[0].message).toBe("Updated drift finding");
    expect(updated[0].range.start.line).toBe(15);
  });

  // 6. A complete result with no findings clears previous diagnostics for its scope
  it("clears previous diagnostics for its scope when a complete scan has 0 findings", () => {
    const docUri = "file:///workspace/src/api.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    // Setup finding
    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [createFinding({ sourceLocations: [createSpan(docUri, 5, 0, 5, 10)] })],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });
    expect(provider.getDiagnostics(uri)).toHaveLength(1);

    // Complete scan with 0 findings
    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 2,
        complete: true,
        findings: [],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    expect(provider.getDiagnostics(uri)).toHaveLength(0);
    expect(collection.has(uri)).toBe(false);
  });

  // 7. An incomplete result does not falsely clear diagnostics for uncovered files
  it("preserves diagnostics for uncovered files during an incomplete result", () => {
    const fileA = "file:///workspace/src/fileA.ts";
    const fileB = "file:///workspace/src/fileB.ts";
    const uriA = MockUri.parse(fileA) as unknown as import("vscode").Uri;
    const uriB = MockUri.parse(fileB) as unknown as import("vscode").Uri;

    // Baseline: complete scan reports findings on both fileA and fileB
    const findingA = createFinding({
      id: "fA" as Finding["id"],
      sourceLocations: [createSpan(fileA, 2, 0, 2, 10)],
      summary: "Finding in File A"
    });
    const findingB = createFinding({
      id: "fB" as Finding["id"],
      sourceLocations: [createSpan(fileB, 8, 0, 8, 10)],
      summary: "Finding in File B"
    });

    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [findingA, findingB],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    expect(provider.getDiagnostics(uriA)).toHaveLength(1);
    expect(provider.getDiagnostics(uriB)).toHaveLength(1);

    // Incomplete scan: fileB failed acquisition, fileA has no findings
    provider.updateDiagnostics({
      status: "incomplete",
      workspaceId: "file:///workspace" as WorkspaceId,
      failures: [{ uri: fileB, error: "EACCES: permission denied" }],
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 2,
        complete: false,
        findings: [],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    // Uncovered file B MUST NOT be cleared
    expect(provider.getDiagnostics(uriB)).toHaveLength(1);
    expect(provider.getDiagnostics(uriB)[0].message).toBe("Finding in File B");

    // Absent findings on file A during incomplete scan MUST NOT be inferred as resolved
    expect(provider.getDiagnostics(uriA)).toHaveLength(1);
    expect(provider.getDiagnostics(uriA)[0].message).toBe("Finding in File A");
  });

  // 8. Failed, cancelled, and superseded outcomes do not change diagnostic state
  it("does not modify diagnostic state on failed, cancelled, or superseded outcomes", () => {
    const docUri = "file:///workspace/src/test.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    // Set initial diagnostic
    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [
          createFinding({ sourceLocations: [createSpan(docUri, 1, 0, 1, 10)], summary: "Initial" })
        ],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });
    expect(provider.getDiagnostics(uri)[0].message).toBe("Initial");

    // Outcome 1: Failed
    provider.updateDiagnostics({
      status: "failed",
      workspaceId: "file:///workspace" as WorkspaceId,
      errorMessage: "Analysis engine crashed."
    });
    expect(provider.getDiagnostics(uri)[0].message).toBe("Initial");

    // Outcome 2: Cancelled
    provider.updateDiagnostics({
      status: "cancelled",
      workspaceId: "file:///workspace" as WorkspaceId,
      errorMessage: "Scan cancelled by user."
    });
    expect(provider.getDiagnostics(uri)[0].message).toBe("Initial");

    // Outcome 3: Superseded
    provider.updateDiagnostics({
      status: "superseded",
      workspaceId: "file:///workspace" as WorkspaceId,
      errorMessage: "Scan superseded by newer generation."
    });
    expect(provider.getDiagnostics(uri)[0].message).toBe("Initial");
  });

  // 9. An engine that ignores cancellation cannot publish an obsolete result
  it("ensures an engine that ignores cancellation cannot publish an obsolete result", async () => {
    const docUri = "file:///workspace/src/service.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    const fakeEngine = new FakeAnalysisEngine();
    let resolveStaleScan: ((res: AnalysisResult) => void) | undefined;

    // Scan 1 promise simulates an engine that ignores abort signal and hangs/resolves late
    fakeEngine.analyzeFn = async (req, signal) => {
      if (req.generation === 1) {
        return new Promise<AnalysisResult>((resolve) => {
          resolveStaleScan = resolve;
          // Notice: does not listen to signal.aborted, ignores cancellation completely!
        });
      }
      return {
        workspaceId: req.workspaceId,
        generation: req.generation,
        complete: true,
        findings: [
          createFinding({
            id: "fresh-finding" as Finding["id"],
            summary: "Fresh verified finding",
            sourceLocations: [createSpan(docUri, 20, 0, 20, 10)]
          })
        ],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      };
    };

    const workspaceManager = {
      createWorkspaceSnapshot: async () => ({
        status: "success",
        workspaceRootUris: ["file:///workspace"],
        documents: [
          {
            uri: docUri,
            languageId: "typescript",
            text: "const x = 1;",
            contentHash: "hash1"
          }
        ],
        failures: [],
        totalDiscovered: 1,
        totalAcquired: 1
      }),
      getWorkspaceRoots: () => ["file:///workspace"]
    } as unknown as WorkspaceManager;

    const coordinator = new AnalysisCoordinator({
      workspaceManager,
      engine: fakeEngine,
      diagnosticProvider: provider
    });

    // Start scan 1 (generation 1)
    const scan1Promise = coordinator.runWorkspaceScan();

    // Trigger scan 2 (generation 2) which supersedes scan 1
    const scan2Promise = coordinator.runWorkspaceScan();

    const outcome2 = await scan2Promise;
    expect(outcome2.status).toBe("success");
    expect(provider.getDiagnostics(uri)).toHaveLength(1);
    expect(provider.getDiagnostics(uri)[0].message).toBe("Fresh verified finding");

    // Now engine for scan 1 finally resolves late with obsolete findings
    resolveStaleScan!({
      workspaceId: "file:///workspace" as WorkspaceId,
      generation: 1,
      complete: true,
      findings: [
        createFinding({
          id: "stale-finding" as Finding["id"],
          summary: "Obsolete stale finding",
          sourceLocations: [createSpan(docUri, 5, 0, 5, 10)]
        })
      ],
      warnings: [],
      statistics: createSampleStatistics(),
      generatedAt: new Date().toISOString()
    });

    const outcome1 = await scan1Promise;
    expect(outcome1.status).toBe("superseded");

    // Diagnostics MUST NOT have been overwritten by the stale scan 1!
    const finalDiagnostics = provider.getDiagnostics(uri);
    expect(finalDiagnostics).toHaveLength(1);
    expect(finalDiagnostics[0].message).toBe("Fresh verified finding");

    await coordinator.dispose();
  });

  // 10. Multi-root workspace behavior remains correct
  it("maintains isolated diagnostic state across multi-root workspace scopes", () => {
    const root1Ws = "multi-root:alpha" as WorkspaceId;
    const root2Ws = "multi-root:beta" as WorkspaceId;

    const file1 = "file:///root1/src/client.ts";
    const file2 = "file:///root2/src/service.ts";
    const uri1 = MockUri.parse(file1) as unknown as import("vscode").Uri;
    const uri2 = MockUri.parse(file2) as unknown as import("vscode").Uri;

    // Scan root 1
    provider.updateDiagnostics({
      status: "success",
      workspaceId: root1Ws,
      result: {
        workspaceId: root1Ws,
        generation: 1,
        complete: true,
        findings: [
          createFinding({
            id: "f1" as Finding["id"],
            sourceLocations: [createSpan(file1, 2, 0, 2, 10)],
            summary: "Finding in Root 1"
          })
        ],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    // Scan root 2
    provider.updateDiagnostics({
      status: "success",
      workspaceId: root2Ws,
      result: {
        workspaceId: root2Ws,
        generation: 1,
        complete: true,
        findings: [
          createFinding({
            id: "f2" as Finding["id"],
            sourceLocations: [createSpan(file2, 4, 0, 4, 10)],
            summary: "Finding in Root 2"
          })
        ],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    expect(provider.getDiagnostics(uri1)).toHaveLength(1);
    expect(provider.getDiagnostics(uri2)).toHaveLength(1);

    // Clear root 1: root 2 must remain unaffected
    provider.updateDiagnostics({
      status: "success",
      workspaceId: root1Ws,
      result: {
        workspaceId: root1Ws,
        generation: 2,
        complete: true,
        findings: [],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    expect(provider.getDiagnostics(uri1)).toHaveLength(0);
    expect(provider.getDiagnostics(uri2)).toHaveLength(1);
    expect(provider.getDiagnostics(uri2)[0].message).toBe("Finding in Root 2");
  });

  // 11. Extension activation and deactivation dispose diagnostic resources and subscriptions correctly
  it("registers diagnostic provider on activation and cleans up on deactivation", async () => {
    const mockContext = {
      subscriptions: [] as { dispose(): void }[],
      extensionPath: "z:/extension",
      storageUri: MockUri.parse("file:///storage")
    };

    activate(mockContext as unknown as Parameters<typeof activate>[0]);

    // Verify diagnostic provider was registered in subscriptions
    const hasDiagnosticProvider = mockContext.subscriptions.some(
      (s) =>
        s instanceof DriftDiagnosticProvider ||
        (s && typeof (s as { clear?: unknown }).clear === "function")
    );
    expect(hasDiagnosticProvider).toBe(true);

    // Verify deactivation cleans up gracefully
    await expect(deactivate()).resolves.toBeUndefined();
  });

  // 12. Suppressed and resolved findings are excluded from active diagnostics
  it("excludes suppressed and resolved findings from editor diagnostics", () => {
    const docUri = "file:///workspace/src/app.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    const activeFinding = createFinding({
      id: "f-act" as Finding["id"],
      state: "active",
      summary: "Active drift",
      sourceLocations: [createSpan(docUri, 1, 0, 1, 10)]
    });
    const suppressedFinding = createFinding({
      id: "f-sup" as Finding["id"],
      state: "suppressed",
      summary: "Suppressed drift",
      sourceLocations: [createSpan(docUri, 2, 0, 2, 10)]
    });
    const resolvedFinding = createFinding({
      id: "f-res" as Finding["id"],
      state: "resolved",
      summary: "Resolved drift",
      sourceLocations: [createSpan(docUri, 3, 0, 3, 10)]
    });

    provider.updateDiagnostics({
      status: "success",
      workspaceId: "file:///workspace" as WorkspaceId,
      result: {
        workspaceId: "file:///workspace" as WorkspaceId,
        generation: 1,
        complete: true,
        findings: [activeFinding, suppressedFinding, resolvedFinding],
        warnings: [],
        statistics: createSampleStatistics(),
        generatedAt: new Date().toISOString()
      }
    });

    const diagnostics = provider.getDiagnostics(uri);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("Active drift");
  });

  // 13. Restored snapshot publishes diagnostics accurately
  it("publishes verified diagnostics from a restored session snapshot", () => {
    const docUri = "file:///workspace/src/restored.ts";
    const uri = MockUri.parse(docUri) as unknown as import("vscode").Uri;

    const snapshot: AnalysisSnapshot = {
      workspaceId: "file:///workspace" as WorkspaceId,
      schemaVersion: 1,
      generation: 5,
      createdAt: new Date().toISOString(),
      findings: [
        createFinding({
          id: "persisted-1" as Finding["id"],
          summary: "Persisted contract drift",
          sourceLocations: [createSpan(docUri, 3, 0, 3, 10)]
        })
      ],
      coverageSummary: {
        complete: true,
        filesScanned: 1,
        filesWithWarnings: 0,
        unresolvedPatterns: 0,
        warnings: []
      }
    };

    provider.publishSnapshot("file:///workspace" as WorkspaceId, snapshot);

    const diagnostics = provider.getDiagnostics(uri);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("Persisted contract drift");
  });
});
