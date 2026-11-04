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

const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

import {
  getDiagnosticGuidance,
  getWarningGuidance,
  type Finding,
  type FindingId
} from "@undrift/core";
import { DriftHoverProvider } from "../../apps/vscode-extension/src/diagnostics/hover-provider";
import { renderReportHtml } from "../../apps/vscode-extension/src/views/report-panel";

describe("Extension Development Host & UX Manual Verification", () => {
  const sampleUnd110: Finding = {
    id: "find:UND110:expense-tracker-unmapped" as FindingId,
    ruleId: "UND110",
    category: "existence",
    severity: "info",
    state: "active",
    title: "Provider has no known consumer",
    summary: "No known consumer found in the analyzed scope for POST '/api/auth/register'.",
    explanation: "No in-workspace caller targets this backend endpoint.",
    evidenceStrength: "direct",
    observationIds: ["obs:provider:1" as any],
    sourceLocations: [
      {
        uri: "file:///server/routes/auth.js",
        start: { line: 15, character: 0 },
        end: { line: 15, character: 35 }
      }
    ],
    limitations: [],
    fixProposalIds: []
  };

  describe("UND110 diagnostic hover", () => {
    it("displays compact hover with canonical title, concise detection, no-fix explanation, recommended next action, and report navigation", () => {
      const coordinator: any = {
        getActiveWorkspaceId: () => "/workspace",
        getLastKnownSnapshot: () => ({ findings: [sampleUnd110] }),
        getLastAcceptedAnalysisResult: () => ({ findings: [sampleUnd110] })
      };

      const provider = new DriftHoverProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      const document: any = {
        uri: MockUri.file("file:///server/routes/auth.js")
      };
      const position = new MockPosition(15, 5) as any;

      const hover = provider.provideHover(document, position) as any;
      expect(hover).toBeDefined();

      const md = hover.contents[0].value;
      // 1. Canonical rule title and code
      expect(md).toContain("**UNDRIFT: UND110 — Provider has no known consumer**");

      // 2. Explanation of what was detected (does NOT confirm dead code)
      expect(md).toContain("This does not necessarily indicate dead code");
      expect(md).toContain("external applications, services or scheduled jobs");

      // 3. Concise reason no automatic repair is available
      expect(md).toContain("**Why no automatic fix?**");
      expect(md).toContain("cannot determine whether this endpoint should be deleted");

      // 4. Actionable next step (only one recommended action, not all 7)
      expect(md).toContain(
        "**Recommended Action:** Verify whether internal or external consumers rely on this endpoint before making changes."
      );
      expect(md).not.toContain("7.");

      // 5. Navigation to the Integration Report
      expect(md).toContain("command:undrift.showReport");
      expect(md).toContain("Open full Resolution Guidance in Integration Report");
      expect(hover.contents[0].isTrusted).toBe(true);
    });
  });

  describe("UND110 Integration Report", () => {
    it("renders Resolution Guidance inside the finding, starts collapsed, and keeps proposals distinct without duplication", () => {
      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        workspaceLabel: "Expense Tracker",
        status: "freshly-verified",
        findings: [sampleUnd110],
        history: [],
        warnings: [],
        proposalsByFinding: new Map([[sampleUnd110.id, []]])
      });

      // Summary counter uses Unmapped Provider Endpoints, NOT Missing Endpoint
      expect(html).toContain("Unmapped Provider Endpoints:");
      expect(html).not.toContain("Missing Endpoint:");

      // Resolution Guidance appears inside finding with canonical title
      expect(html).toContain("Resolution Guidance: Provider has no known consumer");

      // Guidance starts collapsed (does NOT have 'open' attribute)
      expect(html).toContain('<details class="guidance-details">');
      expect(html).not.toContain('<details class="guidance-details" open>');

      // Finding summary remains visible
      expect(html).toContain(
        "No known consumer found in the analyzed scope for POST &#39;/api/auth/register&#39;."
      );

      // Complete explanation and suggested steps are present inside the details element
      expect(html).toContain('<div class="guidance-heading">What this means</div>');
      expect(html).toContain("This does NOT confirm dead code");
      expect(html).toContain('<div class="guidance-heading">Why it matters</div>');
      expect(html).toContain(
        '<div class="guidance-heading">Why automated repair is unavailable</div>'
      );
      expect(html).toContain('<div class="guidance-heading">Suggested Resolution Steps</div>');
      expect(html).toContain("Verify whether internal or external consumers rely on this endpoint");
      expect(html).toContain("dynamic route invocations");
      expect(html).toContain("work-in-progress or planned endpoint");
      expect(html).toContain("decommissioning or archiving");
      expect(html).toContain("frontend API client call");
      expect(html).toContain("unsupported client library");
      expect(html).toContain("path and method spelling");

      // Candidate repair proposals section displays short status without duplicate explanation
      expect(html).toContain("Candidate Repair Proposals");
      expect(html).toContain("No deterministic code modification is available for this finding.");
      expect(html).not.toContain(
        "Automated repair proposals are not supported for rule <code>UND110</code>."
      );
    });
  });

  describe("PARTIAL_SHAPE diagnostic", () => {
    it("provides reason-specific title, accurate no-fix explanation, and non-restructuring suggested steps", () => {
      // Reason: explicit-unknown-type
      const unknownGuidance = getWarningGuidance("PARTIAL_SHAPE", "explicit-unknown-type");
      expect(unknownGuidance.title).toBe("Explicit Unknown Type");
      expect(unknownGuidance.whatDetected).toContain(
        "explicitly annotated as TypeScript 'unknown'"
      );
      expect(unknownGuidance.whyNoAutomatedFix).toContain(
        "Concrete types cannot be fabricated safely without domain specifications."
      );
      expect(unknownGuidance.suggestedSteps[0]).toContain(
        "Replace 'unknown' with an explicit TypeScript interface or type alias"
      );

      // Reason: explicit-any-type
      const anyGuidance = getWarningGuidance("PARTIAL_SHAPE", "explicit-any-type");
      expect(anyGuidance.title).toBe("Explicit Any Type");
      expect(anyGuidance.whatDetected).toContain("explicitly annotated as TypeScript 'any'");
      expect(anyGuidance.whyNoAutomatedFix).toContain(
        "Automated typing cannot guess the intended payload fields safely."
      );
      expect(anyGuidance.suggestedSteps[0]).toContain(
        "Replace 'any' with a strongly-typed DTO interface or type alias"
      );

      // Reason: cross-module-forwarding
      const crossGuidance = getWarningGuidance("PARTIAL_SHAPE", "cross-module-forwarding");
      expect(crossGuidance.title).toBe("Cross-Module Forwarding");
      expect(crossGuidance.whyNoAutomatedFix).toContain(
        "Cross-module dataflow requires global project architecture decisions."
      );
      expect(crossGuidance.suggestedSteps[0]).toContain(
        "Declare an explicit TypeScript interface for the forwarded request payload"
      );

      // Reason: multipart-no-construction-evidence
      const multipartGuidance = getWarningGuidance(
        "PARTIAL_SHAPE",
        "multipart-no-construction-evidence"
      );
      expect(multipartGuidance.title).toBe("FormData Construction Not Found");
      expect(multipartGuidance.suggestedSteps[0]).toContain(
        "Trace this FormData parameter through its callers and locate where the instance is created and populated."
      );
      expect(multipartGuidance.suggestedSteps[0]).toContain(
        "UNDRIFT could not establish the multipart payload from the available source evidence."
      );
      expect(multipartGuidance.suggestedSteps[0]).not.toContain(
        "Ensure FormData mutations occur in the same scope"
      );
    });
  });
});
