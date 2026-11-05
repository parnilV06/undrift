export type DocGroupId =
  | "overview"
  | "getting-started"
  | "concepts"
  | "drift-types"
  | "analysis-engine"
  | "compatibility"
  | "reference";

export interface DocListItem {
  label: string;
  text: string;
}

export interface DocSection {
  id: string;
  title: string;
  body: string[];
  list?: DocListItem[];
  code?: { title: string; source: string };
}

export interface DocPageDef {
  path: string;
  title: string;
  description: string;
  sections?: DocSection[];
}

export interface DocGroup {
  id: DocGroupId;
  title: string;
  pages: DocPageDef[];
}

const placeholder = (
  path: string,
  title: string,
  description: string,
): DocPageDef => ({
  path,
  title,
  description,
});

export const docGroups: DocGroup[] = [
  {
    id: "overview",
    title: "Overview",
    pages: [
      {
        path: "/docs/introduction",
        title: "Introduction",
        description: "What UNDRIFT is and where it fits in your workflow.",
        sections: [
          {
            id: "what-it-is",
            title: "What UNDRIFT is",
            body: [
              "UNDRIFT is a developer tool for identifying API contract drift between frontend and backend code.",
              "Over time, the way a frontend calls an API and the way a backend defines it can fall out of step. UNDRIFT statically analyzes both sides, compares what it finds, and surfaces potential mismatches with explanations and source-code evidence.",
            ],
          },
          {
            id: "scope",
            title: "Scope of the first release",
            body: [
              "The first release targets Visual Studio Code through an extension. The underlying analysis engine is designed to stay independent of the editor.",
            ],
          },
          {
            id: "what-it-is-not",
            title: "What it is not",
            body: [
              "UNDRIFT is not an AI coding assistant, an API monitoring dashboard, a runtime observability platform, or an automated API repair tool.",
            ],
          },
        ],
      },
      {
        path: "/docs/what-is-undrift",
        title: "What is UNDRIFT?",
        description:
          "The problem UNDRIFT addresses and the kinds of mismatch it reports.",
        sections: [
          {
            id: "purpose",
            title: "Purpose",
            body: [
              "UNDRIFT focuses on API contract analysis. It checks whether frontend API usage still matches backend API definitions.",
            ],
          },
          {
            id: "mismatches",
            title: "Mismatches it looks for",
            body: ["UNDRIFT looks for inconsistencies such as the following."],
            list: [
              {
                label: "Endpoints",
                text: "A frontend call references a route that no longer matches the backend.",
              },
              {
                label: "HTTP methods",
                text: "The method a frontend call expects differs from the method a backend endpoint defines.",
              },
              {
                label: "Request structure",
                text: "The request shape a frontend sends differs from the one a backend expects.",
              },
              {
                label: "Response structure",
                text: "The response shape a frontend reads differs from the one a backend defines.",
              },
              {
                label: "Fields",
                text: "Fields are missing or inconsistent across the two sides of a contract.",
              },
            ],
          },
          {
            id: "reports-not-repairs",
            title: "Reports, not repairs",
            body: [
              "UNDRIFT reports potential mismatches with explanations. It does not rewrite your code.",
            ],
          },
        ],
      },
      {
        path: "/docs/how-it-works",
        title: "How UNDRIFT works",
        description: "The four stages from source code to findings.",
        sections: [
          {
            id: "stages",
            title: "Four stages",
            body: [
              "Analysis moves through four stages, each building on the one before it.",
            ],
            list: [
              {
                label: "01 Inspect",
                text: "Analyze relevant frontend API usage and backend API definitions.",
              },
              {
                label: "02 Extract",
                text: "Extract route, method, and request/response shape observations.",
              },
              {
                label: "03 Compare",
                text: "Normalize and compare the observations to identify potential contract mismatches.",
              },
              {
                label: "04 Explain",
                text: "Present findings with explanations and source-code evidence.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    pages: [
      placeholder(
        "/docs/getting-started/installation",
        "Installation",
        "How to install UNDRIFT and its Visual Studio Code extension.",
      ),
      placeholder(
        "/docs/getting-started/quick-start",
        "Quick Start",
        "Run UNDRIFT on a project for the first time.",
      ),
      placeholder(
        "/docs/getting-started/first-analysis",
        "First Analysis",
        "Walk through reading the output of your first analysis.",
      ),
    ],
  },
  {
    id: "concepts",
    title: "Core Concepts",
    pages: [
      {
        path: "/docs/concepts/api-contract-drift",
        title: "API Contract Drift",
        description:
          "How frontend and backend API expectations gradually diverge.",
        sections: [
          {
            id: "definition",
            title: "Definition",
            body: [
              "API contract drift describes the gradual divergence between how a frontend uses an API and how the backend defines it.",
              "Drift rarely appears all at once. A renamed route, a changed method, or a field removed from a response can each leave one side behind the other.",
            ],
          },
          {
            id: "common-forms",
            title: "Common forms",
            body: ["Drift typically shows up in one of these forms."],
            list: [
              {
                label: "Route / endpoint",
                text: "The frontend references an endpoint the backend no longer matches.",
              },
              {
                label: "HTTP method",
                text: "The frontend and backend disagree on the method for the same endpoint.",
              },
              {
                label: "Request / response shape",
                text: "The data structures on each side no longer line up.",
              },
            ],
          },
          {
            id: "example",
            title: "Example",
            body: [
              "The snippet below is illustrative only. It is not UNDRIFT output.",
              "The frontend expects a GET for this path, while the backend defines POST. This is the kind of mismatch the HTTP method drift category describes.",
            ],
            code: {
              title: "Illustrative example",
              source: `// Frontend: an API call
const res = await fetch("/api/users", { method: "GET" });

// Backend: a route definition
router.post("/api/users", createUser);`,
            },
          },
        ],
      },
      placeholder(
        "/docs/concepts/frontend-api-observations",
        "Frontend API Observations",
        "What is extracted from frontend API usage.",
      ),
      placeholder(
        "/docs/concepts/backend-api-definitions",
        "Backend API Definitions",
        "What is extracted from backend API definitions.",
      ),
      placeholder(
        "/docs/concepts/contract-matching",
        "Contract Matching",
        "How observations from each side are paired and compared.",
      ),
      placeholder(
        "/docs/concepts/findings-and-explanations",
        "Findings and Explanations",
        "What a finding contains and how it explains a mismatch.",
      ),
    ],
  },
  {
    id: "drift-types",
    title: "Drift Types",
    pages: [
      {
        path: "/docs/drift-types",
        title: "Overview",
        description: "The categories of contract drift UNDRIFT describes.",
        sections: [
          {
            id: "categories",
            title: "Categories",
            body: [
              "Each category has its own page with definitions and detection details.",
            ],
            list: [
              {
                label: "Route / Endpoint Drift",
                text: "Differences between the endpoints referenced by frontend code and the routes defined by the backend.",
              },
              {
                label: "HTTP Method Drift",
                text: "Inconsistencies between the HTTP methods expected by frontend API calls and those defined by backend endpoints.",
              },
              {
                label: "Request Shape Drift",
                text: "Differences between the request structures frontend code expects and those exposed by API definitions.",
              },
              {
                label: "Response Shape Drift",
                text: "Differences between the response structures frontend code reads and those exposed by API definitions.",
              },
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/route-endpoint",
        title: "Route / Endpoint Drift",
        description:
          "Endpoints referenced by frontend code that differ from backend routes.",
        sections: [
          {
            id: "definition",
            title: "Definition",
            body: [
              "Differences between the endpoints referenced by frontend code and the routes defined by the backend.",
            ],
          },
          {
            id: "detection-details",
            title: "Detection details",
            body: [
              "Placeholder: examples, supported patterns, and limitations for this drift type are not yet documented.",
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/http-method",
        title: "HTTP Method Drift",
        description:
          "HTTP methods expected by frontend calls that differ from backend definitions.",
        sections: [
          {
            id: "definition",
            title: "Definition",
            body: [
              "Inconsistencies between the HTTP methods expected by frontend API calls and those defined by backend endpoints.",
            ],
          },
          {
            id: "detection-details",
            title: "Detection details",
            body: [
              "Placeholder: examples, supported patterns, and limitations for this drift type are not yet documented.",
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/request-shape",
        title: "Request Shape Drift",
        description:
          "Request structures frontend code sends that differ from backend expectations.",
        sections: [
          {
            id: "definition",
            title: "Definition",
            body: [
              "Differences between the request structures frontend code expects to send and those exposed by API definitions.",
            ],
          },
          {
            id: "detection-details",
            title: "Detection details",
            body: [
              "Placeholder: examples, supported patterns, and limitations for this drift type are not yet documented.",
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/response-shape",
        title: "Response Shape Drift",
        description:
          "Response structures frontend code reads that differ from backend definitions.",
        sections: [
          {
            id: "definition",
            title: "Definition",
            body: [
              "Differences between the response structures frontend code reads and those exposed by API definitions.",
            ],
          },
          {
            id: "detection-details",
            title: "Detection details",
            body: [
              "Placeholder: examples, supported patterns, and limitations for this drift type are not yet documented.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "analysis-engine",
    title: "Analysis Engine",
    pages: [
      {
        path: "/docs/analysis-engine",
        title: "Overview",
        description:
          "How the analysis engine turns source code into comparable observations.",
        sections: [
          {
            id: "overview",
            title: "Overview",
            body: [
              "The analysis engine converts frontend and backend source into observations that can be compared. It is designed to remain independent of any editor.",
            ],
            list: [
              {
                label: "Static analysis pipeline",
                text: "Reads source code without running the application.",
              },
              {
                label: "Route and method normalization",
                text: "Puts route and method observations into a comparable form.",
              },
              {
                label: "Shape normalization",
                text: "Puts request and response structure observations into a comparable form.",
              },
              {
                label: "Relationship matching",
                text: "Pairs frontend observations with backend definitions.",
              },
              {
                label: "Finding generation",
                text: "Produces findings with explanations and source-code evidence.",
              },
            ],
          },
        ],
      },
      placeholder(
        "/docs/analysis-engine/static-analysis-pipeline",
        "Static Analysis Pipeline",
        "The stages that read and process source code.",
      ),
      placeholder(
        "/docs/analysis-engine/route-method-normalization",
        "Route and Method Normalization",
        "How routes and HTTP methods are put into a comparable form.",
      ),
      placeholder(
        "/docs/analysis-engine/shape-normalization",
        "Shape Normalization",
        "How request and response structures are put into a comparable form.",
      ),
      placeholder(
        "/docs/analysis-engine/relationship-matching",
        "Relationship Matching",
        "How frontend observations are paired with backend definitions.",
      ),
      placeholder(
        "/docs/analysis-engine/finding-generation",
        "Finding Generation",
        "How findings and their evidence are produced.",
      ),
    ],
  },
  {
    id: "compatibility",
    title: "Compatibility",
    pages: [
      placeholder(
        "/docs/compatibility",
        "Supported Languages",
        "Languages UNDRIFT can analyze. Placeholder until verified.",
      ),
      placeholder(
        "/docs/compatibility/frameworks",
        "Supported Frameworks",
        "Frameworks UNDRIFT recognizes. Placeholder until verified.",
      ),
      placeholder(
        "/docs/compatibility/api-patterns",
        "Supported API Patterns",
        "API definition and call patterns UNDRIFT recognizes. Placeholder until verified.",
      ),
      placeholder(
        "/docs/limitations",
        "Known Limitations",
        "Current limits of the analysis. Placeholder until verified.",
      ),
    ],
  },
  {
    id: "reference",
    title: "Reference",
    pages: [
      placeholder(
        "/docs/reference/configuration",
        "Configuration",
        "Configuration options. Placeholder until verified.",
      ),
      placeholder(
        "/docs/reference/troubleshooting",
        "Troubleshooting",
        "Common problems and how to resolve them.",
      ),
      placeholder(
        "/docs/reference/faq",
        "Frequently Asked Questions",
        "Answers to common questions about UNDRIFT.",
      ),
    ],
  },
];

export const docPages = docGroups.flatMap((group) => group.pages);

export function getDocGroup(path: string) {
  return docGroups.find((group) =>
    group.pages.some((page) => page.path === path),
  );
}

export function getAdjacentDocPages(path: string) {
  const index = docPages.findIndex((page) => page.path === path);
  return {
    previous: index > 0 ? docPages[index - 1] : undefined,
    next:
      index >= 0 && index < docPages.length - 1
        ? docPages[index + 1]
        : undefined,
  };
}
