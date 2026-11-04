/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

const {
  MockPosition,
  MockRange,
  MockLocation,
  MockDiagnosticRelatedInformation,
  MockDiagnosticSeverity,
  MockDiagnostic,
  MockUri,
  MockMarkdownString,
  MockHover,
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
    contains(pos: MockPosition): boolean {
      if (pos.line < this.start.line || pos.line > this.end.line) return false;
      if (pos.line === this.start.line && pos.character < this.start.character) return false;
      if (pos.line === this.end.line && pos.character > this.end.character) return false;
      return true;
    }
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
    constructor(public readonly path: string) {}
    toString(): string {
      return this.path.startsWith("file://") ? this.path : `file://${this.path}`;
    }
    static parse(str: string): MockUri {
      return new MockUri(str);
    }
    static file(path: string): MockUri {
      return new MockUri(path);
    }
  }

  class MockMarkdownString {
    public value: string;
    public isTrusted = false;
    public supportHtml = false;
    constructor(value = "", isTrusted = false) {
      this.value = value;
      this.isTrusted = isTrusted;
    }
    appendMarkdown(text: string): void {
      this.value += text;
    }
  }

  class MockHover {
    constructor(
      public readonly contents: MockMarkdownString[],
      public readonly range?: MockRange
    ) {}
  }

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Location: MockLocation,
    DiagnosticRelatedInformation: MockDiagnosticRelatedInformation,
    DiagnosticSeverity: MockDiagnosticSeverity,
    Diagnostic: MockDiagnostic,
    Uri: MockUri,
    MarkdownString: MockMarkdownString,
    Hover: MockHover,
    languages: {
      createDiagnosticCollection: vi.fn(),
      registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() }))
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
    MockMarkdownString,
    MockHover,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

import Module from "module";

// Intercept Module.prototype.require for CJS require("vscode")
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

import type { Finding, FindingId, SourceSpan } from "@undrift/core";
import { DriftHoverProvider, isPositionInSpan } from "../../apps/vscode-extension/src/diagnostics";

function createSampleFinding(id: string, overrides?: Partial<Finding>): Finding {
  return {
    id: id as FindingId,
    ruleId: "UND110",
    category: "route",
    severity: "warning",
    state: "active",
    title: "Unmapped Backend Route",
    summary: "Backend route has no matching consumer in workspace",
    explanation: "No client calls this route",
    evidenceStrength: "direct",
    observationIds: [],
    sourceLocations: [
      {
        uri: "file:///test/workspace/server.ts",
        start: { line: 10, character: 2 },
        end: { line: 10, character: 30 }
      }
    ],
    limitations: [],
    fixProposalIds: [],
    ...overrides
  };
}

describe("DriftHoverProvider", () => {
  describe("isPositionInSpan", () => {
    const span: SourceSpan = {
      uri: "file:///test/file.ts",
      start: { line: 5, character: 10 },
      end: { line: 5, character: 25 }
    };

    it("returns true for positions strictly inside the span", () => {
      const pos = new MockPosition(5, 15) as any;
      expect(isPositionInSpan(span, pos)).toBe(true);
    });

    it("returns true for positions on start and end boundaries", () => {
      expect(isPositionInSpan(span, new MockPosition(5, 10) as any)).toBe(true);
      expect(isPositionInSpan(span, new MockPosition(5, 25) as any)).toBe(true);
    });

    it("returns false for positions on different lines or outside characters", () => {
      expect(isPositionInSpan(span, new MockPosition(4, 15) as any)).toBe(false);
      expect(isPositionInSpan(span, new MockPosition(6, 15) as any)).toBe(false);
      expect(isPositionInSpan(span, new MockPosition(5, 9) as any)).toBe(false);
      expect(isPositionInSpan(span, new MockPosition(5, 26) as any)).toBe(false);
    });

    it("handles multi-line spans correctly", () => {
      const multiSpan: SourceSpan = {
        uri: "file:///test/file.ts",
        start: { line: 2, character: 5 },
        end: { line: 4, character: 10 }
      };
      expect(isPositionInSpan(multiSpan, new MockPosition(2, 6) as any)).toBe(true);
      expect(isPositionInSpan(multiSpan, new MockPosition(3, 0) as any)).toBe(true);
      expect(isPositionInSpan(multiSpan, new MockPosition(4, 9) as any)).toBe(true);
      expect(isPositionInSpan(multiSpan, new MockPosition(2, 4) as any)).toBe(false);
      expect(isPositionInSpan(multiSpan, new MockPosition(4, 11) as any)).toBe(false);
    });
  });

  describe("provideHover", () => {
    it("returns rich markdown hover for active finding at position", () => {
      const finding = createSampleFinding("find:und110:1", {
        ruleId: "UND110",
        title: "Unmapped Backend Route",
        sourceLocations: [
          {
            uri: "file:///workspace/src/routes.ts",
            start: { line: 12, character: 4 },
            end: { line: 12, character: 40 }
          }
        ]
      });

      const coordinator: any = {
        getActiveWorkspaceId: () => "/workspace",
        getLastKnownSnapshot: () => ({ findings: [finding] }),
        getLastAcceptedAnalysisResult: () => ({ findings: [finding] })
      };

      const provider = new DriftHoverProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      const document: any = {
        uri: MockUri.file("file:///workspace/src/routes.ts")
      };
      const position = new MockPosition(12, 10) as any;

      const hover = provider.provideHover(document, position) as any;
      expect(hover).toBeDefined();
      expect(hover.contents).toHaveLength(1);

      const md = hover.contents[0].value;
      expect(md).toContain("### UNDRIFT: [UND110] Unmapped Backend Route");
      expect(md).toContain("This does NOT confirm dead code");
      expect(md).toContain("**Automatic Fix:** Automatically deleting unmapped routes");
      expect(md).toContain("**Recommended Action:**");
      expect(md).toContain("command:undrift.showReport");
      expect(hover.contents[0].isTrusted).toBe(true);
    });

    it("displays candidate proposal status when fix proposals are available", () => {
      const finding = createSampleFinding("find:und120:1", {
        ruleId: "UND120",
        sourceLocations: [
          {
            uri: "file:///workspace/src/api.ts",
            start: { line: 20, character: 0 },
            end: { line: 20, character: 30 }
          }
        ],
        fixProposalIds: ["prop:1" as any]
      });

      const coordinator: any = {
        getActiveWorkspaceId: () => "/workspace",
        getLastKnownSnapshot: () => ({ findings: [finding] }),
        getLastAcceptedAnalysisResult: () => ({ findings: [finding] })
      };

      const fixService: any = {
        getProposalsForFinding: () => [{ id: "prop:1" }]
      };

      const provider = new DriftHoverProvider({
        coordinator,
        fixService,
        vscodeModule: mockVsCodeModule as any
      });

      const document: any = {
        uri: MockUri.file("file:///workspace/src/api.ts")
      };
      const position = new MockPosition(20, 5) as any;

      const hover = provider.provideHover(document, position) as any;
      expect(hover).toBeDefined();
      const md = hover.contents[0].value;
      expect(md).toContain("### UNDRIFT: [UND120] HTTP Method Conflict");
      expect(md).toContain("**Automatic Fix:** Candidate repair proposals available");
    });

    it("returns undefined when position does not intersect any findings", () => {
      const finding = createSampleFinding("find:und110:1", {
        sourceLocations: [
          {
            uri: "file:///workspace/src/routes.ts",
            start: { line: 12, character: 4 },
            end: { line: 12, character: 40 }
          }
        ]
      });

      const coordinator: any = {
        getActiveWorkspaceId: () => "/workspace",
        getLastKnownSnapshot: () => ({ findings: [finding] }),
        getLastAcceptedAnalysisResult: () => ({ findings: [finding] })
      };

      const provider = new DriftHoverProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      const document: any = {
        uri: MockUri.file("file:///workspace/src/routes.ts")
      };
      // Different line
      const position = new MockPosition(50, 0) as any;

      const hover = provider.provideHover(document, position);
      expect(hover).toBeUndefined();
    });

    it("falls back to diagnostic provider ranges when available", () => {
      const finding = createSampleFinding("find:und200:1", {
        ruleId: "UND200",
        sourceLocations: [] // No source locations on finding directly
      });

      const coordinator: any = {
        getActiveWorkspaceId: () => "/workspace",
        getLastKnownSnapshot: () => ({ findings: [finding] })
      };

      const diagRange = new MockRange(new MockPosition(5, 0), new MockPosition(5, 20));
      const diagnosticProvider: any = {
        getDiagnostics: () => [
          {
            code: "UND200",
            range: diagRange
          }
        ]
      };

      const provider = new DriftHoverProvider({
        coordinator,
        diagnosticProvider,
        vscodeModule: mockVsCodeModule as any
      });

      const document: any = {
        uri: MockUri.file("file:///workspace/src/client.ts")
      };
      const position = new MockPosition(5, 10) as any;

      const hover = provider.provideHover(document, position) as any;
      expect(hover).toBeDefined();
      expect(hover.contents[0].value).toContain(
        "### UNDRIFT: [UND200] Missing Required Request Field"
      );
    });
  });
});
