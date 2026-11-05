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

export interface DocCallout {
  type: "info" | "warning" | "tip" | "note";
  title?: string;
  text: string;
}

export interface DocTable {
  headers: string[];
  rows: string[][];
}

export interface DocSection {
  id: string;
  title: string;
  body: string[];
  callout?: DocCallout;
  list?: DocListItem[];
  table?: DocTable;
  code?: { title: string; source: string };
  codes?: { title: string; source: string }[];
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

export const docGroups: DocGroup[] = [
  {
    id: "overview",
    title: "Overview",
    pages: [
      {
        path: "/docs/introduction",
        title: "Introduction",
        description: "What UNDRIFT is, why it exists, and where it fits into your workflow.",
        sections: [
          {
            id: "what-it-is",
            title: "What UNDRIFT is",
            body: [
              "UNDRIFT is a local-first, IDE-native developer tool that discovers integration contracts between connected parts of an application, detects when those contracts disagree, explains discrepancies using source-linked evidence, and helps developers resolve mismatches directly in their code.",
              "In modern software development, applications frequently cross boundaries: frontend UI components communicate with backend route handlers, microservices exchange requests, and consumers depend on API definitions. Each side of the boundary can appear syntactically valid in isolation while fundamentally disagreeing on route paths, HTTP methods, parameter names, or JSON payload structures.",
              "UNDRIFT brings contract intelligence directly into the developer's normal editing environment. Through continuous background analysis, it surfaces discrepancies as they are introduced, avoiding the delay and expense of runtime debugging.",
            ],
            callout: {
              type: "tip",
              title: "Core Thesis",
              text: "An API integration can be broken even when both the frontend and backend compile without errors. UNDRIFT validates the integration boundary itself, ensuring that what the client expects matches what the server actually provides.",
            },
          },
          {
            id: "core-philosophy",
            title: "Core Philosophy",
            body: [
              "UNDRIFT is designed around five foundational product principles:",
            ],
            list: [
              {
                label: "Local-First Privacy",
                text: "All syntax parsing, contract extraction, candidate matching, and rule evaluation execute entirely on the developer's local machine. Source code is never uploaded to an external service or cloud backend.",
              },
              {
                label: "Static Source Analysis",
                text: "UNDRIFT inspects code without executing it. It does not launch servers, invoke scripts, intercept live network traffic, or require test runtimes to discover contracts.",
              },
              {
                label: "Explain Before Repair",
                text: "Every finding provides source-linked evidence from both sides of the contract, explaining what was expected, what was observed, and why the discrepancy matters before proposing any action.",
              },
              {
                label: "Reports, Not Speculative Repairs",
                text: "UNDRIFT offers safe, reviewable Quick Fixes for mechanical mismatches. It never silently modifies files or applies unreviewed heuristic patches.",
              },
              {
                label: "Continuous Awareness, Controlled Interruption",
                text: "Analysis runs continuously in the background using debounced scheduling and dirty-buffer monitoring. Passive indicators and contextual diagnostics keep developers informed without disruptive modal popups.",
              },
            ],
          },
          {
            id: "what-it-is-not",
            title: "What UNDRIFT is not",
            body: [
              "To maintain a sharp product focus, UNDRIFT establishes clear boundaries regarding what it does not attempt to do in V1:",
            ],
            list: [
              {
                label: "Not an AI Coding Assistant",
                text: "UNDRIFT does not use large language models (LLMs) for contract discovery or routine rule checks. Core detection is 100% deterministic and operates offline without API keys.",
              },
              {
                label: "Not an APM or Runtime Observability Tool",
                text: "UNDRIFT operates at authoring time in the IDE. It does not intercept production HTTP traffic, collect live telemetries, or monitor server logs.",
              },
              {
                label: "Not an Autonomous Refactoring Engine",
                text: "UNDRIFT does not unilaterally rewrite application architecture. Fixes are localized, mechanical, and always subject to developer review and approval.",
              },
              {
                label: "Not an OpenAPI Specification Generator",
                text: "While future versions may ingest API specifications, V1 focuses on direct source-to-source contract alignment between frontend consumers and backend providers.",
              },
            ],
          },
        ],
      },
      {
        path: "/docs/what-is-undrift",
        title: "What is UNDRIFT?",
        description: "The integration boundary problem and the types of drift UNDRIFT detects.",
        sections: [
          {
            id: "the-problem",
            title: "The Integration Boundary Problem",
            body: [
              "Full-stack web applications frequently split contract responsibilities across independent files, directories, or team boundaries. A developer modifying a backend controller might rename a response field without knowing which frontend components consume it. Conversely, a frontend developer might invoke a new endpoint assuming a route format that has not been implemented.",
              "Traditional tooling struggles with this boundary: TypeScript checks types within its local compilation unit, but cannot verify whether an Express route handler actually emits the shape specified in a client-side generic. Linters check syntax and local conventions, but cannot compare cross-file network semantics.",
            ],
          },
          {
            id: "concrete-example",
            title: "A Concrete Mismatch Example",
            body: [
              "Consider a typical React component fetching user details and an Express route serving that endpoint:",
            ],
            codes: [
              {
                title: "Frontend Consumer (src/api/users.ts)",
                source: `export interface UserProfile {
  id: string;
  userName: string; // CamelCase property expected
}

export async function fetchUser(id: string): Promise<UserProfile> {
  const res = await fetch(\`/api/users/\${id}\`);
  return res.json();
}`,
              },
              {
                title: "Backend Provider (src/routes/users.ts)",
                source: `app.get("/api/users/:id", (req, res) => {
  res.json({
    id: req.params.id,
    user_name: "Ada Lovelace", // Snake_case property returned
    status: "active"
  });
});`,
              },
            ],
          },
          {
            id: "how-mismatch-manifests",
            title: "How the Mismatch Manifests",
            body: [
              "In the example above, both files compile without a single TypeScript or ESLint warning. Yet at runtime, the frontend receives an object containing 'user_name', leaving 'userName' as undefined.",
              "Depending on UI rendering logic, this can lead to silent visual bugs (blank titles), runtime TypeError exceptions, broken checkout funnels, or hours spent tracing network tabs in browser developer tools.",
              "UNDRIFT parses both files using WebAssembly Tree-sitter grammars, normalizes their route patterns, extracts their structural shapes, detects the response field discrepancy, and flags it with an inline diagnostic and explanation.",
            ],
          },
          {
            id: "drift-categories",
            title: "Categories of Contract Drift",
            body: [
              "UNDRIFT categorizes integration drift into distinct, well-defined dimensions:",
            ],
            table: {
              headers: ["Drift Category", "Description", "Typical Finding"],
              rows: [
                [
                  "Route / Existence",
                  "A consumer references an endpoint not provided by any backend route in scope, or a provider has no discovered consumer.",
                  "UND100 (Missing Provider), UND110 (Unmapped Provider), UND130 (Suspected Route Mismatch)",
                ],
                [
                  "Protocol / Method",
                  "The consumer and provider agree on the route path but specify conflicting HTTP verbs (e.g. GET vs POST).",
                  "UND120 (HTTP Method Conflict)",
                ],
                [
                  "Request Shape",
                  "The consumer sends a body payload omitting required fields or providing incompatible parameter types.",
                  "UND200 (Missing Required Field), UND210 (Field Type Mismatch), UND220 (Nullability Conflict)",
                ],
                [
                  "Response Shape",
                  "The provider returns a response body lacking expected properties or providing values with incompatible types.",
                  "UND300 (Missing Response Field), UND310 (Response Type Mismatch), UND320 (Optionality Conflict)",
                ],
                [
                  "Analysis Limits",
                  "Dynamic code patterns (runtime URLs, reflection, computed properties) prevent conclusive static validation.",
                  "UND900 (Unsupported Pattern), UND910 (Unresolved Reference), UND920 (Incomplete Scope)",
                ],
              ],
            },
          },
        ],
      },
      {
        path: "/docs/how-it-works",
        title: "How UNDRIFT Works",
        description: "The 10-step analysis pipeline, continuous background monitoring, and debounced event coalescing.",
        sections: [
          {
            id: "pipeline-overview",
            title: "The 10-Step Analysis Pipeline",
            body: [
              "UNDRIFT executes a deterministic, multi-stage analysis pipeline whenever workspace source files are evaluated:",
            ],
            list: [
              {
                label: "1. Workspace Activity",
                text: "The extension monitors file system events (file creation, modification, deletion, renaming) and in-memory editor buffer changes.",
              },
              {
                label: "2. Snapshot Acquisition",
                text: "Dirty in-memory editor documents take priority over on-disk files. A deterministic snapshot hash and generation number are assigned.",
              },
              {
                label: "3. Tree-sitter Parsing",
                text: "Source files are parsed into concrete syntax trees using fast, resilient WebAssembly grammars for JavaScript, TypeScript, JSX, and TSX.",
              },
              {
                label: "4. Contract Extraction",
                text: "Specialized language extractors identify frontend calls (Fetch, Axios) and backend route handlers (Express, Next.js), extracting paths, methods, and shapes.",
              },
              {
                label: "5. Normalization & Matching",
                text: "Routes are canonicalized (parameter tokens, mount prefixes) and structural shapes are normalized into language-neutral definitions.",
              },
              {
                label: "6. Candidate Relationship Pairing",
                text: "Consumer observations are paired with provider observations into candidate relationships (exact, method conflict, suspected route conflict).",
              },
              {
                label: "7. Deterministic Drift Evaluation",
                text: "Compatibility rules run against candidate relationships, evaluating protocol, route, request, and response alignment.",
              },
              {
                label: "8. Guidance & Finding Construction",
                text: "Findings are assembled with source spans, expected/observed comparison data, impact statements, and reviewable fix proposals.",
              },
              {
                label: "9. Session Reconciliation",
                text: "Newly completed results are reconciled against the latest complete snapshot, emitting lifecycle transitions (detected, changed, resolved, reintroduced).",
              },
              {
                label: "10. Workbench Publication",
                text: "Findings are published to editor diagnostics, the Activity Bar badge, the persistent sidebar overview, and the full Integration Report.",
              },
            ],
          },
          {
            id: "pipeline-architecture-diagram",
            title: "Pipeline Architecture",
            body: [
              "The diagram below illustrates how source snapshots flow through the analysis core and reach the VS Code workbench:",
            ],
            code: {
              title: "End-to-End Analysis Workflow",
              source: `┌────────────────────────────────────────────────────────┐
│                   VS Code Workbench                    │
│   Diagnostics · Activity Bar Badge · Sidebar · Report  │
└───────────────────────────▲────────────────────────────┘
                            │ Accepts Validated Result
┌───────────────────────────┴────────────────────────────┐
│                  Analysis Coordinator                  │
│    Generation Tracking · Stale Protection · Scheduler  │
└───────────────────────────▲────────────────────────────┘
                            │ Reconciles Snapshot
┌───────────────────────────┴────────────────────────────┐
│               Language-Neutral Core Engine             │
│   Normalization → Candidate Matching → Drift Rules     │
│       Snapshot Reconciliation & Lifecycle Events       │
└───────────────▲────────────────────────▲───────────────┘
                │ Normalized Facts       │
┌───────────────┴───────────────┐ ┌──────┴───────────────┐
│     Tree-sitter WASM Parser   │ │ Framework Extractors │
│   JS / TS / JSX / TSX Trees   │ │ Fetch, Axios, Express│
└───────────────────────────────┘ └──────────────────────┘`,
            },
          },
          {
            id: "continuous-analysis-loop",
            title: "Continuous Analysis & Debounced Coalescing",
            body: [
              "Unlike tools that require developers to manually invoke a command after every change, UNDRIFT provides continuous live analysis:",
              "1. Startup Scan: Opening a workspace triggers an automatic baseline scan, transitioning the project from 'Last Known Analyzed State' to 'Freshly Verified'.",
              "2. Event Coalescing: Rapid typing produces multiple document-change events. The analysis scheduler coalesces these events into a single execution after a configurable debounce quiet period (default: 800ms).",
              "3. In-Memory Dirty Buffers: The extension inspects unsaved editor text directly. Mismatches are flagged before you save the file.",
              "4. Document Close Reversion: Closing an unsaved file immediately reverts analysis to the on-disk source state.",
              "5. Obsolete Scan Cancellation: If code changes while a scan is running, the active run is superseded, and its outdated output is discarded at the acceptance boundary.",
            ],
            callout: {
              type: "info",
              title: "Race-Safe Execution",
              text: "Every analysis execution carries a strictly increasing generation ID. The workbench accepts results only if their generation matches the latest workspace revision, preventing stale asynchronous scans from overwriting current findings.",
            },
          },
        ],
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    pages: [
      {
        path: "/docs/getting-started/installation",
        title: "Installation & Setup",
        description: "Prerequisites, repository setup, building the extension, and launching the development host.",
        sections: [
          {
            id: "release-status-note",
            title: "Current Release Status",
            body: [
              "UNDRIFT V1 is feature-complete across Phases 1 through 6, with automated regression suites and component-integration acceptance checks passing. Final release preparation is currently in progress.",
              "Because the public VS Code Marketplace release has not yet occurred, developers and contributors evaluate UNDRIFT locally using the VS Code Extension Development Host.",
            ],
            callout: {
              type: "warning",
              title: "Marketplace Notice",
              text: "Direct one-click installation from the VS Code Marketplace will become available upon public launch. Follow the local setup guide below to build and evaluate the extension today.",
            },
          },
          {
            id: "prerequisites",
            title: "Prerequisites",
            body: [
              "Before building UNDRIFT, ensure your development environment satisfies the following requirements:",
            ],
            table: {
              headers: ["Tool", "Required Version", "Recommended Version"],
              rows: [
                ["Node.js", ">= 18.0.0", "v22.x LTS"],
                ["npm", ">= 9.0.0", "v10.x"],
                ["Visual Studio Code", ">= 1.100.0", "Latest Stable"],
                ["Git", ">= 2.30.0", "Latest"],
              ],
            },
          },
          {
            id: "clone-and-build",
            title: "Cloning and Building the Repository",
            body: [
              "UNDRIFT is organized as an npm workspaces monorepo. Clone the repository and run the build workflow:",
            ],
            code: {
              title: "Terminal",
              source: `# 1. Clone the repository
git clone https://github.com/parnilV06/undrift.git
cd undrift

# 2. Install dependencies across all workspaces
npm install

# 3. Build core packages and bundle the extension
npm run build

# 4. Run the full automated test suite (1,058 passing tests)
npm test`,
            },
          },
          {
            id: "launch-extension",
            title: "Launching the Extension Development Host",
            body: [
              "To run the extension in an interactive VS Code instance:",
              "1. Open the repository root in Visual Studio Code (`code .`).",
              "2. Open the Run and Debug view from the Activity Bar (`Ctrl+Shift+D` on Windows/Linux, `Cmd+Shift+D` on macOS).",
              "3. Select 'Launch Extension' from the debug dropdown menu.",
              "4. Press F5. A new 'Extension Development Host' VS Code window will launch with UNDRIFT activated.",
              "5. In the new window, open any JavaScript/TypeScript full-stack project or sample application.",
            ],
            callout: {
              type: "tip",
              title: "Testing Safely",
              text: "When testing live continuous analysis, create or open a disposable synthetic fixture outside the UNDRIFT repository. Do not edit the read-only sample projects under examples/.",
            },
          },
        ],
      },
      {
        path: "/docs/getting-started/quick-start",
        title: "Quick Start Guide",
        description: "A 5-minute hands-on walkthrough demonstrating live continuous drift detection.",
        sections: [
          {
            id: "step-1-open",
            title: "1. Open a Full-Stack Project",
            body: [
              "In the Extension Development Host window, open a workspace that includes both a frontend client (using Fetch or Axios) and a backend server (using Express or Next.js route handlers).",
              "Upon opening, UNDRIFT's startup scan automatically runs in the background. The status bar item at the bottom of the IDE indicates 'UNDRIFT: Ready' or shows the count of existing findings.",
            ],
          },
          {
            id: "step-2-introduce-drift",
            title: "2. Introduce an Intentional Drift",
            body: [
              "Open a frontend file making an API request. For example, change an existing GET request to a POST request:",
            ],
            code: {
              title: "src/api/items.ts (Unsaved Edit)",
              source: `// Change:
// const res = await fetch("/api/items");

// To:
const res = await fetch("/api/items", { method: "POST" });`,
            },
          },
          {
            id: "step-3-observe-live-detection",
            title: "3. Observe Live Drift Detection",
            body: [
              "Without saving the file, pause for 800ms (the default debounce window):",
              "- An error squiggly appears under the fetch call in the editor.",
              "- The Activity Bar badge increments by 1.",
              "- The UNDRIFT Sidebar Overview updates to show 1 active error.",
              "- The Findings Tree displays 'UND120: HTTP method conflict'.",
            ],
          },
          {
            id: "step-4-inspect-finding",
            title: "4. Inspect the Finding",
            body: [
              "Hover over the highlighted line in the editor to view the compact diagnostic hover. It explains that the frontend sends method 'POST' while the backend route in 'src/routes/items.ts' only accepts 'GET'.",
              "Click 'UNDRIFT: Open Integration Report' from the Command Palette or the sidebar to see the full theme-aware report with source links and resolution guidance.",
            ],
          },
          {
            id: "step-5-resolve",
            title: "5. Resolve the Drift",
            body: [
              "Restore the frontend code back to GET (or implement a corresponding 'app.post(\"/api/items\")' route handler in your backend).",
              "Within 800ms, the background analysis re-evaluates the workspace: the diagnostic squiggly disappears, the badge decrements, and the finding is cleared from the sidebar overview.",
            ],
          },
        ],
      },
      {
        path: "/docs/getting-started/first-analysis",
        title: "Interpreting Your First Analysis",
        description: "Understanding workbench presentation states, finding severities, and evidence levels.",
        sections: [
          {
            id: "presentation-states",
            title: "Understanding Presentation States",
            body: [
              "UNDRIFT clearly distinguishes between two temporal states in the UI:",
            ],
            list: [
              {
                label: "Last Known Analyzed State",
                text: "Displayed immediately upon reopening a previously analyzed workspace. It restores findings and historical lifecycle transitions from VS Code workspace storage while fresh background analysis starts.",
              },
              {
                label: "Freshly Verified Current Source",
                text: "Displayed once analysis of the current source code completes. Findings and status indicators reflect the current workspace disk and editor buffer contents.",
              },
            ],
            callout: {
              type: "info",
              title: "Session Continuity",
              text: "When returning to a project after days away, UNDRIFT restores your last known integration report instantly, then reconciles fresh findings against it to highlight what changed while the IDE was closed.",
            },
          },
          {
            id: "severities",
            title: "Finding Severities",
            body: [
              "Findings are assigned one of three severities based on practical operational impact:",
            ],
            table: {
              headers: ["Severity", "Indicator", "Meaning", "Example"],
              rows: [
                ["Error", "Red squiggly / badge", "Definite contract incompatibility that will fail requests at runtime.", "UND120 (Method Conflict), UND300 (Missing Required Response Field)"],
                ["Warning", "Yellow squiggly", "Probable drift or single-segment discrepancy requiring developer review.", "UND100 (No Provider Found), UND130 (Suspected Route Mismatch)"],
                ["Info", "Blue icon / notice", "Informational coverage observation; not an assertion of failure.", "UND110 (Provider with no known consumer in scope)"],
              ],
            },
          },
          {
            id: "evidence-levels",
            title: "Evidence Levels & Confidence",
            body: [
              "UNDRIFT attributes an evidence strength to every extracted observation and finding:",
            ],
            list: [
              {
                label: "Direct",
                text: "Extracted directly from a literal syntax construct (e.g. a string literal '/api/users' or explicit method 'POST').",
              },
              {
                label: "Resolved",
                text: "Traced through supported static declarations, same-document constants, or exported TypeScript types.",
              },
              {
                label: "Inferred",
                text: "Derived through supported heuristic alignment (such as single-segment suspected route mismatch).",
              },
              {
                label: "Unknown / Dynamic",
                text: "The syntax relies on runtime variables or complex wrappers that cannot be statically proven. Classified as an analysis limitation rather than drift.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "concepts",
    title: "Core Concepts",
    pages: [
      {
        path: "/docs/concepts/api-contract-drift",
        title: "API Contract Drift",
        description: "The mechanics of contract divergence and why integration boundaries fail.",
        sections: [
          {
            id: "what-is-drift",
            title: "What is API Contract Drift?",
            body: [
              "API contract drift is the gradual divergence between what an API consumer assumes about an interaction and what the API provider actually implements.",
              "In single-developer projects, drift often happens when a developer modifies a backend controller and forgets to update a component nested deep inside the frontend view tree. In team environments, drift occurs when backend and frontend teams work in separate branches or repositories with incomplete communication. In AI-assisted workflows, code generators frequently produce locally plausible client code that references out-of-date or imagined backend endpoints.",
            ],
          },
          {
            id: "common-causes",
            title: "Common Causes of Drift",
            body: [
              "Static integration failures typically stem from predictable development patterns:",
            ],
            list: [
              {
                label: "Endpoint Renaming",
                text: "Changing '/api/user-profile' to '/api/users/profile' on the backend without refactoring all frontend call sites.",
              },
              {
                label: "HTTP Verb Alterations",
                text: "Switching an endpoint from GET to POST to accept a search query body without updating caller options.",
              },
              {
                label: "Payload Property Reshaping",
                text: "Nesting user fields under a 'data' wrapper or renaming 'postalCode' to 'zip_code'.",
              },
              {
                label: "Optionality & Nullability Shifts",
                text: "Marking a database column as nullable, leading the backend to return null for a property the frontend expects to be a guaranteed string.",
              },
              {
                label: "Orphaned Provider Routes",
                text: "Leaving deprecated route handlers active in backend files after the frontend has migrated to a newer endpoint version.",
              },
            ],
          },
        ],
      },
      {
        path: "/docs/concepts/frontend-api-observations",
        title: "Frontend API Observations",
        description: "How UNDRIFT discovers and extracts consumer contracts from client source code.",
        sections: [
          {
            id: "observation-model",
            title: "The ApiObservation Model",
            body: [
              "An observation is an extracted fact representing an API consumer. It captures:",
              "- Role: Always 'consumer' for client-side API calls.",
              "- Endpoint: Normalized path pattern and observed HTTP method.",
              "- Request Shape: Extracted payload properties, field types, and optionality.",
              "- Expected Response Shape: TypeScript generic type arguments or response body property access.",
              "- Source Spans: Precise UTF-16 character offsets and line/column ranges.",
              "- Provenance: Evidence classification (literal syntax, constant resolution, traceable helper).",
              "- Limitations: Warnings if dynamic arguments or unsupported wrappers were encountered.",
            ],
          },
          {
            id: "supported-patterns",
            title: "Supported Consumer Patterns",
            body: [
              "UNDRIFT extracts observations from standard Fetch API calls and Axios client calls:",
            ],
            codes: [
              {
                title: "Standard Fetch Call",
                source: `// Literal URL, explicit method, static body
fetch("/api/checkout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cartId: "123", express: true })
});`,
              },
              {
                title: "Axios Method Call with Response Generic",
                source: `// Axios post with generic response type
interface OrderConfirmation { orderId: string; total: number; }
const res = await axios.post<OrderConfirmation>("/api/orders", payload);`,
              },
            ],
          },
          {
            id: "constant-resolution",
            title: "Constant & Helper Resolution",
            body: [
              "UNDRIFT resolves same-document constants and statically traceable helper functions:",
            ],
            code: {
              title: "Same-Document Constant",
              source: `const API_ROOT = "/api/v1";
const USERS_PATH = \`\${API_ROOT}/users\`;

// Extracted as normalized route: "/api/v1/users"
fetch(USERS_PATH);`,
            },
          },
        ],
      },
      {
        path: "/docs/concepts/backend-api-definitions",
        title: "Backend API Definitions",
        description: "How UNDRIFT discovers and extracts provider contracts from server source code.",
        sections: [
          {
            id: "provider-model",
            title: "The Provider Observation Model",
            body: [
              "A backend provider observation records the server's public contract definition:",
              "- Role: Always 'provider' for server route registrations.",
              "- Endpoint: Canonical path and registered HTTP method (GET, POST, PUT, PATCH, DELETE).",
              "- Status Codes: Statically declared status codes (e.g. res.status(201)).",
              "- Response Shape: Object literals passed to res.json() or explicit handler return types.",
              "- Mount Prefix Evidence: Composed router prefixes from parent express apps.",
            ],
          },
          {
            id: "express-extraction",
            title: "Express.js Route Extraction",
            body: [
              "UNDRIFT recognizes route registrations on Express applications and Router instances:",
            ],
            code: {
              title: "Express Routes & Mounted Routers",
              source: `import express from "express";
const app = express();
const apiRouter = express.Router();

// Direct app route
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Router method with response shape
apiRouter.post("/users", (req, res) => {
  res.status(201).json({ id: "user_123", created: true });
});

// Mounted prefix composition: effective path is "/api/v1/users"
app.use("/api/v1", apiRouter);`,
            },
          },
          {
            id: "nextjs-extraction",
            title: "Next.js Route Extraction",
            body: [
              "UNDRIFT supports Next.js App Router route handlers (`app/**/route.ts`) and bounded Pages Router API routes (`pages/api/**`):",
            ],
            code: {
              title: "Next.js App Router (app/api/tasks/[id]/route.ts)",
              source: `// Next.js App Router route handler
import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ id: params.id, title: "Sample Task" });
}`,
            },
          },
          {
            id: "no-known-consumer",
            title: "The 'No Known Consumer' Principle",
            body: [
              "When UNDRIFT encounters a backend route that has no corresponding consumer in the analyzed workspace, it flags the route as having **no known consumer in scope** (UND110) rather than calling it 'dead code'.",
              "External consumers, mobile clients, automated tests, third-party webhooks, or dynamic callers may exist outside the scanned workspace. Labeling it as an informational finding respects this scope boundary.",
            ],
          },
        ],
      },
      {
        path: "/docs/concepts/contract-matching",
        title: "Contract Matching",
        description: "Candidate generation, route canonicalization, and structural type comparison.",
        sections: [
          {
            id: "matching-hierarchy",
            title: "Candidate Matching Hierarchy",
            body: [
              "Rather than pairing every frontend route with every similar string, UNDRIFT employs an evidence-first matching hierarchy:",
            ],
            list: [
              {
                label: "1. Exact Match",
                text: "The consumer and provider have the exact same normalized HTTP method and structurally identical route pattern.",
              },
              {
                label: "2. Method Conflict",
                text: "The consumer and provider have the exact same route path, but specify conflicting HTTP verbs (e.g. GET vs POST).",
              },
              {
                label: "3. Suspected Route Mismatch",
                text: "The consumer and provider share the same method, identical segment counts, compatible parameter positions, and differ by exactly one static segment, with unique candidate pairing on both sides.",
              },
              {
                label: "4. Unmatched / Ambiguous",
                text: "No candidate satisfies the conservative matching criteria, preventing weak coincidental pairings from generating false drift findings.",
              },
            ],
          },
          {
            id: "route-normalization",
            title: "Route Normalization Rules",
            body: [
              "Route paths are canonicalized to enable reliable comparison across different framework syntaxes:",
              "- Leading and trailing slashes are normalized consistently (`/api/users/` -> `/api/users`).",
              "- Parameter placeholders are normalized to parameter tokens: Express `:id` and Next.js `[id]` both normalize to `{param}` segments.",
              "- Static segments must match identically; UNDRIFT never applies loose stemmers, singular/plural converters, or heuristic spelling edits.",
            ],
          },
          {
            id: "shape-normalization",
            title: "Shape Normalization Rules",
            body: [
              "Request and response structures are mapped to a language-neutral `TypeShape` model:",
              "- Primitives: `string`, `number`, `boolean`, `null`, `undefined`.",
              "- Objects: Set of named `FieldShape` properties, each tracking type, required/optional presence, and nullability.",
              "- Arrays: Element type shapes with recursive nesting depth limits.",
              "- Unions: Evaluated conservatively across supported member types.",
            ],
            callout: {
              type: "note",
              title: "Presence vs Nullability vs Absence",
              text: "A field omitted from an extracted shape, a field declared optional (`title?: string`), and a field declared nullable (`title: string | null`) are distinct semantic states and are evaluated independently.",
            },
          },
        ],
      },
      {
        path: "/docs/concepts/findings-and-explanations",
        title: "Findings & Explanations",
        description: "Finding data models, evidence attachment, and historical lifecycle transitions.",
        sections: [
          {
            id: "finding-model",
            title: "The Finding Data Model",
            body: [
              "Every finding produced by the rule engine contains complete context:",
              "- `id`: Deterministic finding ID based on rule ID, contract relationship, and affected property.",
              "- `ruleId`: Stable identifier (e.g. `UND100`, `UND120`, `UND300`).",
              "- `category`: `route`, `request-shape`, `response-shape`, `existence`, or `analysis-limit`.",
              "- `severity`: `error`, `warning`, or `info`.",
              "- `sourceLocations`: Exact `SourceSpan` coordinates for both the consumer and provider files.",
              "- `expected` & `observed`: Serialized comparison values.",
              "- `explanation`: Detailed prose describing the conflict, likely impact, and suggested remediation.",
              "- `fixProposals`: Structured, reviewable `FixProposal` edits where mechanical remediation is available.",
            ],
          },
          {
            id: "lifecycle-transitions",
            title: "Finding Lifecycle Transitions",
            body: [
              "Across development sessions, UNDRIFT tracks how findings evolve:",
            ],
            table: {
              headers: ["Transition", "Trigger", "Meaning"],
              rows: [
                ["detected", "First observation", "A finding is observed for the first time in a completed analysis run."],
                ["changed", "Material modification", "An existing finding changes its route, field type, or severity between completed runs."],
                ["resolved", "Absence from complete scan", "A previously active finding is absent from a subsequent complete analysis pass."],
                ["reintroduced", "Regression", "A finding that was previously resolved is detected again in current code."],
              ],
            },
          },
          {
            id: "coverage-gating",
            title: "Coverage Gating & Preventing False Resolutions",
            body: [
              "A critical principle of UNDRIFT's state reconciliation engine is that **absence of evidence is not evidence of resolution**.",
              "If an analysis run fails, is interrupted, or has incomplete coverage due to parse errors in relevant files, the previous complete snapshot is preserved intact. UNDRIFT will never falsely mark a finding as resolved simply because an incomplete scan failed to locate the code.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "drift-types",
    title: "Drift Types",
    pages: [
      {
        path: "/docs/drift-types",
        title: "Drift Types Overview",
        description: "The complete catalog of drift rules, severities, and detection requirements.",
        sections: [
          {
            id: "catalog-overview",
            title: "Rule Catalog Overview",
            body: [
              "UNDRIFT evaluates integration contracts against an explicit catalog of deterministic rules. Each rule has a stable identifier, default severity, and strict evidence requirement:",
            ],
            table: {
              headers: ["Rule ID", "Rule Name", "Category", "Default Severity", "Evidence Requirement"],
              rows: [
                ["UND100", "No compatible provider found", "existence", "Warning", "Known consumer route/method; complete backend scan"],
                ["UND110", "Provider has no known consumer", "existence", "Info", "Known provider route/method; complete frontend scan"],
                ["UND120", "HTTP method conflict", "route", "Error", "Matching route shape with conflicting known methods"],
                ["UND130", "Suspected route mismatch", "route", "Warning", "Conservative unique single-segment route difference"],
                ["UND200", "Required request field not supplied", "request-shape", "Error", "Provider requires field; consumer payload omits it"],
                ["UND210", "Request field type mismatch", "request-shape", "Error", "Known incompatible consumer payload and provider type"],
                ["UND220", "Request nullability conflict", "request-shape", "Warning", "Consumer sends nullable value to non-nullable param"],
                ["UND300", "Provider response lacks expected field", "response-shape", "Error", "Consumer expects field; provider payload omits it"],
                ["UND310", "Response field type mismatch", "response-shape", "Error", "Known incompatible provider response and client type"],
                ["UND320", "Response optionality conflict", "response-shape", "Warning", "Provider may omit field; client expects it present"],
                ["UND330", "Response nullability conflict", "response-shape", "Warning", "Provider may return null; client disallows null"],
                ["UND900", "Unsupported pattern limits analysis", "analysis-limit", "Info", "Extractor encounters an unsupported syntax pattern"],
                ["UND910", "Type reference unresolved", "analysis-limit", "Info", "Imported or complex type declaration unresolvable"],
                ["UND920", "Incomplete scope affects coverage", "analysis-limit", "Warning", "Parse error or exclusion boundary affects analysis"],
              ],
            },
          },
        ],
      },
      {
        path: "/docs/drift-types/route-endpoint",
        title: "Route & Endpoint Drift",
        description: "Rules UND100, UND110, and UND130: Missing providers, unmapped routes, and suspected path typos.",
        sections: [
          {
            id: "und100",
            title: "UND100: No Compatible Provider Found",
            body: [
              "Severity: Warning | Category: existence",
              "Triggered when a frontend API consumer calls a route path that has no matching route handler anywhere in the analyzed backend scope.",
              "Common Causes:",
              "- A frontend call was written before the backend route was created.",
              "- The backend route uses a different URL prefix (e.g. '/api/v1' vs '/api').",
              "- The backend route is registered in a file excluded from workspace analysis.",
            ],
            code: {
              title: "Example UND100 Trigger",
              source: `// Frontend calls /api/notifications
const res = await fetch("/api/notifications");

// Backend only defines:
// app.get("/api/alerts", alertsHandler);
// Finding: UND100 - No compatible provider found for GET /api/notifications`,
            },
          },
          {
            id: "und110",
            title: "UND110: Provider Has No Known Consumer",
            body: [
              "Severity: Info | Category: existence",
              "Triggered when a backend route handler exists, but no consumer in the analyzed frontend scope references it.",
              "Why this is an Informational finding:",
              "This rule does NOT assert that the route is dead or unused. External clients, mobile apps, scheduled webhooks, or dynamic callers may invoke it. It is provided to give developers visibility into exposed endpoints without cluttering the editor with error squigglies.",
            ],
          },
          {
            id: "und130",
            title: "UND130: Suspected Route Mismatch",
            body: [
              "Severity: Warning | Category: route",
              "Triggered when a consumer and provider share the same HTTP method, identical segment counts, compatible parameter positions, and differ by exactly one static segment—and the candidate pairing is unique on both sides.",
            ],
            code: {
              title: "Example UND130 Trigger (Singular vs Plural Typo)",
              source: `// Frontend consumer calls singular:
fetch("/api/user/settings");

// Backend defines plural:
app.get("/api/users/settings", settingsHandler);

// Finding: UND130 - Suspected route mismatch between '/api/user/settings' and '/api/users/settings'`,
            },
          },
        ],
      },
      {
        path: "/docs/drift-types/http-method",
        title: "HTTP Method Drift",
        description: "Rule UND120: Method conflicts where paths match but HTTP verbs disagree.",
        sections: [
          {
            id: "und120",
            title: "UND120: HTTP Method Conflict",
            body: [
              "Severity: Error | Category: route",
              "Triggered when a consumer and provider agree on a unique normalized route path, but specify incompatible HTTP methods.",
              "At runtime, this results in an HTTP 405 Method Not Allowed or HTTP 404 Not Found error, directly failing the user request.",
            ],
            code: {
              title: "Example UND120 Trigger",
              source: `// Frontend sends a POST request with body
fetch("/api/reports", {
  method: "POST",
  body: JSON.stringify(reportData)
});

// Backend route only accepts GET:
app.get("/api/reports", (req, res) => {
  res.json(getAllReports());
});

// Finding: UND120 - HTTP method conflict on '/api/reports' (Frontend: POST, Backend: GET)`,
            },
          },
          {
            id: "resolution-guidance",
            title: "Resolution Guidance",
            body: [
              "To resolve an HTTP method conflict:",
              "1. If the client intended to create or update data, implement the corresponding POST handler on the server.",
              "2. If the client intended to retrieve data, change the frontend method to GET.",
              "3. Review Quick Fix suggestions: if UNDRIFT can safely infer the intended direction, a reviewable code action will be presented.",
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/request-shape",
        title: "Request Shape Drift",
        description: "Rules UND200, UND210, and UND220: Payload structure, missing parameters, and type incompatibilities.",
        sections: [
          {
            id: "request-checking-direction",
            title: "Directional Request Checking",
            body: [
              "When comparing request payloads, the checking direction is: **Consumer supplies, Provider accepts**.",
              "- The consumer must provide all fields marked as required by the provider schema.",
              "- The types sent by the consumer must satisfy the provider's accepted type bounds.",
              "- Additional fields sent by the consumer are permitted unless the provider schema is known to strictly reject extra properties.",
            ],
          },
          {
            id: "und200",
            title: "UND200: Required Request Field Not Supplied",
            body: [
              "Severity: Error | Category: request-shape",
              "Triggered when the backend provider schema requires a property that the consumer's request payload omits.",
            ],
            code: {
              title: "Example UND200 Trigger",
              source: `// Backend schema requires 'organizationId' and 'role'
// req.body: { organizationId: string; role: string; }

// Frontend only sends:
fetch("/api/members", {
  method: "POST",
  body: JSON.stringify({ role: "editor" })
});

// Finding: UND200 - Required request field 'organizationId' missing from payload`,
            },
          },
          {
            id: "und210-und220",
            title: "UND210 & UND220: Type & Nullability Mismatches",
            body: [
              "UND210 (Error): Triggered when a supplied request property has an incompatible primitive type (e.g. sending a string where the server expects a number).",
              "UND220 (Warning): Triggered when a consumer passes a nullable or optional value to a server property declared as strictly non-nullable.",
            ],
          },
        ],
      },
      {
        path: "/docs/drift-types/response-shape",
        title: "Response Shape Drift",
        description: "Rules UND300, UND310, UND320, and UND330: Response body mismatches, missing fields, and type differences.",
        sections: [
          {
            id: "response-checking-direction",
            title: "Directional Response Checking",
            body: [
              "When comparing response payloads, the checking direction is: **Provider returns, Consumer reads**.",
              "- The provider must return all fields that the consumer's response type expects.",
              "- The types returned by the provider must be assignable to the consumer's expected types.",
              "- Additional fields returned by the provider are allowed if the consumer simply ignores them.",
            ],
          },
          {
            id: "und300",
            title: "UND300: Provider Response Lacks Expected Field",
            body: [
              "Severity: Error | Category: response-shape",
              "Triggered when the frontend expects a specific property on the response object, but the provider's returned JSON literal or return type omits that property.",
            ],
            code: {
              title: "Example UND300 Trigger",
              source: `// Frontend expects:
interface UserResponse { id: string; email: string; avatarUrl: string; }
const data = await res.json() as UserResponse;
renderAvatar(data.avatarUrl); // Will crash if avatarUrl is undefined!

// Backend returns:
res.json({
  id: user.id,
  email: user.email
  // avatarUrl is not returned!
});

// Finding: UND300 - Response missing expected field 'avatarUrl'`,
            },
          },
          {
            id: "und310-und330",
            title: "UND310, UND320 & UND330: Response Types, Optionality & Nullability",
            body: [
              "UND310 (Error): The provider returns a type incompatible with the consumer's declared interface (e.g. server returns boolean, client expects string).",
              "UND320 (Warning): The server may conditionally omit a field that the frontend treats as guaranteed to exist.",
              "UND330 (Warning): The server may return null for a property that the frontend expects to be non-null.",
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
        title: "Analysis Engine Overview",
        description: "The core architecture, component separation, and language-neutral domain modeling.",
        sections: [
          {
            id: "engine-architecture",
            title: "Engine Architecture",
            body: [
              "UNDRIFT's analysis engine is completely decoupled from Visual Studio Code and compiler APIs. It exists as independent npm packages:",
              "- `@undrift/core`: Language-neutral domain contracts, normalization logic, candidate matching algorithms, drift rule catalog, explanation builders, and snapshot reconciliation.",
              "- `@undrift/parser-tree-sitter`: Web-Tree-sitter WASM parser adapter, grammar registries, AST facade wrappers, and UTF-16 position mapping.",
              "- `@undrift/analyzer-js-ts`: Concrete JavaScript/TypeScript extractors for Fetch, Axios, Express, and Next.js.",
            ],
            callout: {
              type: "tip",
              title: "Reusable Design",
              text: "Because the core analysis packages do not import 'vscode', the same engine can power CLI commands, Git pre-commit hooks, and CI/CD validation pipelines in future releases without code duplication.",
            },
          },
        ],
      },
      {
        path: "/docs/analysis-engine/static-analysis-pipeline",
        title: "Static Analysis Pipeline",
        description: "Document parsing, symbol indexing, and the lifecycle of an analysis request.",
        sections: [
          {
            id: "pipeline-lifecycle",
            title: "Pipeline Execution Stages",
            body: [
              "When an analysis request is received, the engine executes through strict stages:",
              "1. Document Filtering: Applies workspace exclusions (`node_modules`, `dist`, `.git`) to assemble the active source document list.",
              "2. Parsing: Converts source text into ASTs via Tree-sitter WebAssembly bindings.",
              "3. Declaration Indexing: Extracts local type aliases, interfaces, and same-document constants.",
              "4. Extractor Execution: Runs registered extractors against matching document ASTs.",
              "5. Normalization: Canonicalizes route segments and structural type shapes.",
              "6. Matching: Constructs candidate relationships between consumers and providers.",
              "7. Rule Evaluation: Executes deterministic compatibility rules.",
              "8. Result Assembly: Computes coverage metrics and produces the final `AnalysisResult`.",
            ],
          },
          {
            id: "error-resilience",
            title: "Syntax Error Resilience",
            body: [
              "Developers edit code continuously, meaning source files are frequently in an incomplete, syntactically invalid state.",
              "Because Tree-sitter is an error-tolerant parser designed for code editors, it constructs partial syntax trees even when semicolons, closing brackets, or parameter names are missing.",
              "UNDRIFT's extractors inspect partial trees safely, skipping malformed nodes without crashing or throwing unhandled exceptions.",
            ],
          },
        ],
      },
      {
        path: "/docs/analysis-engine/route-method-normalization",
        title: "Route & Method Normalization",
        description: "Path canonicalization, parameter token substitution, and mount prefix composition.",
        sections: [
          {
            id: "path-normalization",
            title: "Path Normalization Rules",
            body: [
              "The `RouteNormalizer` canonicalizes route paths according to deterministic rules:",
              "1. Surrounding whitespace is trimmed.",
              "2. Duplicate path separators (`//`) are collapsed.",
              "3. Leading slashes are guaranteed (`api/users` -> `/api/users`).",
              "4. Trailing slashes are normalized consistently.",
              "5. Query string parameters (`?page=1`) are isolated from the base route path.",
            ],
          },
          {
            id: "parameter-tokens",
            title: "Parameter Token Substitution",
            body: [
              "Different frameworks represent route parameters differently. Express uses `:id` while Next.js uses `[id]`.",
              "UNDRIFT maps all framework parameter representations to a unified `{param}` placeholder segment during route matching, ensuring that `GET /api/users/:userId` and `fetch('/api/users/' + id)` align seamlessly.",
            ],
          },
          {
            id: "prefix-composition",
            title: "Router Mount Prefix Composition",
            body: [
              "In Express applications, routes are often modularized across nested routers: `app.use('/api/v1', userRouter)`.",
              "UNDRIFT traces router mount prefixes statically, composing the parent mount path with the sub-router route path to determine the final effective endpoint URL.",
            ],
          },
        ],
      },
      {
        path: "/docs/analysis-engine/shape-normalization",
        title: "Shape Normalization",
        description: "Canonical type shapes, presence, optionality, nullability, and naming transformations.",
        sections: [
          {
            id: "type-shapes",
            title: "The TypeShape Abstraction",
            body: [
              "Rather than coupling to TypeScript compiler symbols, shapes are canonicalized into language-neutral `TypeShape` representations:",
              "- Primitive types (`string`, `number`, `boolean`).",
              "- Literal values (`'active'`, `404`).",
              "- Object shapes with dictionary of `FieldShape` properties.",
              "- Array shapes with element type definitions.",
              "- Union types evaluated across all members.",
            ],
          },
          {
            id: "naming-transformations",
            title: "Naming Transformations (Snake vs Camel Case)",
            body: [
              "A frequent source of false positives in API tools is automatically flagging intentional casing transformations as errors.",
              "UNDRIFT does not assume that `user_name` and `userName` are identical. Without an explicit serializer or mapping rule, it reports the structural difference while noting the possible naming transformation, preserving developer clarity.",
            ],
          },
        ],
      },
      {
        path: "/docs/analysis-engine/relationship-matching",
        title: "Relationship Matching",
        description: "Building the candidate relationship graph and conservative pairing algorithms.",
        sections: [
          {
            id: "matching-graph",
            title: "The Candidate Graph",
            body: [
              "Candidate matching pairs consumer observations with provider observations into a `ContractRelationship`:",
              "- MatchKind: `exact`, `method-conflict`, `suspected-route-conflict`, `unmatched`, or `ambiguous`.",
              "- RelationshipState: `matched`, `verified`, `drifted`, `orphaned`, or `unresolved`.",
              "- Evidence: Direct syntax spans, constant resolutions, or framework mount proofs.",
            ],
          },
          {
            id: "conflict-arbitration",
            title: "Conflict Arbitration & Deduplication",
            body: [
              "If a consumer has a strong suspected route mismatch (UND130) with a unique provider, UNDRIFT suppresses the generic 'Missing Provider' (UND100) finding to prevent duplicate notification noise.",
              "Similarly, if an endpoint path matches but methods conflict (UND120), UNDRIFT reports the method conflict directly rather than claiming the endpoint does not exist.",
            ],
          },
        ],
      },
      {
        path: "/docs/analysis-engine/finding-generation",
        title: "Finding Generation",
        description: "Assembling source evidence, generating explanations, and constructing reviewable fix proposals.",
        sections: [
          {
            id: "finding-assembly",
            title: "Finding Assembly",
            body: [
              "Once rules complete evaluation, findings are constructed with rich contextual metadata:",
              "- Headline: One-line concise summary of the conflict.",
              "- Expected vs Observed: Side-by-side comparison of routes, methods, or shape fields.",
              "- Likely Impact: Clear statement of runtime consequences (e.g. 'Frontend will receive undefined for property userName').",
              "- Source Locations: Clickable file spans linking directly to lines in the editor.",
            ],
          },
          {
            id: "fix-proposals",
            title: "Reviewable Fix Proposals",
            body: [
              "Where mechanical remediation is possible, the engine generates a `FixProposal`:",
              "- Structured edit intent with target URI, replacement text, and expected content hash.",
              "- Never applied silently; always surfaced through native VS Code Quick Fix code actions.",
              "- Invalidated automatically if source files are modified before the user approves the edit.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "compatibility",
    title: "Compatibility",
    pages: [
      {
        path: "/docs/compatibility",
        title: "Supported Languages",
        description: "Language grammar support, WebAssembly parsing, and source position mapping.",
        sections: [
          {
            id: "languages-table",
            title: "Language Support Matrix",
            body: [
              "UNDRIFT V1 supports JavaScript and TypeScript across all common modern file extensions:",
            ],
            table: {
              headers: ["Language / Format", "File Extensions", "Grammar Package", "Status"],
              rows: [
                ["JavaScript", ".js, .mjs, .cjs", "tree-sitter-javascript (WASM)", "Supported"],
                ["JavaScript with JSX", ".jsx", "tree-sitter-javascript (WASM)", "Supported"],
                ["TypeScript", ".ts", "tree-sitter-typescript (WASM)", "Supported"],
                ["TypeScript with TSX", ".tsx", "tree-sitter-tsx (WASM)", "Supported"],
              ],
            },
          },
          {
            id: "wasm-runtime",
            title: "WebAssembly Tree-sitter Runtime",
            body: [
              "UNDRIFT utilizes `web-tree-sitter` compiled to WebAssembly. This architecture provides:",
              "- Cross-platform portability without requiring native binary builds or node-gyp compilation.",
              "- Millisecond-level parsing throughput across standard workspace source trees.",
              "- Reliable syntax recovery when editing unfinished or malformed source lines.",
            ],
          },
          {
            id: "position-mapping",
            title: "Position Mapping & Encoding",
            body: [
              "Tree-sitter reports source positions using UTF-8 byte offsets, whereas JavaScript strings and Visual Studio Code APIs use UTF-16 code units.",
              "UNDRIFT includes a tested position mapping layer (`PositionMapper`) that converts between byte offsets and UTF-16 line/column coordinates, correctly handling CRLF/LF line endings and multi-byte Unicode characters.",
            ],
          },
        ],
      },
      {
        path: "/docs/compatibility/frameworks",
        title: "Supported Frameworks",
        description: "Express.js and Next.js route extraction, client libraries, and future framework roadmap.",
        sections: [
          {
            id: "framework-matrix",
            title: "Framework Support Matrix",
            body: [
              "The table below details current framework extraction coverage in UNDRIFT V1:",
            ],
            table: {
              headers: ["Framework / Library", "Role", "Patterns Recognized", "Status"],
              rows: [
                ["Express.js", "Provider", "app.<method>, router.<method>, mounted router prefixes, res.json()", "Supported"],
                ["Next.js App Router", "Provider", "app/**/route.ts HTTP handlers (GET, POST, etc.) with dynamic segments", "Supported (Bounded)"],
                ["Next.js Pages Router", "Provider", "pages/api/** API route handlers with status and response shapes", "Supported (Bounded)"],
                ["Standard Fetch API", "Consumer", "fetch(url), fetch(url, options), JSON body parsing, constants", "Supported"],
                ["Axios", "Consumer", "axios.get/post/put/delete, response generics, request payloads", "Supported"],
                ["Fastify / NestJS", "Provider", "Decorators, dependency injection controllers, plugin encapsulation", "Deferred (Post-V1)"],
                ["Django / Flask / Go", "Provider", "Python and Go backend web frameworks", "Deferred (Post-V1)"],
                ["Prisma / Database", "Schema", "ORM models and database migration schemas", "Deferred (Post-V1)"],
              ],
            },
          },
        ],
      },
      {
        path: "/docs/compatibility/api-patterns",
        title: "Supported API Patterns",
        description: "Exact syntax patterns recognized by consumer and provider extractors.",
        sections: [
          {
            id: "consumer-patterns",
            title: "Consumer Code Patterns",
            body: [
              "The following consumer patterns are recognized deterministically:",
            ],
            code: {
              title: "Supported Client Call Examples",
              source: `// 1. Literal fetch GET
fetch("/api/projects");

// 2. Fetch with options object
fetch("/api/projects", {
  method: "POST",
  body: JSON.stringify({ name: "New Project" })
});

// 3. Axios method calls
axios.get("/api/projects");
axios.post("/api/projects", { name: "New Project" });

// 4. Same-document constant reference
const ENDPOINT = "/api/v1/status";
fetch(ENDPOINT);`,
            },
          },
          {
            id: "provider-patterns",
            title: "Provider Code Patterns",
            body: [
              "The following provider patterns are recognized deterministically:",
            ],
            code: {
              title: "Supported Server Route Examples",
              source: `// 1. Express app route
app.get("/api/users", (req, res) => res.json(users));

// 2. Express router route
router.post("/api/users", (req, res) => res.status(201).json(newUser));

// 3. Mounted router prefix
const router = express.Router();
router.get("/profile", handler);
app.use("/api/account", router); // Composes to /api/account/profile

// 4. Next.js App Router route handler (app/api/auth/route.ts)
export async function POST(req: Request) {
  return NextResponse.json({ authenticated: true });
}`,
            },
          },
        ],
      },
      {
        path: "/docs/limitations",
        title: "Known Limitations",
        description: "Current static analysis boundaries, unsupported constructs, and conservative inference rules.",
        sections: [
          {
            id: "static-boundaries",
            title: "Static Analysis Boundaries",
            body: [
              "Because UNDRIFT does not execute application code or launch a server, certain dynamic programming constructs cannot be statically inferred:",
              "- Runtime-Constructed URLs: URLs generated from environment variables (`fetch(process.env.API_URL + '/items')`) or calculated via runtime helper functions cannot be resolved.",
              "- Dynamic Method Dispatch: Computed property access for HTTP verbs (`const method = req.query.action; api[method]('/endpoint')`).",
              "- Complex Wrapper Abstractions: Deeply nested, generic API client abstractions with dynamic interceptors.",
              "- Reflection and Metaprogramming: Endpoints dynamically registered via runtime reflection or loop iteration.",
            ],
            callout: {
              type: "warning",
              title: "How UNDRIFT Handles Ambiguity",
              text: "When the analysis engine encounters a dynamic or unsupported pattern, it generates an informational Analysis Warning (UND900 / UND910) rather than guessing or asserting a false drift finding.",
            },
          },
          {
            id: "scope-boundaries",
            title: "Scope & Architectural Boundaries",
            body: [
              "- Single Workspace Scope: V1 analyzes code contained within the opened VS Code workspace folders. External microservices in un-opened repositories are not visible.",
              "- Third-Party APIs: External public APIs (Stripe, GitHub, Twilio) have no backend source in your workspace. Their calls will appear as unmapped consumers (UND100) unless suppressed via configuration.",
              "- Database Schema Verification: Direct validation against database tables (PostgreSQL, MongoDB) or ORMs (Prisma, TypeORM) is planned for future milestones beyond V1.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "reference",
    title: "Reference",
    pages: [
      {
        path: "/docs/reference/vscode-extension",
        title: "VS Code Extension Experience",
        description: "Activity Bar integration, sidebar overview, diagnostics, report webview, and official brand identity.",
        sections: [
          {
            id: "activity-bar",
            title: "Activity Bar & Official Brand Identity",
            body: [
              "UNDRIFT integrates into Visual Studio Code with a dedicated Activity Bar container featuring the official brand logo—a sweeping curved arrow with particle dispersion.",
              "A dynamic badge on the Activity Bar icon displays the current count of active drift findings, updating in real time as files are edited.",
            ],
          },
          {
            id: "sidebar-overview",
            title: "Sidebar Overview & Findings Tree",
            body: [
              "Clicking the UNDRIFT Activity Bar icon opens the sidebar view:",
              "- Status Banner: Displays whether the current view reflects 'Freshly Verified' source or 'Last Known Analyzed State' with scan timestamp.",
              "- Metric Counters: Summary cards showing total active findings grouped by severity (Errors, Warnings, Info).",
              "- Findings Tree: Navigable list of all active discrepancies. Clicking any finding navigates directly to the primary source code line in the editor.",
            ],
          },
          {
            id: "editor-diagnostics",
            title: "Editor Diagnostics & Hovers",
            body: [
              "Findings are published as native VS Code editor diagnostics:",
              "- Errors appear as red squiggly underlines on the exact affected code token.",
              "- Hovering over the diagnostic displays a compact explanation showing expected values, observed server definitions, and recommended next steps.",
              "- Quick Fix code actions (`Ctrl+.` or `Cmd+.`) offer reviewable mechanical repairs.",
            ],
          },
          {
            id: "integration-report",
            title: "Integration Report Webview",
            body: [
              "Running the 'UNDRIFT: Open Integration Report' command launches a dedicated editor webview panel:",
              "- Fully theme-aware: Adapts dynamically to light, dark, and high-contrast VS Code themes using native CSS variables.",
              "- Findings Matrix: Comprehensive table with expandable rows showing full evidence, expected vs observed payloads, and suggested fixes.",
              "- Coverage Summary: Transparency into scanned files, parse warnings, and unsupported constructs.",
            ],
          },
        ],
      },
      {
        path: "/docs/reference/configuration",
        title: "Configuration & Settings",
        description: "VS Code extension settings, default exclusions, and command palette actions.",
        sections: [
          {
            id: "settings-table",
            title: "Extension Settings",
            body: [
              "UNDRIFT settings can be configured in your User or Workspace `settings.json` under the `undrift.analysis` namespace:",
            ],
            table: {
              headers: ["Setting", "Type", "Default", "Description"],
              rows: [
                ["undrift.analysis.autoRun", "boolean", "true", "Enables or disables automatic background analysis on workspace changes."],
                ["undrift.analysis.debounceMs", "number", "800", "Debounce delay in milliseconds before background re-analysis runs (100–5000ms)."],
                ["undrift.analysis.runOnStartup", "boolean", "true", "Automatically analyzes the workspace upon opening."],
              ],
            },
            code: {
              title: ".vscode/settings.json",
              source: `{
  "undrift.analysis.autoRun": true,
  "undrift.analysis.debounceMs": 800,
  "undrift.analysis.runOnStartup": true
}`,
            },
          },
          {
            id: "default-exclusions",
            title: "Default Workspace Exclusions",
            body: [
              "To maintain fast analysis and prevent scanning build artifacts, UNDRIFT automatically excludes common dependency and output folders:",
              "- `node_modules`, `.git`, `.svn`, `.hg`",
              "- `dist`, `build`, `out`, `target`",
              "- `.next`, `.nuxt`, `.svelte-kit`, `.cache`",
              "- `coverage`, `.nyc_output`",
              "- Minified files (`*.min.js`, `*.min.mjs`)",
            ],
          },
          {
            id: "commands-palette",
            title: "Command Palette Actions",
            body: [
              "The following commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):",
            ],
            table: {
              headers: ["Command Title", "Identifier", "Purpose"],
              rows: [
                ["UNDRIFT: Scan Workspace", "undrift.scanWorkspace", "Triggers an immediate manual scan of the open workspace."],
                ["UNDRIFT: Refresh Findings", "undrift.refresh", "Re-analyzes current source and refreshes all UI views."],
                ["UNDRIFT: Open Integration Report", "undrift.openReport", "Opens the full-screen theme-aware Integration Report webview."],
                ["UNDRIFT: Clear In-Memory Cache", "undrift.clearCache", "Clears ephemeral in-memory state caches without erasing history."],
                ["UNDRIFT: Reset Drift History", "undrift.resetHistory", "Resets historical finding lifecycle timeline records in storage."],
              ],
            },
          },
        ],
      },
      {
        path: "/docs/reference/architecture",
        title: "System Architecture",
        description: "Monorepo layout, dependency rules, workspace storage persistence, and separation of authority.",
        sections: [
          {
            id: "monorepo-layout",
            title: "Monorepo Package Structure",
            body: [
              "UNDRIFT is organized as an npm workspaces monorepo with strict architectural boundaries:",
            ],
            table: {
              headers: ["Package", "Directory", "Responsibilities", "Dependencies"],
              rows: [
                ["undrift-vscode", "apps/vscode-extension", "VS Code extension host, diagnostics, views, webview panel, storage adapter", "@undrift/core, @undrift/parser-tree-sitter, @undrift/analyzer-js-ts, vscode"],
                ["@undrift/core", "packages/core", "Domain models, candidate matching, drift rules, guidance, state reconciliation", "TypeScript standard library only (No external dependencies)"],
                ["@undrift/parser-tree-sitter", "packages/parser-tree-sitter", "Tree-sitter WASM runtime, grammar loading, AST facade, position mapping", "web-tree-sitter"],
                ["@undrift/analyzer-js-ts", "packages/analyzer-js-ts", "JS/TS extractors for Fetch, Axios, Express, and Next.js route handlers", "@undrift/core, @undrift/parser-tree-sitter"],
              ],
            },
          },
          {
            id: "dependency-rules",
            title: "Strict Dependency Direction",
            body: [
              "To preserve modularity and enable future CLI and CI integrations:",
              "1. `packages/core` MUST NEVER import `vscode`, `web-tree-sitter`, Express, or compiler APIs.",
              "2. All communication between the extension host and analysis core occurs through typed domain ports.",
              "3. UI views receive normalized report models; they never walk syntax trees or implement contract logic.",
            ],
          },
          {
            id: "persistence-architecture",
            title: "Workspace Storage & Privacy",
            body: [
              "UNDRIFT stores persistent snapshots and lifecycle events using VS Code-managed workspace storage (`ExtensionContext.storageUri`):",
              "- Storage is isolated per workspace and stored in VS Code's application support directory on your local machine.",
              "- Storage MUST NOT write history to the user's project repository (`.undrift/`).",
              "- No external database (no SQLite, no remote database) and no cloud telemetry.",
              "- Writes are crash-safe and recoverable using temporary-file-and-rename mechanics.",
            ],
          },
        ],
      },
      {
        path: "/docs/reference/contributing",
        title: "Development & Contributing",
        description: "Contributor guidelines, automated quality checks, and how to implement new extractors.",
        sections: [
          {
            id: "dev-workflow",
            title: "Developer Workflow & Scripts",
            body: [
              "All development tasks are orchestrated through standard npm scripts at the root of the repository:",
            ],
            code: {
              title: "Monorepo Commands",
              source: `# Build all packages and extension
npm run build

# Run type checking across all workspaces (TypeScript strict mode)
npm run typecheck

# Run unit and integration tests via Vitest (1,058 tests)
npm test

# Run ESLint quality checks
npm run lint

# Check source formatting
npm run format:check`,
            },
          },
          {
            id: "quality-thresholds",
            title: "Automated Quality Thresholds",
            body: [
              "Every pull request must maintain the project's zero-regression baseline:",
              "- 1,058 passing tests across 58 test files.",
              "- Zero TypeScript compiler errors with strict type checking enabled.",
              "- Zero ESLint errors and warnings.",
              "- All sample projects under `examples/` must remain completely unmodified.",
            ],
          },
          {
            id: "adding-an-extractor",
            title: "Adding a New Framework Extractor",
            body: [
              "To add support for a new library or framework pattern:",
              "1. Define the supported syntax pattern in `packages/analyzer-js-ts/src/support-matrix.ts`.",
              "2. Implement an extractor class conforming to the analyzer port, producing normalized `ApiObservation` records.",
              "3. Add unit test fixtures covering both valid integrations and intentional mismatches.",
              "4. Run `npm test` and verify that normalization and candidate matching succeed.",
            ],
          },
        ],
      },
      {
        path: "/docs/reference/roadmap",
        title: "Roadmap & Release Status",
        description: "The six completed engineering phases, current V1 release checklist, and future AI layer scope.",
        sections: [
          {
            id: "completed-phases",
            title: "Completed V1 Engineering Phases",
            body: [
              "UNDRIFT V1 was developed through six comprehensive implementation phases:",
            ],
            table: {
              headers: ["Phase", "Milestone", "Core Deliverables"],
              rows: [
                ["Phase 1", "Workspace & Parser Foundation", "Tree-sitter WASM runtime, grammar registries, UTF-16 position mapping, snapshot hashing."],
                ["Phase 2", "Analyzer Contracts & Extractors", "Fetch, Axios, Express extractors, constant indexing, language-neutral observation model."],
                ["Phase 3", "Normalization & Candidate Matching", "Route normalizer, parameter alignment, shape normalizer, candidate graph matcher."],
                ["Phase 4", "Drift Rules & Explanations", "Deterministic rule catalog (UND100–UND330), directional checking, reviewable Quick Fixes."],
                ["Phase 5", "Persistence & State Reconciliation", "Workspace storage adapter, snapshot-to-snapshot reconciliation, finding lifecycle events."],
                ["Phase 6", "Workbench Integration & Live Analysis", "Activity Bar container, brand logo, sidebar overview, continuous debounced analysis, dirty buffer monitoring."],
              ],
            },
          },
          {
            id: "release-checklist",
            title: "Release Preparation Status (November 2026)",
            body: [
              "The current project status represents the final release preparation stage:",
              "- V1 Feature Implementation: Complete across all 6 phases.",
              "- Automated Regression & Integration Tests: 1,058 passing tests across 58 test files.",
              "- Final Live IDE Acceptance Pass: Pending final validation in Extension Development Host.",
              "- GitHub Release & Repository Tag: Pending.",
              "- VS Code Marketplace Package & Publication: Pending.",
              "- Public Landing Page Deployment: In progress.",
            ],
          },
          {
            id: "future-ai-layer",
            title: "Future AI Resolution Layer (Phase 7)",
            body: [
              "UNDRIFT maintains a strict boundary between V1 and future capabilities:",
              "- In V1: All analysis, drift detection, and Quick Fix proposals are 100% deterministic, rule-based, local, and offline.",
              "- In Phase 7 (Post-V1): An optional AI Resolution Layer will be explored to generate multi-file patch proposals for complex, non-mechanical architectural refactorings. This will remain an opt-in capability and will not replace the deterministic core.",
            ],
          },
        ],
      },
      {
        path: "/docs/reference/troubleshooting",
        title: "Troubleshooting Guide",
        description: "Resolving common issues, understanding coverage warnings, and tuning performance.",
        sections: [
          {
            id: "coverage-warnings",
            title: "Understanding Coverage Warnings",
            body: [
              "If you see an informational warning in your report:",
              "- `UND900 (Unsupported Pattern)`: An API call or route definition used dynamic expressions that cannot be statically traced. Consider using a string literal or same-file constant.",
              "- `UND910 (Unresolved Reference)`: A TypeScript interface or type was imported from an external library or unresolvable path. Inline or export the type locally.",
              "- `UND920 (Incomplete Scope)`: A file in the workspace had syntax errors preventing full analysis. Fix local syntax errors to restore full coverage.",
            ],
          },
          {
            id: "debounce-tuning",
            title: "Tuning Analysis Performance",
            body: [
              "If background analysis feels sluggish on very large codebases, increase the debounce delay in your settings:",
              "Set `\"undrift.analysis.debounceMs\": 1500` to allow longer typing quiet periods before re-analysis runs.",
            ],
          },
          {
            id: "resetting-state",
            title: "Resetting Cache & History",
            body: [
              "If you ever need to clear persisted state:",
              "- Run `UNDRIFT: Clear In-Memory Cache` to purge active in-memory cached state.",
              "- Run `UNDRIFT: Reset Drift History` to clear historical finding lifecycle records in workspace storage without affecting current source files.",
            ],
          },
        ],
      },
      {
        path: "/docs/reference/faq",
        title: "Frequently Asked Questions",
        description: "Common questions about privacy, architecture, runtime overhead, and tooling comparisons.",
        sections: [
          {
            id: "faq-list",
            title: "General Questions",
            body: ["Answers to the most common questions about UNDRIFT:"],
            list: [
              {
                label: "Does UNDRIFT run or execute my application code?",
                text: "No. UNDRIFT performs pure static analysis by parsing source code with Tree-sitter. It never invokes node scripts, starts development servers, or runs tests.",
              },
              {
                label: "Does any of my source code leave my machine?",
                text: "No. UNDRIFT is 100% local-first. All parsing, extraction, and drift evaluation run locally in your IDE's extension host. No source code or telemetry is transmitted externally.",
              },
              {
                label: "Does UNDRIFT require an AI model, API key, or cloud account?",
                text: "No. The core analysis engine is completely deterministic and offline. It does not require OpenAI, Anthropic, Gemini, or any external API key.",
              },
              {
                label: "How does UNDRIFT compare to TypeScript?",
                text: "TypeScript validates types within its local compilation boundaries. However, a frontend TypeScript file cannot know what an Express route actually returns at runtime. UNDRIFT connects the two sides across the network boundary.",
              },
              {
                label: "How does UNDRIFT compare to contract testing tools (like Pact)?",
                text: "Pact requires writing and maintaining explicit contract test suites and running a mock broker. UNDRIFT discovers contracts automatically from existing source code as you type, requiring zero manually written contract test boilerplate.",
              },
              {
                label: "Will UNDRIFT silently modify my code?",
                text: "Never. UNDRIFT only generates reviewable Quick Fix proposals. You must explicitly review and accept an edit through VS Code before any file is changed.",
              },
              {
                label: "What happens if I make a typo while editing?",
                text: "The analysis scheduler coalesces typing bursts using an 800ms debounce window. Tree-sitter's error resilience handles incomplete syntax gracefully without throwing unhandled exceptions.",
              },
              {
                label: "Can UNDRIFT be used in monorepos?",
                text: "Yes. UNDRIFT is designed specifically for workspaces containing both frontend (React, Next.js) and backend (Express, Next.js route handlers) packages.",
              },
              {
                label: "Why does UNDRIFT say 'No known consumer' instead of 'Unused route'?",
                text: "Because external consumers, mobile apps, or third-party webhooks may call the endpoint from outside the opened workspace. UNDRIFT respects this scope boundary and avoids making false assertions.",
              },
              {
                label: "When will the VS Code Marketplace release happen?",
                text: "V1 feature implementation is complete and passing all quality checks. The extension is currently undergoing final release packaging and validation ahead of public distribution.",
              },
            ],
          },
        ],
      },
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
