# UNDRIFT — Low-Level Design (LLD)

**Document:** LLD.md  
**Project:** UNDRIFT  
**Version:** 0.1 — Hackathon MVP  
**Status:** Implementation-level design  
**Primary Runtime:** Node.js + TypeScript  
**Primary IDE:** VS Code  
**Primary Supported Stack:** React + TypeScript + Node.js/Express + TypeScript  
**Optional Database Awareness:** Prisma schema

---

# 1. Purpose

This document defines the low-level implementation design for UNDRIFT.

The LLD translates the PRD, TRD, and HLD into concrete implementation units including:

- package and module responsibilities;
- domain interfaces and types;
- source extraction strategies;
- AST traversal behavior;
- contract normalization;
- route and schema matching;
- drift rules;
- state transitions;
- fix proposal representation;
- VS Code provider behavior;
- live analysis orchestration;
- caching;
- error handling;
- testing fixtures;
- implementation sequencing.

The LLD is intentionally implementation-oriented. Exact code may evolve during the hackathon, but the module boundaries and domain contracts should remain stable unless a technical issue requires redesign.

---

# 2. Implementation Boundary

UNDRIFT is composed of three executable/application surfaces:

```text
apps/
├── vscode-extension
└── cli

packages/
└── core
```

The dependency direction is:

```text
                    ┌────────────────────┐
                    │    @undrift/core   │
                    └─────────┬──────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
                  ▼                       ▼
        VS Code Extension               CLI
```

The extension and CLI consume Core.

Core never imports VS Code-specific APIs.

---

# 3. Recommended Package Structure

```text
undrift/
│
├── apps/
│   │
│   ├── vscode-extension/
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── analyzeWorkspace.ts
│   │   │   │   ├── showReport.ts
│   │   │   │   ├── refresh.ts
│   │   │   │   └── verifyCurrentFile.ts
│   │   │   │
│   │   │   ├── providers/
│   │   │   │   ├── diagnosticProvider.ts
│   │   │   │   ├── hoverProvider.ts
│   │   │   │   ├── codeActionProvider.ts
│   │   │   │   └── inlineCompletionProvider.ts
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── coreService.ts
│   │   │   │   ├── workspaceService.ts
│   │   │   │   ├── analysisCoordinator.ts
│   │   │   │   └── editService.ts
│   │   │   │
│   │   │   ├── views/
│   │   │   │   ├── undriftTreeProvider.ts
│   │   │   │   └── reportPanel.ts
│   │   │   │
│   │   │   ├── utils/
│   │   │   ├── extension.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── media/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/
│       ├── src/
│       │   ├── commands/
│       │   ├── formatters/
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   └── core/
│       ├── src/
│       │   ├── contracts/
│       │   │   ├── contract.ts
│       │   │   ├── schemas.ts
│       │   │   ├── field.ts
│       │   │   └── states.ts
│       │   │
│       │   ├── extractors/
│       │   │   ├── base/
│       │   │   ├── frontend/
│       │   │   ├── backend/
│       │   │   └── prisma/
│       │   │
│       │   ├── parser/
│       │   │   ├── project.ts
│       │   │   ├── source.ts
│       │   │   └── typeResolver.ts
│       │   │
│       │   ├── normalizer/
│       │   │   ├── pathNormalizer.ts
│       │   │   ├── typeNormalizer.ts
│       │   │   └── schemaNormalizer.ts
│       │   │
│       │   ├── matcher/
│       │   │   ├── routeMatcher.ts
│       │   │   ├── requestMatcher.ts
│       │   │   ├── responseMatcher.ts
│       │   │   ├── fieldMatcher.ts
│       │   │   └── contractMatcher.ts
│       │   │
│       │   ├── graph/
│       │   │   ├── graph.ts
│       │   │   ├── nodes.ts
│       │   │   └── edges.ts
│       │   │
│       │   ├── drift/
│       │   │   ├── drift.ts
│       │   │   ├── detectors/
│       │   │   └── severity.ts
│       │   │
│       │   ├── fixes/
│       │   │   ├── fix.ts
│       │   │   ├── fixBuilder.ts
│       │   │   └── fixRules.ts
│       │   │
│       │   ├── semantic/
│       │   │   ├── semanticResolver.ts
│       │   │   └── heuristicResolver.ts
│       │   │
│       │   ├── workspace/
│       │   │   ├── workspaceState.ts
│       │   │   ├── changeSet.ts
│       │   │   └── revision.ts
│       │   │
│       │   ├── store/
│       │   │   ├── contractStore.ts
│       │   │   ├── sourceStore.ts
│       │   │   └── graphStore.ts
│       │   │
│       │   ├── engine/
│       │   │   ├── engine.ts
│       │   │   └── coordinator.ts
│       │   │
│       │   ├── reporting/
│       │   │   └── reportBuilder.ts
│       │   │
│       │   └── index.ts
│       │
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   └── ecommerce-demo/
│
├── tests/
│   ├── fixtures/
│   └── scenarios/
│
├── docs/
├── package.json
└── tsconfig.base.json
```

The exact folder names can be simplified during implementation, but the logical module boundaries should be preserved.

---

# 4. Domain Model

The domain model is the most important shared contract between all Core modules.

---

# 5. Primitive Domain Types

```ts
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";
```

Source location:

```ts
export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}
```

Source reference:

```ts
export interface SourceReference {
  location: SourceLocation;
  symbol?: string;
  kind?: string;
}
```

---

# 6. Type Representation

Avoid storing raw TypeScript type syntax everywhere.

Use a normalized representation.

```ts
export type NormalizedType =
  | {
      kind: "primitive";
      name:
        | "string"
        | "number"
        | "boolean"
        | "bigint"
        | "null"
        | "undefined"
        | "unknown";
    }
  | {
      kind: "array";
      element: NormalizedType;
    }
  | {
      kind: "object";
      name?: string;
      fields: Record<string, FieldDefinition>;
    }
  | {
      kind: "union";
      members: NormalizedType[];
    }
  | {
      kind: "reference";
      name: string;
      resolved?: NormalizedType;
    }
  | {
      kind: "unknown";
      raw?: string;
    };
```

This allows the matcher to compare types without coupling itself to AST syntax.

---

# 7. Field Definition

```ts
export interface FieldDefinition {
  name: string;
  type: NormalizedType;

  optional: boolean;
  nullable: boolean;

  source?: SourceLocation;
}
```

Example:

```text
userName
type: string
optional: false
nullable: false
```

---

# 8. Object Schema

```ts
export interface ObjectSchema {
  kind: "object";
  name?: string;

  fields: FieldDefinition[];

  source?: SourceLocation;
}
```

Nested objects are represented recursively.

---

# 9. Request Contract

```ts
export interface RequestContract {
  pathParams: FieldDefinition[];
  queryParams: FieldDefinition[];
  headers: FieldDefinition[];

  body?: ObjectSchema;
}
```

---

# 10. Response Contract

```ts
export interface ResponseContract {
  statusCode?: number;

  body?: ObjectSchema;
}
```

For the MVP, one primary response shape may be represented for each API relationship.

Future versions may support multiple status-code-specific schemas.

---

# 11. Consumer Contract

```ts
export interface ConsumerContract {
  id: string;

  method: HttpMethod;
  path: string;

  request?: RequestContract;
  response?: ResponseContract;

  source: SourceReference;

  extractor: string;
}
```

Example:

```json
{
  "method": "GET",
  "path": "/users/:id",
  "response": {
    "body": {
      "fields": {
        "id": "string",
        "userName": "string",
        "email": "string"
      }
    }
  }
}
```

---

# 12. Provider Contract

```ts
export interface ProviderContract {
  id: string;

  method: HttpMethod;
  path: string;

  request?: RequestContract;
  response?: ResponseContract;

  source: SourceReference;

  extractor: string;
}
```

Consumer and provider structures are deliberately similar so they can be normalized and compared.

---

# 13. Contract Entity

The matched logical entity combines observations.

```ts
export type ContractState =
  | "discovered"
  | "waiting"
  | "matched"
  | "verified"
  | "drifted"
  | "repaired"
  | "orphaned";

export interface ApiContract {
  id: string;

  method: HttpMethod;
  path: string;

  consumer?: ConsumerContract;
  provider?: ProviderContract;

  request?: RequestContract;
  response?: ResponseContract;

  state: ContractState;

  match?: MatchResult;

  drifts: string[];

  createdAt: number;
  updatedAt: number;
}
```

---

# 14. Contract Identity

Contract IDs should be stable across re-analysis whenever the same source relationship can be identified.

Initial deterministic identity:

```text
<method>:<normalized-path>:<consumer/provider role>
```

Example:

```text
consumer:GET:/users/:id
provider:GET:/users/:id
```

Where collisions are possible, append a stable source-derived hash.

The ID must not depend only on array position.

---

# 15. Match Result

```ts
export interface MatchResult {
  matched: boolean;

  score: number;

  reasons: string[];

  routeScore?: number;
  requestScore?: number;
  responseScore?: number;
}
```

The score is an internal confidence value.

---

# 16. Drift Domain Model

```ts
export type DriftType =
  | "missing-endpoint"
  | "orphan-endpoint"
  | "route-mismatch"
  | "method-mismatch"
  | "request-mismatch"
  | "response-mismatch"
  | "type-mismatch"
  | "nullability-mismatch"
  | "semantic-mismatch";

export type DriftSeverity =
  | "critical"
  | "warning"
  | "info";
```

Drift entity:

```ts
export interface Drift {
  id: string;

  contractId: string;

  type: DriftType;
  severity: DriftSeverity;

  title: string;
  message: string;
  explanation: string;

  expected?: unknown;
  actual?: unknown;

  locations: SourceLocation[];

  confidence?: number;

  fixIds: string[];

  createdAt: number;
  updatedAt: number;
}
```

---

# 17. Fix Model

Core returns structured edits.

```ts
export interface FileEdit {
  file: string;

  startLine: number;
  startColumn: number;

  endLine: number;
  endColumn: number;

  replacement: string;
}
```

Fix proposal:

```ts
export interface FixProposal {
  id: string;

  driftId: string;

  title: string;
  description: string;

  confidence: number;

  edits: FileEdit[];

  risk:
    | "safe"
    | "review"
    | "manual";

  affectedFiles: string[];
}
```

---

# 18. Analysis Result

```ts
export interface AnalysisResult {
  revision: number;

  contracts: ApiContract[];
  drifts: Drift[];

  graph: ContractGraph;

  statistics: AnalysisStatistics;

  warnings: AnalysisWarning[];

  timestamp: number;
}
```

---

# 19. Analysis Statistics

```ts
export interface AnalysisStatistics {
  filesAnalyzed: number;
  contractsDiscovered: number;

  verified: number;
  drifted: number;
  waiting: number;
  orphaned: number;

  durationMs: number;
}
```

---

# 20. Analysis Warning

```ts
export interface AnalysisWarning {
  file?: string;

  type:
    | "parse-error"
    | "unsupported-pattern"
    | "unresolved-type"
    | "unresolved-route";

  message: string;

  source?: SourceLocation;
}
```

Warnings must not cause workspace-wide failure.

---

# 21. Workspace State

```ts
export interface WorkspaceState {
  rootPath: string;

  revision: number;

  files: Map<string, SourceFileState>;

  consumers: Map<string, ConsumerContract>;
  providers: Map<string, ProviderContract>;

  contracts: Map<string, ApiContract>;

  drifts: Map<string, Drift>;

  graph: ContractGraph;
}
```

---

# 22. Source File State

```ts
export interface SourceFileState {
  path: string;

  contentHash: string;

  lastModified?: number;

  sourceKind:
    | "frontend"
    | "backend"
    | "prisma"
    | "unknown";

  extractedConsumerIds: string[];
  extractedProviderIds: string[];

  analyzed: boolean;
}
```

---

# 23. Contract Graph

The graph should be implemented with ordinary in-memory maps.

No graph database is needed.

```ts
export interface ContractGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}
```

Node:

```ts
export interface GraphNode {
  id: string;

  type:
    | "frontend-consumer"
    | "backend-provider"
    | "api-contract"
    | "type-definition"
    | "database-model"
    | "schema-definition";

  source?: SourceReference;

  metadata: Record<string, unknown>;
}
```

Edge:

```ts
export type GraphEdgeType =
  | "CONSUMES"
  | "PROVIDES"
  | "MATCHES"
  | "EXPECTS"
  | "RETURNS"
  | "READS_FROM"
  | "WRITES_TO";

export interface GraphEdge {
  id: string;

  from: string;
  to: string;

  type: GraphEdgeType;

  confidence?: number;

  metadata?: Record<string, unknown>;
}
```

---

# 24. Core Engine Interface

The main entry point:

```ts
export interface UndriftEngine {
  initialize(
    config?: UndriftConfig
  ): Promise<void>;

  analyzeWorkspace(
    input?: WorkspaceInput
  ): Promise<AnalysisResult>;

  analyzeChanges(
    changes: SourceChange[]
  ): Promise<AnalysisResult>;

  getContracts(): ApiContract[];

  getDrifts(): Drift[];

  getReport(): IntegrationReport;

  getFixes(
    driftId: string
  ): FixProposal[];

  dispose(): void;
}
```

---

# 25. Core Configuration

```ts
export interface UndriftConfig {
  rootPath: string;

  frontend?: {
    enabled: boolean;
    clients?: string[];
  };

  backend?: {
    enabled: boolean;
    frameworks?: string[];
  };

  prisma?: {
    enabled: boolean;
  };

  analysis?: {
    debounceMs?: number;
    maxSchemaDepth?: number;
  };
}
```

The default configuration should target:

```text
React/TypeScript
Express/TypeScript
Prisma
```

---

# 26. Workspace Input

```ts
export interface WorkspaceInput {
  rootPath: string;

  overlays?: Map<string, string>;
}
```

`overlays` represent unsaved editor content.

Example:

```text
disk:
old code

overlay:
new code currently being typed
```

The overlay should take precedence during analysis.

---

# 27. Source Change

```ts
export interface SourceChange {
  path: string;

  content?: string;

  changeType:
    | "created"
    | "modified"
    | "deleted";
}
```

---

# 28. Extraction Architecture

All extractors implement a common abstraction.

```ts
export interface ExtractorContext {
  project: AnalysisProject;

  sourceFile: SourceFileHandle;

  config: UndriftConfig;
}
```

---

# 29. Frontend Extractor Interface

```ts
export interface FrontendApiExtractor {
  name: string;

  canHandle(
    node: CallExpressionNode
  ): boolean;

  extract(
    node: CallExpressionNode,
    context: ExtractorContext
  ): ConsumerContract | null;
}
```

---

# 30. Backend Extractor Interface

```ts
export interface BackendRouteExtractor {
  name: string;

  canHandle(
    node: CallExpressionNode
  ): boolean;

  extract(
    node: CallExpressionNode,
    context: ExtractorContext
  ): ProviderContract | null;
}
```

---

# 31. Prisma Extractor Interface

```ts
export interface PrismaExtractor {
  name: string;

  canHandle(file: SourceFileHandle): boolean;

  extract(
    file: SourceFileHandle
  ): DatabaseModelObservation[];
}
```

---

# 32. Frontend API Discovery

The initial frontend extraction pipeline:

```text
TypeScript source
      ↓
AST
      ↓
CallExpression nodes
      ↓
API-client candidate
      ↓
method/path extraction
      ↓
request extraction
      ↓
response type extraction
      ↓
ConsumerContract
```

---

# 33. Supported Frontend Patterns

Initial supported patterns:

```ts
fetch("/api/users")

fetch("/api/users", {
  method: "POST"
})

axios.get("/api/users")

axios.post("/api/users", payload)

api.get<User>("/api/users/:id")

api.post<LoginResponse>(
  "/api/auth/login",
  payload
)
```

Support for arbitrary custom clients is optional.

---

# 34. Fetch Extraction

For:

```ts
fetch("/api/users", {
  method: "POST",
  body: JSON.stringify(payload)
});
```

extract:

```text
method = POST
path = /api/users
request body reference = payload
```

If the method property is absent:

```text
method = GET
```

consistent with standard fetch semantics.

---

# 35. Axios Extraction

Recognize:

```ts
axios.get(path)
axios.post(path, body)
axios.put(path, body)
axios.patch(path, body)
axios.delete(path)
```

Also support a generic axios request configuration where practical:

```ts
axios({
  method: "POST",
  url: "/users",
  data: payload
})
```

Generic object-config extraction can be lower priority if time is limited.

---

# 36. Typed API Extraction

For:

```ts
api.get<User>("/users/:id")
```

the extractor should:

1. identify the call;
2. identify the path;
3. infer method from the function name;
4. resolve generic type `User`;
5. resolve `User` into `ObjectSchema`;
6. retain the call's source location.

---

# 37. Type Resolution

Type resolver should support:

```text
interface
type alias
imported type
generic reference
inline object type
Zod object schema where practical
```

Example:

```ts
interface User {
  id: string;
  userName: string;
}
```

becomes:

```text
object User
 ├── id → string
 └── userName → string
```

---

# 38. Backend Route Discovery

Backend pipeline:

```text
TypeScript source
      ↓
AST
      ↓
CallExpression
      ↓
router.get/post/put/delete
      ↓
route path
      ↓
handler
      ↓
request analysis
      ↓
response analysis
      ↓
ProviderContract
```

---

# 39. Supported Express Patterns

Initial support:

```ts
router.get(path, handler)
router.post(path, handler)
router.put(path, handler)
router.patch(path, handler)
router.delete(path, handler)

app.get(path, handler)
app.post(path, handler)
app.put(path, handler)
app.patch(path, handler)
app.delete(path, handler)
```

---

# 40. Route Path Extraction

The route argument should be:

```text
string literal
template literal with resolvable static sections
```

Example:

```ts
router.get("/users/:id", handler)
```

produces:

```text
GET
/users/:id
```

Dynamic routes that cannot be statically resolved should produce an analysis warning rather than an invented path.

---

# 41. Express Router Prefix

The MVP may support a simple static router prefix.

Example:

```ts
app.use("/api", router);
```

and:

```ts
router.get("/users", handler);
```

can resolve to:

```text
GET /api/users
```

This requires a basic router relationship model.

If the router prefix cannot be statically resolved, retain the route as a partial path and lower match confidence.

---

# 42. Backend Request Extraction

Analyze references such as:

```ts
req.params.id
req.query.page
req.body.email
req.body.password
```

into:

```text
params:
  id

query:
  page

body:
  email
  password
```

Where type information is unavailable, fields are represented as unknown.

---

# 43. Backend Response Extraction

Primary response patterns:

```ts
res.json({...})
return res.json({...})
res.status(200).json({...})
return res.status(200).json({...})
```

For:

```ts
res.json({
  id: user.id,
  user_name: user.userName,
  email: user.email
});
```

extract:

```text
id
user_name
email
```

and resolve types where TypeScript can infer them.

---

# 44. Variable Response Extraction

If:

```ts
const result = {
  id: user.id,
  email: user.email
};

res.json(result);
```

the extractor should resolve `result` to its object initializer.

The maximum resolution depth should be bounded.

---

# 45. Service-Layer Response Extraction

For:

```ts
const user = await service.getUser(id);

return res.json(user);
```

the system may not always be able to reconstruct the response shape.

Initial behavior:

```text
response shape = unresolved
```

If the `user` function has a statically resolvable return type, the type resolver may resolve that type.

---

# 46. Prisma Extraction

Parse `schema.prisma` using a dedicated schema parser or a small purpose-built parser for the benchmark syntax.

Extract:

```text
model name
field name
field type
optional marker
list marker
relations
enum names
```

Example:

```prisma
model User {
  id          String  @id
  displayName String?
  email       String
}
```

becomes:

```text
User
 ├── id: string
 ├── displayName: string | null
 └── email: string
```

---

# 47. Parser Project Model

The Core should maintain a project-level TypeScript program.

Conceptually:

```ts
interface AnalysisProject {
  rootPath: string;

  sourceFiles: Map<string, SourceFileHandle>;

  getSourceFile(path: string): SourceFileHandle | undefined;

  resolveType(
    reference: TypeReference
  ): NormalizedType;
}
```

`ts-morph` may be used as the primary implementation layer over the TypeScript compiler infrastructure.

---

# 48. Source File Handle

```ts
interface SourceFileHandle {
  path: string;

  getText(): string;

  getAst(): AstSourceFile;

  getHash(): string;

  isOverlay: boolean;
}
```

This abstraction makes file input independent of VS Code.

---

# 49. AST Traversal Strategy

Traversal should be visitor-based.

Example conceptual flow:

```text
SourceFile
   ↓
visit node
   ├── CallExpression
   │      ↓
   │   Frontend adapters
   │   Backend adapters
   │
   ├── InterfaceDeclaration
   │
   ├── TypeAliasDeclaration
   │
   └── VariableDeclaration
```

The extractor should only inspect nodes relevant to its adapter.

---

# 50. Contract Normalization

Before matching, normalize:

```text
method
route
parameter naming
field representation
type representation
optional/nullability
```

Example:

```text
"GET" + "/users/:id"
```

becomes a canonical internal representation.

---

# 51. Route Normalization

Initial normalization:

```text
trim whitespace
ensure leading slash
remove duplicate slashes
normalize trailing slash
normalize parameter token shape
```

Parameter token:

```text
:id
:userId
```

becomes conceptually:

```text
PARAM
```

for structural route matching.

Original parameter names remain available for request-parameter validation.

---

# 52. Route Matching

Candidate generation:

```text
same normalized path
OR
same path structure with different parameter names
```

Example:

```text
/users/:id
/users/:userId
```

candidate match.

But:

```text
/users/:id
/user/:id
```

is not an exact route match.

Potential fuzzy matching can classify this as a route mismatch if both sides appear related.

---

# 53. Contract Matching Pipeline

```text
Consumer
   │
   ▼
Route + Method candidate search
   │
   ▼
Candidate Provider
   │
   ▼
Request comparison
   │
   ▼
Response comparison
   │
   ▼
Type/optional comparison
   │
   ▼
Semantic resolver if required
   │
   ▼
MatchResult
```

---

# 54. Method Matching Rule

Exact match:

```text
POST == POST
```

Mismatch:

```text
POST != PUT
```

Method mismatch severity:

```text
critical
```

when the route is otherwise strongly related.

---

# 55. Request Matching Rule

Compare:

```text
path params
query params
body fields
```

For each:

```text
expected field exists?
provided/consumed field exists?
type compatible?
optional compatible?
```

---

# 56. Response Matching Rule

For each expected frontend response field:

```text
provider field exists?
field name exact?
field semantically related?
type compatible?
nullability compatible?
```

Missing response field:

```text
critical or warning
```

depending on whether it is required.

Initial implementation recommendation:

```text
required missing field → critical
optional missing field → warning
```

---

# 57. Field Matching Order

Use:

```text
1. exact name
2. normalized name
3. structural/type evidence
4. semantic resolver
```

Example:

```text
user_name
      ↓
normalize
      ↓
username
```

Potential exact normalized match.

---

# 58. Name Normalization

Convert common naming styles into comparable tokens.

Examples:

```text
userName
user_name
user-name
USER_NAME
```

normalize to something equivalent to:

```text
["user", "name"]
```

This reduces false positives without requiring AI.

---

# 59. Semantic Matching

Only invoke semantic resolution when deterministic matching leaves an ambiguous candidate.

Example:

```text
displayName
full_name
```

Possible result:

```text
equivalent = true
confidence = 0.91
reasons = [
  "same source model",
  "same primitive type",
  "similar display-oriented usage"
]
```

---

# 60. Semantic Resolver Interface

```ts
export interface SemanticResolver {
  resolve(
    request: SemanticMatchRequest
  ): Promise<SemanticMatchResult>;
}
```

Request:

```ts
interface SemanticMatchRequest {
  frontendField: FieldDefinition;
  backendField: FieldDefinition;

  context: {
    route: string;
    entity?: string;
  };
}
```

Result:

```ts
interface SemanticMatchResult {
  equivalent: boolean;

  confidence: number;

  reasons: string[];
}
```

---

# 61. Semantic Resolution Priority

For the 48-hour MVP:

```text
P0:
deterministic normalization

P2:
heuristic semantic resolver

P3:
external/LLM semantic resolver
```

The core must operate without the P3 layer.

---

# 62. Drift Detection

The Drift Engine evaluates:

```text
unmatched consumer
unmatched provider
matched route
matched method
request schemas
response schemas
types
optional/nullability
semantic ambiguity
```

---

# 63. Missing Endpoint Detector

Input:

```text
consumer exists
provider candidates = []
```

Output:

```ts
Drift {
  type: "missing-endpoint",
  severity: "critical"
}
```

Example message:

```text
Frontend expects GET /api/profile, but no matching backend
provider was discovered.
```

---

# 64. Orphan Endpoint Detector

Input:

```text
provider exists
consumer candidates = []
```

Output:

```text
type = orphan-endpoint
severity = info
```

Message:

```text
No known frontend consumer was discovered for GET /api/analytics.
```

The word "known" is intentional.

---

# 65. Route Mismatch Detector

When two endpoints appear strongly related but paths differ:

```text
Frontend:
GET /users/:id

Backend:
GET /user/:id
```

create:

```text
route-mismatch
```

with both source locations.

---

# 66. Method Mismatch Detector

Example:

```text
Frontend:
POST /orders

Backend:
PUT /orders
```

create:

```text
method-mismatch
severity = critical
```

if route similarity is strong enough.

---

# 67. Request Mismatch Detector

Example:

```text
Frontend request:
email
password

Backend request:
email
pass
```

finding:

```text
request-mismatch
```

The finding may contain child field mismatches internally.

---

# 68. Response Mismatch Detector

Example:

```text
Frontend:
userName
email

Backend:
user_name
email
```

finding:

```text
response-mismatch
```

with an optional semantic child finding for:

```text
userName ↔ user_name
```

---

# 69. Type Mismatch Detector

Example:

```text
Frontend:
price: number

Backend:
price: string
```

Output:

```text
type-mismatch
severity = critical
```

if the field is required and the types are clearly incompatible.

---

# 70. Nullability Detector

Example:

```text
Frontend:
avatar: string

Backend:
avatar: string | null
```

Output:

```text
nullability-mismatch
severity = warning
```

---

# 71. Severity Rules

Suggested initial rules:

```text
missing endpoint            critical
method mismatch             critical
required request mismatch  critical
required response missing   critical
clear type mismatch        critical
field naming drift          warning
nullability mismatch       warning
optional field mismatch    warning
orphan endpoint             info
ambiguous semantic match   info/warning
```

Severity should remain configurable later.

---

# 72. Drift State Resolution

The contract's state is derived from observations.

Pseudo-logic:

```text
consumer only
    → waiting

provider only
    → orphaned

consumer + provider
    → matched

consumer + provider + no drift
    → verified

consumer + provider + drift
    → drifted
```

After a user-approved fix:

```text
drifted
    ↓
re-analysis
    ↓
no drift
    ↓
verified
```

---

# 73. Repaired State

`repaired` should be treated as a transitional state rather than a permanent state.

Example:

```text
DRIFTED
   ↓
Fix applied
   ↓
REPAIRED
   ↓
Verification succeeds
   ↓
VERIFIED
```

If verification fails:

```text
REPAIRED
   ↓
DRIFTED
```

---

# 74. Contract Store

The Contract Store maintains current contracts.

```ts
interface ContractStore {
  get(id: string): ApiContract | undefined;

  getAll(): ApiContract[];

  set(contract: ApiContract): void;

  delete(id: string): void;

  clear(): void;
}
```

---

# 75. Drift Store

```ts
interface DriftStore {
  get(id: string): Drift | undefined;

  getAll(): Drift[];

  set(drift: Drift): void;

  delete(id: string): void;

  clear(): void;
}
```

---

# 76. Source Store

```ts
interface SourceStore {
  get(path: string): SourceFileState | undefined;

  set(file: SourceFileState): void;

  delete(path: string): void;

  getAll(): SourceFileState[];

  hasChanged(path: string, hash: string): boolean;
}
```

---

# 77. Graph Store

The graph can be held directly by Core state.

Basic operations:

```ts
interface GraphStore {
  addNode(node: GraphNode): void;

  removeNode(id: string): void;

  addEdge(edge: GraphEdge): void;

  removeEdge(id: string): void;

  getNode(id: string): GraphNode | undefined;

  getEdgesForNode(id: string): GraphEdge[];

  clear(): void;
}
```

---

# 78. Full Analysis Coordinator

The engine coordinator controls the analysis pipeline.

```text
WorkspaceInput
      ↓
WorkspaceIndexer
      ↓
ExtractorRunner
      ↓
ContractNormalizer
      ↓
ContractStore
      ↓
GraphBuilder
      ↓
MatchingEngine
      ↓
DriftEngine
      ↓
FixBuilder
      ↓
AnalysisResult
```

---

# 79. Incremental Analysis Coordinator

For a file change:

```text
SourceChange
      ↓
identify old observations
      ↓
remove old contract nodes
      ↓
parse changed content
      ↓
re-extract
      ↓
normalize
      ↓
update stores
      ↓
rebuild affected graph relationships
      ↓
re-match affected contracts
      ↓
recompute affected drifts
```

---

# 80. What Is an Affected Contract?

For the MVP, an affected contract is any contract where:

- the consumer source file changed;
- the provider source file changed;
- a directly referenced type definition changed;
- a Prisma model used by the provider changed.

A fully recursive dependency impact system is not required initially.

---

# 81. Type Dependency Handling

If:

```ts
interface User {
  userName: string;
}
```

changes, API contracts using `User` may be affected even though the API call file did not change.

Minimum acceptable MVP strategy:

```text
track source location of resolved type
+
associate type definition with consumer/provider
```

Then re-evaluate those contracts when the definition changes.

---

# 82. File Hashing

For persisted/cached source state:

```text
SHA-256(content)
```

or another stable cryptographic/content hash may be used.

The hash helps determine whether a file actually changed.

The exact hashing algorithm is not part of the product contract.

---

# 83. Debouncing

VS Code may emit many document change events while typing.

Use:

```text
change
 ↓
reset timer
 ↓
~500–1000 ms without new change
 ↓
run analysis
```

The exact interval can be configured.

---

# 84. Revision Control

Every analysis request should capture a revision number.

Example:

```text
revision 18
```

When a new change occurs:

```text
revision 19
```

If revision 18 finishes after revision 19:

```text
discard revision 18 result
```

This prevents stale analysis from overwriting current state.

---

# 85. VS Code Extension Entry Point

`extension.ts` responsibilities:

```text
activate context
    ↓
detect workspace
    ↓
initialize Core service
    ↓
register commands
    ↓
register diagnostics
    ↓
register hover
    ↓
register code actions
    ↓
register sidebar
    ↓
register report command
    ↓
register workspace watchers
```

It should remain an orchestration file, not a giant implementation file.

---

# 86. Core Service

`coreService.ts` owns the extension's Core instance.

Conceptually:

```ts
interface CoreService {
  initialize(rootPath: string): Promise<void>;

  analyze(): Promise<AnalysisResult>;

  analyzeChanges(
    changes: SourceChange[]
  ): Promise<AnalysisResult>;

  getDrift(id: string): Drift | undefined;

  getFixes(id: string): FixProposal[];

  getReport(): IntegrationReport;
}
```

---

# 87. Workspace Service

Responsibilities:

- determine workspace root;
- create source overlays;
- identify relevant files;
- connect VS Code workspace state to Core inputs.

It should not perform contract matching.

---

# 88. Analysis Coordinator in Extension

The extension-level coordinator controls when Core analysis should happen.

```text
VS Code event
     ↓
AnalysisCoordinator
     ↓
debounce
     ↓
CoreService
     ↓
Core
     ↓
AnalysisResult
     ↓
UI refresh
```

---

# 89. Diagnostics Provider

The Diagnostic Provider translates Core drift into VS Code diagnostics.

Mapping:

```text
DriftSeverity
    ↓
DiagnosticSeverity.Error / Warning / Information
```

Example:

```ts
const diagnostic =
  new vscode.Diagnostic(
    range,
    drift.message,
    severity
  );
```

The diagnostic source should be:

```text
UNDRIFT
```

---

# 90. Diagnostic Range Selection

A drift can have multiple locations.

Preferred target order:

```text
1. developer's currently incorrect usage
2. provider field/route
3. consumer route
4. general source range
```

The goal is to place the warning where the developer can act on it.

---

# 91. Related Information

Where supported, attach related locations:

```text
Frontend:
src/api/users.ts:12

Backend:
src/routes/users.ts:24
```

This gives the developer both sides of the mismatch.

---

# 92. Hover Provider

The Hover Provider performs:

```text
cursor location
     ↓
Core source lookup
     ↓
relevant contract/drift
     ↓
hover markdown
```

Hover content should contain:

```text
endpoint
expected
actual
reason
severity
suggested resolution
```

---

# 93. Code Action Provider

The Code Action Provider:

```text
diagnostic range
      ↓
find drift
      ↓
request FixProposals
      ↓
create CodeActions
```

Example labels:

```text
UNDRIFT: Map user_name → userName
UNDRIFT: Add missing response field
UNDRIFT: Review contract
```

---

# 94. Code Action Edit

For an exact replacement:

```text
FixProposal
    ↓
vscode.WorkspaceEdit
    ↓
TextEdit.replace(...)
    ↓
workspace.applyEdit(...)
```

For multiple files:

```text
single WorkspaceEdit
   ├── frontend edit
   ├── backend edit
   └── test edit
```

where supported by the generated proposal.

---

# 95. Fix Preview

The MVP does not need a custom diff renderer.

Prefer VS Code's native source/edit interaction wherever possible.

The user can:

```text
review
accept
reject
```

from native editor flows.

A custom report can show a textual summary of affected files.

---

# 96. Fix Safety Policy

Rules:

```text
safe
→ direct Quick Fix

review
→ explicit review action

manual
→ no automatic edit
```

Examples:

```text
user_name → userName
```

may be `safe` if only one consumer mapping must be changed.

A multi-file semantic transformation may be `review`.

An ambiguous semantic relationship should be `manual`.

---

# 97. Sidebar Tree Provider

The Tree Provider should read Core state.

Root nodes:

```text
Integration Health
Drifted Contracts
Waiting Contracts
Orphaned Providers
```

Child nodes:

```text
⚠ GET /users/:id
⚠ POST /orders
```

Tree node commands can open the relevant source or report entry.

---

# 98. Report Webview

The report receives a serializable `IntegrationReport`.

Messages from Webview to extension may include:

```text
OPEN_DRIFT
APPLY_FIX
REFRESH
OPEN_FILE
```

The Webview must not mutate Core directly.

All actions go:

```text
Webview
 ↓ message
Extension
 ↓
Core / WorkspaceEdit
```

---

# 99. Integration Report

```ts
export interface IntegrationReport {
  projectName: string;

  generatedAt: number;

  summary: {
    totalContracts: number;
    verified: number;
    drifted: number;
    waiting: number;
    orphaned: number;
  };

  drifts: Drift[];

  warnings: AnalysisWarning[];
}
```

---

# 100. CLI Design

CLI commands:

```bash
undrift scan
undrift report
undrift verify
```

Implementation:

```text
CLI command
   ↓
create Core
   ↓
analyzeWorkspace()
   ↓
format output
```

The CLI has no separate analysis implementation.

---

# 101. CLI Output

Example:

```text
UNDRIFT

Contracts: 24

✓ Verified:   18
⚠ Drifted:     3
○ Waiting:     2
◇ Orphaned:    1

Drifted:
  [CRITICAL] POST /api/orders
  [WARNING]  GET /api/users/:id
  [WARNING]  PUT /api/profile
```

---

# 102. Prisma-to-Backend Relationship

The MVP should not attempt full semantic entity tracing.

A practical implementation can establish relationships when:

```text
Prisma model type
      ↓
backend service/type reference
      ↓
response type
```

is statically resolvable.

Otherwise, the Prisma model remains independently available for future graph enrichment.

---

# 103. Dynamic API Calls

Unsupported example:

```ts
fetch(`/api/${resource}/${action}`);
```

If values cannot be resolved statically:

```text
do not create a false concrete contract
```

Instead:

```text
AnalysisWarning:
unresolved-route
```

This preserves correctness.

---

# 104. Generated Code

The analyzer should treat generated code conservatively.

Potential directories:

```text
generated/
dist/
build/
```

should normally be excluded unless configuration explicitly includes them.

---

# 105. Source Filtering

Relevant extensions for MVP:

```text
.ts
.tsx
.js
.jsx
```

with `.ts` / `.tsx` as the primary implementation target.

Prisma:

```text
.prisma
```

Only supported source paths should enter extraction.

---

# 106. Error Handling

Every major pipeline stage should catch local failures.

Example:

```text
extract file
   ↓
try
   ├── successful
   └── warning
```

One extractor failing for one file should not abort all analysis.

Errors should become:

```text
AnalysisWarning
```

whenever the project can still be meaningfully analyzed.

---

# 107. Logging Architecture

Provide a small logger interface:

```ts
interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
```

Production/default logging:

```text
INFO
WARN
ERROR
```

Debug logging is enabled through development configuration.

Do not log source file contents by default.

---

# 108. Configuration Resolution

Configuration resolution order:

```text
1. built-in defaults
2. .undriftrc.json
3. workspace settings
4. runtime command options
```

For the hackathon, `.undriftrc.json` may remain optional.

---

# 109. Example `.undriftrc.json`

```json
{
  "version": 1,
  "frontend": {
    "clients": ["fetch", "axios"]
  },
  "backend": {
    "frameworks": ["express"]
  },
  "prisma": {
    "enabled": true
  },
  "analysis": {
    "maxSchemaDepth": 4
  }
}
```

---

# 110. Testing Structure

Core tests should be independent of VS Code.

```text
packages/core/tests/
│
├── extractors/
│   ├── frontend/
│   ├── backend/
│   └── prisma/
│
├── normalization/
├── matcher/
├── drift/
├── fixes/
├── graph/
└── engine/
```

VS Code-specific tests live separately.

---

# 111. Fixture Structure

Recommended:

```text
tests/fixtures/
│
├── 01-missing-endpoint/
│   ├── frontend/
│   ├── backend/
│   └── expected.json
│
├── 02-orphan-endpoint/
│
├── 03-route-mismatch/
│
├── 04-method-mismatch/
│
├── 05-response-field-mismatch/
│
├── 06-type-mismatch/
│
└── 07-nullability-mismatch/
```

---

# 112. Fixture Principles

Each fixture should be:

- small;
- deterministic;
- understandable;
- intentionally broken in one primary way;
- easy to compare against expected output.

Multiple issues can be tested in larger integration fixtures.

---

# 113. Extractor Unit Test Example

Input:

```ts
api.get<User>("/users/:id");
```

Expected:

```text
method = GET
path = /users/:id
response type = User
```

The test should also assert source location.

---

# 114. Matcher Unit Test Example

Input:

```text
Consumer:
GET /users/:id
Response:
userName: string

Provider:
GET /users/:id
Response:
user_name: string
```

Expected:

```text
route match = true
response field exact match = false
normalized/semantic candidate = true
```

---

# 115. Drift Unit Test Example

Input:

```text
expected:
price: number

actual:
price: string
```

Expected:

```text
type = type-mismatch
severity = critical
```

---

# 116. Fix Unit Test Example

Input:

```text
Frontend:
user_name
Backend:
userName
```

Expected:

```text
FixProposal
confidence >= configured safe threshold
edits.length >= 1
```

The test should verify that the generated replacement changes the intended range and not unrelated code.

---

# 117. End-to-End Fixture

A complete fixture should simulate:

```text
Open project
     ↓
initial scan
     ↓
drift detected
     ↓
fix generated
     ↓
apply edit
     ↓
rescan
     ↓
verified
```

This test represents the main product loop.

---

# 118. Performance Test

Use the benchmark application.

Record:

```text
initialScanMs
incrementalAnalysisMs
contractsDiscovered
driftsDetected
```

Performance measurements should be recorded locally and reported as benchmark results.

---

# 119. Memory Management

Do not keep redundant AST trees forever.

Recommended model:

```text
source cache
+
current AST/project representation
+
normalized contract data
```

Old contract observations should be removed when the source file is re-extracted.

---

# 120. Stale Entity Cleanup

When a file changes:

```text
old consumer IDs
old provider IDs
```

must be removed from:

```text
consumer store
provider store
contract graph
drift relationships
```

before inserting the new observations.

This prevents ghost contracts inside UNDRIFT itself.

---

# 121. File Deletion

On file deletion:

```text
delete source state
delete extracted consumers/providers
remove related graph nodes
recompute affected contracts
recompute drifts
```

Example:

```text
backend route deleted
     ↓
frontend consumer remains
     ↓
missing endpoint finding appears
```

This is an important live-drift scenario.

---

# 122. Contract Appearance During Coding

Example:

```text
Developer writes frontend API call
```

UNDRIFT extracts:

```text
consumer discovered
provider = unknown
state = waiting
```

Later:

```text
Developer adds backend route
```

UNDRIFT re-analyzes:

```text
provider discovered
consumer/provider matched
state = verified
```

This directly implements the live contract lifecycle.

---

# 123. Backend-Only Development

Developer adds:

```ts
router.get("/recommendations", ...)
```

No known frontend consumer.

UNDRIFT:

```text
state = orphaned
severity = info
```

If later the frontend consumes it, the relationship transitions to:

```text
verified
```

provided there are no contract mismatches.

---

# 124. Frontend-Only Development

Developer adds:

```ts
api.get("/recommendations")
```

No backend route.

UNDRIFT:

```text
state = waiting
```

The UI should explain:

```text
Waiting for provider
No matching backend endpoint found.
```

This is distinct from a provider that is known to be present but structurally incompatible.

---

# 125. Drift Trigger Example

Initially:

```text
Frontend:
userName

Backend:
userName

STATUS:
VERIFIED
```

Developer changes backend:

```text
userName
→
displayName
```

UNDRIFT:

```text
file change
 ↓
provider re-extraction
 ↓
response contract changed
 ↓
consumer still expects userName
 ↓
drift created
 ↓
diagnostic published
```

The previously verified contract is now `drifted`.

---

# 126. Fix Trigger Example

Developer invokes:

```text
UNDRIFT: Fix selected drift
```

Core returns:

```text
FixProposal
```

Extension applies:

```text
WorkspaceEdit
```

Then:

```text
document change
 ↓
Core re-analysis
 ↓
drift gone
 ↓
contract verified
```

---

# 127. Semantic Mapping UI

For ambiguous cases:

```text
Frontend:
displayName

Backend:
full_name

UNDRIFT:
Possible semantic match
Confidence: 91%

Reason:
Both are string fields associated with User display data.

[Review Mapping]
[Apply]
[Ignore]
```

Semantic confidence should never bypass developer control.

---

# 128. Inline Completion Implementation

Inline completion is optional.

When enabled, it may provide context-aware completions for a high-confidence missing field.

Example:

```ts
response.us|
            ghost text:
            erName
```

However, this feature must not become coupled to the core drift engine.

The core should return structured suggestions, and the extension can decide whether a suggestion is suitable for inline completion.

---

# 129. Why Code Actions Are Primary

The primary repair mechanism should remain:

```text
Diagnostic
   ↓
Code Action
```

because the issue already exists in the source.

Inline completion is optimized for predicting what the developer may type next; UNDRIFT primarily needs to repair an existing integration mismatch.

---

# 130. Source-to-UI Mapping

Every diagnostic-capable drift should retain source locations.

Example:

```text
Drift:
response-mismatch

locations:
[
  frontend/src/api/users.ts:14:8,
  backend/src/routes/users.ts:31:5
]
```

Extension can then:

```text
open frontend source
open backend source
```

as needed.

---

# 131. Command Registration

Recommended command IDs:

```text
undrift.analyzeWorkspace
undrift.showReport
undrift.refresh
undrift.verifyCurrentFile
undrift.fixDrift
```

Command handlers should call services rather than directly accessing Core internals.

---

# 132. Extension Activation Events

The extension should activate when a supported workspace/language is opened.

Possible activation strategy:

```text
onLanguage:typescript
onLanguage:typescriptreact
workspaceContains:**/package.json
```

The exact activation event configuration can be refined during packaging.

---

# 133. Extension Settings

Potential settings:

```text
undrift.enabled
undrift.analysis.debounceMs
undrift.analysis.maxSchemaDepth
undrift.semantic.enabled
undrift.debug
```

For the hackathon, only essential settings should be exposed.

---

# 134. Webview Message Contract

Example:

```ts
type WebviewMessage =
  | {
      type: "openDrift";
      driftId: string;
    }
  | {
      type: "applyFix";
      fixId: string;
    }
  | {
      type: "refresh";
    };
```

Extension response:

```ts
type WebviewStateMessage = {
  type: "reportState";
  report: IntegrationReport;
};
```

---

# 135. UI State Synchronization

After every successful Core update:

```text
AnalysisResult
 ↓
update diagnostics
 ↓
refresh TreeView
 ↓
refresh report state
```

There must be one Core state and multiple presentation projections.

---

# 136. No Duplicate Analysis State in UI

The extension should not independently maintain:

```text
verifiedContracts
driftedContracts
orphanedContracts
```

as authoritative state.

Instead:

```text
Core AnalysisResult
        ↓
UI projection
```

This avoids divergence.

---

# 137. Persistence Strategy

Optional persistence:

```text
.undrift/
├── state.json
├── contracts.json
└── graph.json
```

Suggested content:

```text
schema version
project metadata
contract metadata
history
```

Source contents should not be stored unless explicitly required for a future feature.

---

# 138. Persistence Recovery

On startup:

```text
load persisted metadata
      ↓
validate schema version
      ↓
discard stale state if incompatible
      ↓
run source analysis
      ↓
replace runtime state with current source-derived state
```

The source remains authoritative.

---

# 139. CI/CLI Verification Mode

The CLI may support a non-interactive verification mode.

Example:

```bash
undrift verify
```

Exit codes:

```text
0 → no critical drift
1 → critical drift found
2 → analysis failure
```

Exact exit code semantics can be finalized during CLI implementation.

---

# 140. Analysis Pipeline Pseudocode

```ts
async function analyzeWorkspace(
  input: WorkspaceInput
): Promise<AnalysisResult> {

  const project = await projectLoader.load(input);

  const files = await workspaceIndexer.index(project);

  const observations = await extractorRunner.extract(files);

  const normalized =
    normalizer.normalize(observations);

  contractStore.replaceAll(normalized);

  const graph =
    graphBuilder.build(contractStore);

  matcher.match(
    contractStore,
    graph
  );

  const drifts =
    driftEngine.detect(
      contractStore,
      graph
    );

  const fixes =
    fixBuilder.build(drifts);

  return resultBuilder.build(
    contractStore,
    graph,
    drifts,
    fixes
  );
}
```

The actual implementation should preserve the same conceptual ordering.

---

# 141. Incremental Analysis Pseudocode

```ts
async function analyzeChanges(
  changes: SourceChange[]
): Promise<AnalysisResult> {

  const affectedFiles =
    sourceStore.applyChanges(changes);

  for (const file of affectedFiles) {
    removeOldObservations(file);
  }

  const newObservations =
    extractorRunner.extract(affectedFiles);

  const normalized =
    normalizer.normalize(newObservations);

  contractStore.upsert(normalized);

  graphUpdater.update(
    affectedFiles,
    contractStore
  );

  const affectedContracts =
    dependencyResolver.findAffectedContracts(
      affectedFiles
    );

  matcher.rematch(affectedContracts);

  driftEngine.recompute(
    affectedContracts
  );

  return resultBuilder.buildCurrent();
}
```

---

# 142. Matching Complexity

The implementation should avoid naïve all-to-all matching when possible.

For route candidates, index providers by:

```text
HTTP method
+
normalized path
```

Conceptually:

```ts
Map<string, ProviderContract[]>
```

where key:

```text
GET:/users/:param
```

This reduces candidate search substantially.

---

# 143. Field Comparison Complexity

Object fields should be indexed by normalized name.

Example:

```text
Map<normalizedFieldName, FieldDefinition[]>
```

Then:

```text
exact/normalized lookup
```

occurs before semantic search.

This keeps semantic matching rare.

---

# 144. Semantic Resolver Cost Control

Semantic resolution should only occur when:

```text
exact match failed
+
normalized match failed
+
candidate relationship remains plausible
```

This prevents AI or expensive reasoning from being invoked for ordinary fields.

---

# 145. AI/External Resolver Boundary

If an external semantic resolver is added, it should sit behind:

```ts
SemanticResolver
```

The rest of the Core does not know:

- which model is used;
- where it runs;
- how it is authenticated;
- how the reasoning is performed.

This is an optional implementation behind an abstraction.

---

# 146. Security Constraints for Resolver

Before sending semantic context to an external provider:

```text
remove secret values
remove environment values
remove credentials
remove unnecessary source contents
```

Prefer structured context:

```text
field names
types
route
entity name
source-free evidence
```

over raw source whenever possible.

---

# 147. Analysis Cancellation

If possible, an outdated analysis should be cancellable.

Minimal MVP strategy:

```text
requestId/revision check
```

Advanced strategy:

```text
AbortController
```

can cancel long-running analysis.

The MVP only requires correctness against stale results.

---

# 148. Extension Disposal

On extension deactivation:

```text
dispose watchers
dispose diagnostics
dispose tree provider
dispose webview resources
dispose Core
```

All VS Code disposables should be registered with the extension context where practical.

---

# 149. Testable Boundaries

The following should be independently unit-testable:

```text
Frontend extractor
Backend extractor
Prisma extractor
Normalizer
Route matcher
Field matcher
Type matcher
Drift detector
Fix builder
Graph builder
Core engine
```

VS Code providers are separately integration-tested.

---

# 150. Recommended Implementation Order

Implementation should proceed in the following dependency order.

```text
1. Domain types
2. Type normalizer
3. Source/project loader
4. Frontend extraction
5. Backend extraction
6. Prisma extraction
7. Contract normalizer
8. Contract store
9. Route matcher
10. Schema matcher
11. Graph builder
12. Drift detectors
13. Fix builder
14. Core engine
15. Fixture tests
16. VS Code activation
17. Diagnostics
18. Sidebar
19. Hover
20. Code Actions
21. WorkspaceEdit
22. Live updates
23. Report Webview
24. CLI
25. Semantic resolver
26. Performance/polish
```

---

# 151. 48-Hour Implementation Cut Line

If time runs short, the first shippable cut should be:

```text
Domain model
+
React/TS frontend extractor
+
Express/TS backend extractor
+
route/method matching
+
field/type comparison
+
missing/orphan detection
+
drift engine
+
VS Code diagnostics
+
sidebar
+
one Quick Fix
+
reverification
```

These components represent the minimum complete product loop.

Prisma, semantic AI, inline completion, advanced graph visualization, and CLI polish can be deferred.

---

# 152. Recommended First Quick Fix

The first fix should be a deterministic field rename/mapping case.

Example:

```text
Frontend:
user_name

Backend:
userName
```

or the inverse.

The implementation path:

```text
Drift
 ↓
FixRule detects simple identifier mismatch
 ↓
FixBuilder creates FileEdit
 ↓
CodeActionProvider exposes action
 ↓
WorkspaceEdit applies replacement
 ↓
re-analysis
 ↓
verified
```

This gives the team the fastest route to a compelling end-to-end demonstration.

---

# 153. Recommended Demo Sequence from LLD Perspective

Demo repository:

```text
React
+
Express
+
Prisma
```

Seed:

```text
1 missing endpoint
1 orphan endpoint
1 method mismatch
1 response mismatch
1 type mismatch
```

Start VS Code.

```text
initial analysis
    ↓
contracts discovered
    ↓
sidebar populated
```

Show one drift in code.

```text
hover
    ↓
explanation
    ↓
Quick Fix
    ↓
apply
    ↓
verified
```

Then make a live backend change.

```text
verified
    ↓
edit backend response field
    ↓
live drift appears
```

Then show report.

This demonstrates:

```text
discover
+
track
+
detect
+
explain
+
fix
+
reverify
+
live monitoring
```

---

# 154. Architecture Invariants

The following rules should remain true throughout implementation.

### Invariant 1

Core never imports VS Code.

### Invariant 2

VS Code extension never reimplements matching logic.

### Invariant 3

All source changes are applied through the extension/user interaction layer.

### Invariant 4

Deterministic contract checks do not depend on an external AI model.

### Invariant 5

The current source workspace is authoritative over persisted state.

### Invariant 6

An analysis result is associated with a workspace revision.

### Invariant 7

Unsupported dynamic behavior produces an explicit limitation/warning rather than fabricated certainty.

### Invariant 8

"Orphaned" means "no known consumer discovered within supported analysis scope."

---

# 155. Final Low-Level Module Map

```text
packages/core
│
├── parser
│   ├── project loader
│   ├── source loader
│   └── type resolver
│
├── extractors
│   ├── frontend
│   │   ├── fetch adapter
│   │   ├── axios adapter
│   │   └── typed-api adapter
│   │
│   ├── backend
│   │   └── express adapter
│   │
│   └── prisma
│
├── contracts
│   ├── domain types
│   ├── schemas
│   └── lifecycle
│
├── normalizer
│   ├── path
│   ├── type
│   └── schema
│
├── matcher
│   ├── route
│   ├── request
│   ├── response
│   ├── field
│   └── contract
│
├── graph
│   ├── nodes
│   ├── edges
│   └── builder
│
├── drift
│   ├── endpoint
│   ├── method
│   ├── request
│   ├── response
│   ├── type
│   └── nullability
│
├── semantic
│   ├── interface
│   └── heuristic/AI implementation
│
├── fixes
│   ├── rules
│   ├── builder
│   └── proposals
│
├── store
│   ├── source
│   ├── contracts
│   └── graph
│
├── workspace
│   ├── changes
│   ├── revisions
│   └── state
│
└── engine
    ├── full analysis
    └── incremental analysis
```

VS Code:

```text
apps/vscode-extension
│
├── extension.ts
│
├── services
│   ├── coreService
│   ├── workspaceService
│   ├── analysisCoordinator
│   └── editService
│
├── providers
│   ├── diagnosticProvider
│   ├── hoverProvider
│   ├── codeActionProvider
│   └── inlineCompletionProvider
│
├── views
│   ├── TreeView
│   └── Report Webview
│
└── commands
    ├── analyze
    ├── report
    ├── refresh
    └── verify
```

---

# 156. Final Technical Flow

The final implementation should follow this exact conceptual pipeline:

```text
                 DEVELOPER
                     │
                     ▼
                 VS CODE
                     │
             document/file event
                     │
                     ▼
             Analysis Coordinator
                     │
                     ▼
                UNDRIFT CORE
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
     Source Loader          Overlay State
          │                     │
          └──────────┬──────────┘
                     ▼
                  AST
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      Frontend    Backend     Prisma
      Extractor   Extractor   Extractor
          │          │          │
          └──────────┼──────────┘
                     ▼
              Normalization
                     │
                     ▼
              Contract Store
                     │
                     ▼
               Contract Graph
                     │
                     ▼
              Matching Engine
                     │
                     ▼
                Drift Engine
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
      Drift Findings       Fix Proposals
           │                   │
           └─────────┬─────────┘
                     ▼
                 VS CODE
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
   Diagnostic      Hover       Quick Fix
        │            │             │
        └────────────┼─────────────┘
                     ▼
              Developer Action
                     │
                     ▼
               WorkspaceEdit
                     │
                     ▼
               Source Changes
                     │
                     ▼
                 Re-analysis
                     │
                     ▼
                  VERIFIED
```

---

# 157. Final LLD Principle

UNDRIFT should be implemented as a **static-analysis-first, contract-centric system**.

The implementation hierarchy is:

```text
Source Code
   ↓
AST / Type Information
   ↓
Contract Observations
   ↓
Normalized Contracts
   ↓
Relationships
   ↓
Drift
   ↓
Fix Proposal
   ↓
IDE Action
   ↓
Reverification
```

The system should not depend on an AI model to answer questions that the source code can answer deterministically.

AI/semantic reasoning is an enhancement for ambiguous relationships.

The primary engineering objective for the hackathon is to make the deterministic pipeline reliable enough that the user can experience the complete loop:

> **UNDRIFT discovers what the application expects, detects when the layers disagree, explains the discrepancy, proposes a change, applies it through the IDE, and verifies that the integration is synchronized again.**
