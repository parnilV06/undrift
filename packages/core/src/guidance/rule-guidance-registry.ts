// Centralized, rule-aware diagnostic explanation and resolution guidance registry
// adhering to LLD.md Section 12, PRD.md Section 12, and Phase 6.4.
// Completely editor-independent; usable across VS Code extension, webview reports, CLI, and future AI resolution layers.

import type { WarningCode } from "../domain/finding";
import type { RuleId } from "../domain/types";
import type { ContextualGuidanceInput, DiagnosticGuidance, ResolutionMode } from "./guidance-types";

/**
 * Reference guidance template for UND110 (Unmapped Provider Endpoint).
 * Strictly addresses the requirement that an unmapped backend endpoint is not automatically
 * confirmed dead code, highlights legitimate external consumers, explains why automatic code deletion
 * or mock request generation is unsafe, and provides the 7 actionable human resolution steps.
 */
export const UND110_REFERENCE_GUIDANCE: DiagnosticGuidance = {
  ruleCode: "UND110",
  title: "Provider has no known consumer",
  whatDetected:
    "A backend API route handler is declared and active, but no frontend consumer call in the analyzed workspace targets this endpoint.",
  whatItMeans:
    "UNDRIFT scanned the codebase and could not find an in-workspace client request matching this route and method. " +
    "This does NOT confirm dead code. The endpoint may be legitimately invoked by external clients, mobile applications, " +
    "third-party webhooks, public API callers, microservices, or scheduled jobs outside this project repository.",
  whyItMatters:
    "If the endpoint is obsolete, it represents technical debt, unnecessary maintenance overhead, and an unneeded attack surface. " +
    "However, if the endpoint is intended for external consumers or upcoming frontend features, deleting it would cause a breaking change.",
  whyNoAutomatedFix:
    "Automatically deleting unmapped routes or generating client requests is unsafe. Static analysis cannot determine " +
    "whether external clients (such as mobile applications, third-party webhooks, public API consumers, or administrative scripts) " +
    "rely on this endpoint, or if it is intentionally exposed for future features. Deleting backend routes can cause severe " +
    "breaking changes, while generating dummy client calls pollutes frontend code without business justification.",
  suggestedSteps: [
    "Verify whether internal or external consumers rely on this endpoint before making changes.",
    "Search the frontend codebase for dynamic route invocations or string concatenations not captured by static analysis.",
    "If it is a work-in-progress or planned endpoint, document it or leave it as intended.",
    "If it is an internal-only or deprecated route no longer used by any client, consider decommissioning or archiving it after verifying telemetry and access logs.",
    "If the route was intended to be called by a frontend view but is missing, implement the frontend API client call.",
    "If the route is invoked via an unsupported client library or custom wrapper, configure or annotate the call if supported.",
    "Review route path and method spelling to ensure no slight path mismatch caused it to be treated as unmapped."
  ],
  resolutionMode: "investigation",
  conciseExplanation:
    "No matching frontend request was identified for this endpoint in the analyzed workspace.\n\nThis does not necessarily indicate dead code. The endpoint may be consumed by external applications, services or scheduled jobs.",
  conciseFixUnavailableReason:
    "UNDRIFT cannot determine whether this endpoint should be deleted, retained or connected to a frontend feature without knowing its intended consumers."
};

interface StaticRuleTemplate {
  readonly title: string;
  readonly baseWhatDetected: (input: ContextualGuidanceInput) => string;
  readonly whatItMeans: string;
  readonly whyItMatters: string;
  readonly whyNoAutomatedFix: (hasAutomatedFix?: boolean) => string;
  readonly conciseExplanation?: (input: ContextualGuidanceInput) => string;
  readonly conciseFixUnavailableReason?: (hasAutomatedFix?: boolean) => string;
  readonly suggestedSteps: (input: ContextualGuidanceInput) => readonly string[];
  readonly defaultResolutionMode: ResolutionMode;
}

const RULE_TEMPLATES: Record<RuleId, StaticRuleTemplate> = {
  UND100: {
    title: "Missing Backend Route",
    baseWhatDetected: (input) => {
      if (input.method && input.route) {
        return `Frontend API consumer sends a ${input.method} request to '${input.route}', but no matching backend route handler exists in the analyzed workspace.`;
      }
      return (
        input.summary ??
        "Frontend API consumer requests a route that has no matching backend provider handler."
      );
    },
    whatItMeans:
      "A frontend component or client service attempts to communicate with an endpoint that is not implemented or not registered within the analyzed backend routes.",
    whyItMatters:
      "Client requests to this endpoint will fail at runtime with a 404 Not Found error or network failure, resulting in broken user interface actions or failed workflows.",
    whyNoAutomatedFix: () =>
      "Automatically scaffolding backend routes is unsafe because route implementation requires domain logic, authentication/authorization rules, database models, and response structures that static analysis cannot reliably infer.",
    suggestedSteps: () => [
      "Verify whether the backend route is implemented in an unanalyzed file or external service outside this repository.",
      "Check the frontend request URL and HTTP method for typos, obsolete path segments, or missing base URL prefixes.",
      "Implement the missing route handler in the appropriate backend router or controller.",
      "If the frontend call is obsolete or experimental, remove or update the client request."
    ],
    defaultResolutionMode: "guided"
  },

  UND110: {
    title: UND110_REFERENCE_GUIDANCE.title,
    baseWhatDetected: (input) => {
      if (input.method && input.route) {
        return `Backend route ${input.method} '${input.route}' is declared and active, but has no matching frontend consumer call in the analyzed workspace.`;
      }
      return UND110_REFERENCE_GUIDANCE.whatDetected;
    },
    conciseExplanation: (input) => {
      if (input.method && input.route) {
        return `No matching frontend request was identified for \`${input.method} ${input.route}\` in the analyzed workspace.\n\nThis does not necessarily indicate dead code. The endpoint may be consumed by external applications, services or scheduled jobs.`;
      }
      return UND110_REFERENCE_GUIDANCE.conciseExplanation!;
    },
    whatItMeans: UND110_REFERENCE_GUIDANCE.whatItMeans,
    whyItMatters: UND110_REFERENCE_GUIDANCE.whyItMatters,
    whyNoAutomatedFix: () => UND110_REFERENCE_GUIDANCE.whyNoAutomatedFix!,
    conciseFixUnavailableReason: () => UND110_REFERENCE_GUIDANCE.conciseFixUnavailableReason!,
    suggestedSteps: () => UND110_REFERENCE_GUIDANCE.suggestedSteps,
    defaultResolutionMode: "investigation"
  },

  UND120: {
    title: "HTTP Method Conflict",
    baseWhatDetected: (input) => {
      const exp = input.expectedDescription ?? input.method ?? "one HTTP method";
      const obs = input.observedDescription ?? "a different HTTP method";
      if (input.route) {
        return `HTTP method conflict on '${input.route}': frontend consumer calls ${exp}, but backend provider accepts ${obs}.`;
      }
      return (
        input.summary ??
        `HTTP method conflict: frontend consumer calls ${exp}, but backend provider accepts ${obs}.`
      );
    },
    whatItMeans:
      "The frontend consumer and backend provider agree on the route path, but use conflicting HTTP methods (e.g. GET vs POST, or PUT vs PATCH).",
    whyItMatters:
      "Requests will fail at runtime with a 405 Method Not Allowed or 404 Not Found error, blocking the API communication.",
    whyNoAutomatedFix: (hasFix) =>
      hasFix
        ? "Automated repair proposals are available for this finding."
        : "No automated safe repair proposals are available for this finding. Method evidence could not be determined conservatively without ambiguity. Manual inspection and repair is required.",
    suggestedSteps: (input) => [
      `Check whether the frontend request method (${input.expectedDescription ?? input.method ?? "HTTP method"}) matches the intended REST semantics.`,
      `Update the frontend fetch/axios call to use the method accepted by the backend route handler (${input.observedDescription ?? "backend method"}).`,
      "Or update the backend router to accept the method requested by the frontend, ensuring idempotency and payload semantics match."
    ],
    defaultResolutionMode: "automatic"
  },

  UND130: {
    title: "Suspected Route Mismatch",
    baseWhatDetected: (input) => {
      if (input.expectedDescription && input.observedDescription) {
        return `Suspected route path mismatch: frontend consumer calls '${input.expectedDescription}', but closest backend provider route is '${input.observedDescription}'.`;
      }
      return (
        input.summary ??
        "Suspected route path mismatch between frontend consumer and backend provider."
      );
    },
    whatItMeans:
      "The consumer and provider routes match on HTTP method and share a similar path structure, but differ by a single static segment or minor spelling variation.",
    whyItMatters:
      "The client request will fail at runtime with a 404 Not Found error due to the differing path segment.",
    whyNoAutomatedFix: () =>
      "Automatically renaming the route on either client or server is unsafe because changing public backend routes can break other clients, while changing frontend code may alter intended routing without architectural review.",
    suggestedSteps: (input) => [
      `Compare the differing URL segment between frontend call ('${input.expectedDescription ?? "consumer path"}') and backend route ('${input.observedDescription ?? "provider path"}').`,
      "Determine whether the client or server contains the spelling error or outdated path segment.",
      "Correct the misspelled segment in the appropriate file to align contracts."
    ],
    defaultResolutionMode: "guided"
  },

  UND200: {
    title: "Missing Required Request Field",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "a required field";
      if (input.route) {
        return `Consumer request payload to '${input.route}' omits required field ${fieldDesc}.`;
      }
      return input.summary ?? `Consumer request payload omits required field ${fieldDesc}.`;
    },
    whatItMeans:
      "The backend route expects a mandatory field in the request body or query, but the frontend request payload does not provide it.",
    whyItMatters:
      "The server will reject the request with a 400 Bad Request, unprocessable entity, or throw an unhandled schema validation error.",
    whyNoAutomatedFix: () =>
      "Automatically inserting a field into the frontend payload requires knowing the business domain value or user input source, which static analysis cannot fabricate safely.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the missing field";
      return [
        `Inspect the backend route handler to identify how ${fieldDesc} is used and whether default values are supported.`,
        `If mandatory, update the frontend request payload to supply ${fieldDesc} with valid data.`,
        `If optional, update the backend schema or controller to provide a default value or mark ${fieldDesc} as optional.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND210: {
    title: "Request Field Type Mismatch",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "request field";
      const exp = input.expectedDescription ?? "expected type";
      const obs = input.observedDescription ?? "observed type";
      return (
        input.summary ??
        `Consumer sends type '${obs}' for field ${fieldDesc}, but backend expects '${exp}'.`
      );
    },
    whatItMeans:
      "The frontend serializes a request field as one data type, while the backend deserializes or validates it as an incompatible data type.",
    whyItMatters:
      "The server may reject the payload with validation errors, or subtle runtime bugs may occur during calculations, database persistence, or JSON parsing.",
    whyNoAutomatedFix: () =>
      "Type conversion requires business domain context (e.g. should a number string be parsed with parseInt/parseFloat, or should the backend accept string representations?).",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the request field";
      return [
        `Check the type expectations at both frontend dispatch and backend deserialization for ${fieldDesc}.`,
        `Update the frontend payload to serialize ${fieldDesc} as type '${input.expectedDescription ?? "expected type"}'.`,
        `Or update the backend validator/schema to accept '${input.observedDescription ?? "observed type"}' or coerce it safely.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND220: {
    title: "Request Nullability or Optionality Conflict",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "request field";
      const obs = input.observedDescription ?? "optional/nullable";
      const exp = input.expectedDescription ?? "non-null required";
      return (
        input.summary ??
        `Request field ${fieldDesc} conflict: frontend allows '${obs}', but backend requires '${exp}'.`
      );
    },
    whatItMeans:
      "The frontend treats the request property as optional or nullable, but the backend requires a non-null, defined value.",
    whyItMatters:
      "Sending null or omitting the field will trigger backend validation rejections or null pointer exceptions in route handlers.",
    whyNoAutomatedFix: () =>
      "Safe resolution requires knowing whether the backend should tolerate nulls or whether the frontend must guard against null before dispatch.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the request field";
      return [
        `Determine whether the business domain permits ${fieldDesc} to be omitted or null.`,
        `If the field is optional, update the backend route to provide a fallback default or accept null.`,
        `If the field is mandatory, add client-side validation to ensure a valid non-null value is always supplied before dispatch.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND300: {
    title: "Expected Response Field Missing",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "expected field";
      if (input.route) {
        return `Consumer expects response field ${fieldDesc} from '${input.route}', but provider response omits it.`;
      }
      return input.summary ?? `Backend response does not produce expected field ${fieldDesc}.`;
    },
    whatItMeans:
      "Frontend consumer code or types expect a property in the JSON response body, but the backend handler never returns that property in its response.",
    whyItMatters:
      "Frontend code accessing `response.data[field]` will receive `undefined`, which may lead to blank UI components or runtime TypeError exceptions.",
    whyNoAutomatedFix: () =>
      "Deciding whether the backend should compute and return the field or whether the frontend should stop expecting it requires product and domain knowledge.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the response field";
      return [
        `Inspect backend response construction (database projection, DTO serializer, or res.json) for ${fieldDesc}.`,
        `If the backend should supply it, add ${fieldDesc} to the returned object.`,
        `If the field is deprecated or calculated elsewhere, update frontend consumers to remove the expectation or provide a fallback.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND310: {
    title: "Response Field Type Mismatch",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      const obs = input.observedDescription ?? "observed type";
      const exp = input.expectedDescription ?? "expected type";
      return (
        input.summary ??
        `Backend produces type '${obs}' for response field ${fieldDesc}, but frontend expects '${exp}'.`
      );
    },
    whatItMeans:
      "The backend returns a response field with a data type incompatible with what the frontend expects (e.g. date string vs timestamp number).",
    whyItMatters:
      "Frontend components may crash during formatting, mathematical operations, or strict type checks when receiving an unexpected type.",
    whyNoAutomatedFix: () =>
      "Changing response serialization affects all consumers of that endpoint; changing client parsing requires knowing UI expectations.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the response field";
      return [
        `Verify the intended contract specification for ${fieldDesc} between frontend and backend teams.`,
        `Update backend serialization or DTO mapping to output '${input.expectedDescription ?? "expected type"}'.`,
        `Or update frontend response handling/types to deserialize or transform '${input.observedDescription ?? "observed type"}' correctly.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND320: {
    title: "Response Optionality Conflict",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      return (
        input.summary ??
        `Backend may omit response field ${fieldDesc}, but frontend expects it to be unconditionally present.`
      );
    },
    whatItMeans:
      "In certain execution branches or conditions, the backend response omits this field, but frontend code expects it to always exist.",
    whyItMatters:
      "When the backend omits the field, frontend code accessing it without optional chaining will encounter `undefined` and may crash.",
    whyNoAutomatedFix: () =>
      "Automatic code fixes cannot determine whether the backend branch omitting the field is intentional or whether client defensive checks are appropriate.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the response field";
      return [
        `Add optional chaining (?.) or fallback defaults in frontend code accessing ${fieldDesc}.`,
        `Or ensure all backend route branches unconditionally include ${fieldDesc} in the response object.`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND330: {
    title: "Response Nullability Conflict",
    baseWhatDetected: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      return (
        input.summary ??
        `Backend may return null for response field ${fieldDesc}, but frontend assumes a non-null value.`
      );
    },
    whatItMeans:
      "The backend returns null under certain conditions (e.g. nullable database column), but the frontend expects a valid non-null value.",
    whyItMatters:
      "Accessing nested sub-properties on a null value at runtime triggers `TypeError: Cannot read properties of null`.",
    whyNoAutomatedFix: () =>
      "Resolving nullability requires either handling null gracefully in the UI or preventing null in the backend database/model.",
    suggestedSteps: (input) => {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "the response field";
      return [
        `Update frontend code to handle null values gracefully using null checks or nullish coalescing (??).`,
        `Or ensure backend query or serialization transforms null values into safe defaults (e.g. empty string or list).`
      ];
    },
    defaultResolutionMode: "guided"
  },

  UND900: {
    title: "Unsupported Framework Pattern",
    baseWhatDetected: (input) =>
      input.summary ?? "An unsupported syntax or framework pattern limits contract extraction.",
    whatItMeans:
      "The source code uses a framework pattern or dynamic construct that is outside UNDRIFT's V1 static analysis scope.",
    whyItMatters:
      "Endpoints or contracts affected by this construct cannot be verified. Absence of findings cannot be taken as proof of compatibility.",
    whyNoAutomatedFix: () =>
      "Refactoring application architecture or framework idioms requires developer design decisions.",
    suggestedSteps: () => [
      "Inspect the source file for dynamic route or payload patterns.",
      "Consider restructuring route declarations to follow standard Express, Next.js, fetch, or Axios conventions supported by UNDRIFT.",
      "Review the UNDRIFT documentation for supported framework patterns."
    ],
    defaultResolutionMode: "investigation"
  },

  UND910: {
    title: "Unresolved Reference or Type",
    baseWhatDetected: (input) =>
      input.summary ??
      "A type declaration, import, or symbol reference could not be statically resolved.",
    whatItMeans:
      "UNDRIFT could not trace a symbol reference to a supported local or imported declaration within the analyzed workspace scope.",
    whyItMatters:
      "Field shapes or route properties depending on this reference cannot be verified for contract drift.",
    whyNoAutomatedFix: () =>
      "Resolving external or missing symbols requires developer insight into project structure and dependencies.",
    suggestedSteps: () => [
      "Verify that the referenced type or variable is exported and located within the analyzed workspace.",
      "Check for missing module imports or uncompiled TypeScript declaration files.",
      "Provide explicit inline type annotations or simplify indirection where possible."
    ],
    defaultResolutionMode: "investigation"
  },

  UND920: {
    title: "Syntax Error or Incomplete Scope",
    baseWhatDetected: (input) =>
      input.summary ??
      "A syntax parse error or scope limitation prevented complete analysis of the file.",
    whatItMeans:
      "The parser encountered a syntax error or the file scope was incomplete, preventing AST generation or complete analysis.",
    whyItMatters:
      "Analysis is incomplete for this file; absence of findings cannot be considered proof of contract compatibility.",
    whyNoAutomatedFix: () => "Syntax errors must be corrected in the source code by the developer.",
    suggestedSteps: () => [
      "Open the affected file and fix any syntax or compile errors.",
      "Verify file permissions and encoding.",
      "Re-run workspace analysis to restore full coverage."
    ],
    defaultResolutionMode: "investigation"
  }
};

const WARNING_TEMPLATES: Record<
  WarningCode,
  {
    readonly title: string;
    readonly whatDetected: string;
    readonly whatItMeans: string;
    readonly whyItMatters: string;
    readonly whyNoAutomatedFix: string;
    readonly suggestedSteps: readonly string[];
  }
> = {
  DYNAMIC_ROUTE: {
    title: "Dynamic Route Parameter",
    whatDetected:
      "Route contains dynamic path expressions or variables that could not be statically resolved to literal strings.",
    whatItMeans:
      "Static analysis could not extract a fixed route pattern because the URL is dynamically computed at runtime.",
    whyItMatters:
      "UNDRIFT cannot verify contract alignment for routes whose paths cannot be statically determined, which may leave potential contract drift undetected.",
    whyNoAutomatedFix:
      "Static analysis cannot predict runtime URL values without evaluating application state.",
    suggestedSteps: [
      "Use parameterized route templates (e.g. `/api/users/:id` or `/api/users/[id]`) rather than arbitrary runtime string concatenations.",
      "Declare route constants or centralized API endpoint maps to facilitate static extraction.",
      "Verify that corresponding backend routes exist for expected runtime path parameters."
    ]
  },
  PARTIAL_SHAPE: {
    title: "Partial Request Shape",
    whatDetected:
      "Static inference established only a partial request contract due to dynamic typing, forwarding, or multipart construction.",
    whatItMeans:
      "Some request properties were extracted, but static analysis could not guarantee complete coverage of the payload.",
    whyItMatters:
      "Unextracted fields cannot be checked for missing properties or type mismatches against backend requirements.",
    whyNoAutomatedFix:
      "Fabricating request types without source annotations is unsafe and prone to false certainty.",
    suggestedSteps: [
      "Check the specific reason code associated with this warning for targeted remediation.",
      "Provide explicit TypeScript interface annotations on API helper parameters.",
      "Use strongly-typed request DTOs at the boundary between frontend views and API helpers."
    ]
  },
  PARSE_ERROR: {
    title: "Syntax Parse Error",
    whatDetected:
      "Tree-sitter parser failed to build a valid AST for this file due to syntax errors.",
    whatItMeans:
      "The source file contains invalid syntax or unsupported language features that prevented parsing.",
    whyItMatters: "Endpoints or contracts in this file cannot be extracted or verified.",
    whyNoAutomatedFix: "Syntax errors must be resolved by the developer.",
    suggestedSteps: [
      "Open the file and resolve any syntax or compilation errors reported by the editor.",
      "Ensure valid ECMAScript or TypeScript syntax."
    ]
  },
  UNSUPPORTED_PATTERN: {
    title: "Unsupported Pattern",
    whatDetected:
      "An unsupported router or client construction pattern was encountered during analysis.",
    whatItMeans:
      "The code uses idioms or wrapper libraries outside UNDRIFT's supported V1 pattern catalog.",
    whyItMatters: "Contracts declared with this pattern are omitted from drift verification.",
    whyNoAutomatedFix:
      "Pattern refactoring requires architectural choices by the development team.",
    suggestedSteps: [
      "Consult UNDRIFT documentation for supported route and client conventions.",
      "Consider refactoring to standard Express, Next.js, fetch, or Axios usage."
    ]
  },
  UNRESOLVED_REFERENCE: {
    title: "Unresolved Reference",
    whatDetected:
      "A symbol, type, or imported constant could not be statically resolved in the workspace index.",
    whatItMeans: "The declaration for this identifier was not found in the analyzed project scope.",
    whyItMatters: "Properties and contracts depending on this reference remain unverified.",
    whyNoAutomatedFix: "External or missing references cannot be inferred safely.",
    suggestedSteps: [
      "Check that all project files and dependencies are included in the analyzed workspace.",
      "Verify tsconfig.json path aliases and module resolution settings."
    ]
  },
  INCOMPLETE_SCOPE: {
    title: "Incomplete Analysis Scope",
    whatDetected: "A file was omitted or unreadable during workspace indexing.",
    whatItMeans: "File acquisition failed due to I/O constraints or ignore rules.",
    whyItMatters:
      "Analysis results may be incomplete, meaning missing findings cannot be considered proof of compatibility.",
    whyNoAutomatedFix: "Scope boundaries are governed by workspace and filesystem configuration.",
    suggestedSteps: [
      "Verify file permissions and file readability.",
      "Check .gitignore or workspace exclusion settings."
    ]
  },
  CONFIGURATION_ERROR: {
    title: "Configuration Error",
    whatDetected: "Workspace configuration prevents proper contract verification.",
    whatItMeans: "Invalid or conflicting project configuration was detected.",
    whyItMatters: "Contract verification cannot run reliably.",
    whyNoAutomatedFix: "Configuration issues require developer environment updates.",
    suggestedSteps: [
      "Verify project tsconfig.json, jsconfig.json, or package.json settings.",
      "Check UNDRIFT extension settings in VS Code."
    ]
  },
  ANALYZER_FAILURE: {
    title: "Analyzer Internal Exception",
    whatDetected:
      "An unexpected exception occurred inside the language analyzer while processing a file.",
    whatItMeans: "Internal error in the static analyzer.",
    whyItMatters: "Analysis for this file was interrupted.",
    whyNoAutomatedFix: "Analyzer exceptions cannot be resolved by code edits.",
    suggestedSteps: [
      "Check the UNDRIFT output channel in VS Code for diagnostic stack traces.",
      "Report the issue with the offending code snippet."
    ]
  }
};

const PARTIAL_SHAPE_REASON_TEMPLATES: Record<
  string,
  {
    readonly title: string;
    readonly whatDetected: string;
    readonly whatItMeans: string;
    readonly whyItMatters: string;
    readonly whyNoAutomatedFix: string;
    readonly suggestedSteps: readonly string[];
  }
> = {
  "explicit-unknown-type": {
    title: "Explicit Unknown Type",
    whatDetected: "Payload parameter or variable is explicitly annotated as TypeScript 'unknown'.",
    whatItMeans:
      "The 'unknown' type intentionally conceals property structure from static analysis.",
    whyItMatters:
      "Field-level schema validation, missing fields, and type mismatches cannot be checked.",
    whyNoAutomatedFix: "Concrete types cannot be fabricated safely without domain specifications.",
    suggestedSteps: [
      "Replace 'unknown' with an explicit TypeScript interface or type alias defining the expected payload schema.",
      "Or use schema validation libraries like Zod or Yup with static type inference (`z.infer<typeof Schema>`)."
    ]
  },
  "explicit-any-type": {
    title: "Explicit Any Type",
    whatDetected: "Payload parameter or variable is explicitly annotated as TypeScript 'any'.",
    whatItMeans:
      "Using 'any' disables TypeScript type checking and prevents UNDRIFT from extracting request field contracts.",
    whyItMatters: "Contract drift cannot be detected for unconstrained 'any' payloads.",
    whyNoAutomatedFix: "Automated typing cannot guess the intended payload fields safely.",
    suggestedSteps: [
      "Replace 'any' with a strongly-typed DTO interface or type alias.",
      "Define the required request properties and their primitive types explicitly."
    ]
  },
  "unannotated-parameter": {
    title: "Unannotated Parameter",
    whatDetected: "API helper parameter lacks type annotations and has no local caller evidence.",
    whatItMeans:
      "The parameter type cannot be deduced because neither a type signature nor a local invocation exists.",
    whyItMatters:
      "Payload fields passed to this parameter cannot be validated against the backend schema.",
    whyNoAutomatedFix: "Parameter structure depends on external caller intentions.",
    suggestedSteps: [
      "Add an explicit TypeScript type annotation or JSDoc `@param` tag to the function parameter.",
      "Ensure call sites within the workspace supply typed arguments."
    ]
  },
  "cross-module-forwarding": {
    title: "Cross-Module Forwarding",
    whatDetected:
      "Request payload originates from an external module or exported function parameter.",
    whatItMeans:
      "The payload is constructed in another module and forwarded without in-file structural evidence.",
    whyItMatters:
      "Static inference boundary prevents cross-module dataflow resolution without whole-program call-graph analysis.",
    whyNoAutomatedFix: "Cross-module dataflow requires global project architecture decisions.",
    suggestedSteps: [
      "Declare an explicit TypeScript interface for the forwarded request payload at the module boundary.",
      "Import and type the payload parameter using shared DTO types."
    ]
  },
  "no-caller-evidence": {
    title: "No Caller Evidence",
    whatDetected: "Exported API helper function has no caller invocations within the same file.",
    whatItMeans:
      "Because no local callers invoke the exported helper, argument values cannot be inferred from usage.",
    whyItMatters: "Helper payload shape remains partial without call-site argument inference.",
    whyNoAutomatedFix: "Exported helpers may be consumed by external applications or packages.",
    suggestedSteps: [
      "Annotate the helper function parameters with concrete TypeScript interfaces.",
      "Inspect where the helper is invoked across the project to align types."
    ]
  },
  "multipart-no-construction-evidence": {
    title: "FormData Construction Not Found",
    whatDetected:
      "FormData instance was passed without discoverable construction or field append mutations in the analyzed scope.",
    whatItMeans:
      "A FormData parameter is passed to the request transport, but static analysis could not establish where the instance is created or populated from the available source evidence.",
    whyItMatters:
      "Multipart request fields and file uploads cannot be verified against backend route expectations without evidence of what is appended.",
    whyNoAutomatedFix:
      "Multipart field names and file keys cannot be determined without evidence of where FormData was populated.",
    suggestedSteps: [
      "Trace this FormData parameter through its callers and locate where the instance is created and populated. Verify which fields are appended or set. UNDRIFT could not establish the multipart payload from the available source evidence.",
      "If caller evidence is unavailable or only partial across module boundaries, inspect call sites to confirm what form fields and file attachments are dispatched."
    ]
  },
  "multipart-partial-field-evidence": {
    title: "Partial FormData Fields",
    whatDetected:
      "Some FormData fields were extracted, but others may be conditionally appended or dynamically named.",
    whatItMeans:
      "FormData is partially understood, but conditional branches or dynamic keys prevent complete extraction.",
    whyItMatters:
      "Optional or conditional multipart fields may cause unexpected server validation errors if omitted.",
    whyNoAutomatedFix: "Dynamic branch conditions cannot be evaluated statically.",
    suggestedSteps: [
      "Verify that all required form fields are appended unconditionally.",
      "Check conditional append logic to ensure all server-expected fields are provided."
    ]
  },
  "dynamic-property": {
    title: "Dynamic Object Property",
    whatDetected: "Payload object contains computed property names (`[expression]: value`).",
    whatItMeans:
      "Computed property keys evaluate dynamically at runtime and cannot be verified statically.",
    whyItMatters: "Computed keys cannot be matched against static backend parameter names.",
    whyNoAutomatedFix: "Runtime property names cannot be safely determined at analysis time.",
    suggestedSteps: [
      "Use literal property keys for standard API payload fields where possible.",
      "Define a TypeScript interface describing all possible computed property keys."
    ]
  },
  "unsupported-expression": {
    title: "Unsupported Expression In Payload",
    whatDetected:
      "Payload contains complex expressions, object spreads on non-literals, or method calls.",
    whatItMeans: "Expression exceeds the static evaluation capabilities of the analyzer.",
    whyItMatters: "Fields generated by dynamic expressions cannot be validated for drift.",
    whyNoAutomatedFix:
      "Complex runtime expressions cannot be safely transformed without semantic loss.",
    suggestedSteps: [
      "Simplify the payload construction to plain object literals or typed interfaces.",
      "Avoid spreading dynamically returned objects directly into request bodies."
    ]
  },
  "unresolved-reference": {
    title: "Unresolved Payload Reference",
    whatDetected: "Payload identifier or imported object could not be resolved in the workspace.",
    whatItMeans: "The analyzer cannot trace the variable to its declaration or type definition.",
    whyItMatters: "The payload structure remains unknown.",
    whyNoAutomatedFix: "Missing symbols cannot be resolved without human guidance.",
    suggestedSteps: [
      "Ensure the referenced symbol is exported and defined within the analyzed project files.",
      "Check import paths and module resolutions in tsconfig.json."
    ]
  }
};

/**
 * Returns contextual, production-grade DiagnosticGuidance for any finding or rule.
 * Safely falls back to structured general guidance for unknown rule codes without throwing.
 */
export function getDiagnosticGuidance(input: ContextualGuidanceInput): DiagnosticGuidance {
  const ruleId = input.ruleId as RuleId;
  const template = RULE_TEMPLATES[ruleId];

  if (!template) {
    return {
      ruleCode: input.ruleId,
      title: `Contract Finding [${input.ruleId}]`,
      whatDetected: input.summary ?? "A contract discrepancy or analysis limitation was detected.",
      whatItMeans:
        "UNDRIFT identified an inconsistency between frontend and backend contract expectations.",
      whyItMatters:
        "Contract drift can cause runtime errors, unexpected responses, or broken integrations.",
      whyNoAutomatedFix:
        "Automated repair is not available for this finding. Human review of both frontend and backend contracts is required.",
      suggestedSteps: [
        "Inspect the source locations identified in the finding.",
        "Review both frontend consumer and backend provider contract expectations.",
        "Align the route, method, or payload contracts between frontend and backend."
      ],
      resolutionMode: "investigation"
    };
  }

  const hasFix = input.hasAutomatedFix;
  let resolutionMode: ResolutionMode = template.defaultResolutionMode;
  if (ruleId === "UND120") {
    resolutionMode = hasFix ? "automatic" : "guided";
  }

  return {
    ruleCode: input.ruleId,
    title: template.title,
    whatDetected: template.baseWhatDetected(input),
    whatItMeans: template.whatItMeans,
    whyItMatters: input.possibleImpact ?? template.whyItMatters,
    whyNoAutomatedFix: template.whyNoAutomatedFix(hasFix),
    conciseExplanation: template.conciseExplanation?.(input),
    conciseFixUnavailableReason: template.conciseFixUnavailableReason?.(hasFix),
    suggestedSteps: template.suggestedSteps(input),
    resolutionMode
  };
}

/**
 * Returns contextual guidance for an AnalysisWarning code and optional reasonCode.
 */
export function getWarningGuidance(
  code: WarningCode | string,
  reasonCode?: string
): DiagnosticGuidance {
  if (code === "PARTIAL_SHAPE" && reasonCode && PARTIAL_SHAPE_REASON_TEMPLATES[reasonCode]) {
    const reasonTmpl = PARTIAL_SHAPE_REASON_TEMPLATES[reasonCode];
    return {
      ruleCode: `PARTIAL_SHAPE:${reasonCode}`,
      title: reasonTmpl.title,
      whatDetected: reasonTmpl.whatDetected,
      whatItMeans: reasonTmpl.whatItMeans,
      whyItMatters: reasonTmpl.whyItMatters,
      whyNoAutomatedFix: reasonTmpl.whyNoAutomatedFix,
      suggestedSteps: reasonTmpl.suggestedSteps,
      resolutionMode: "guided"
    };
  }

  const warnCode = code as WarningCode;
  const warnTmpl = WARNING_TEMPLATES[warnCode];
  if (warnTmpl) {
    return {
      ruleCode: code,
      title: warnTmpl.title,
      whatDetected: warnTmpl.whatDetected,
      whatItMeans: warnTmpl.whatItMeans,
      whyItMatters: warnTmpl.whyItMatters,
      whyNoAutomatedFix: warnTmpl.whyNoAutomatedFix,
      suggestedSteps: warnTmpl.suggestedSteps,
      resolutionMode: "investigation"
    };
  }

  return {
    ruleCode: code,
    title: `Analysis Warning [${code}]`,
    whatDetected: `Analysis limitation or diagnostic warning '${code}' was recorded.`,
    whatItMeans: "Static analysis encountered a condition that limits full contract extraction.",
    whyItMatters: "Conclusions for affected contracts may be partial or unverified.",
    whyNoAutomatedFix:
      "Analysis limitations require inspection of source patterns and configuration.",
    suggestedSteps: [
      "Review the source location where the warning was recorded.",
      "Check UNDRIFT documentation for supported conventions.",
      "Ensure valid syntax and exported type declarations."
    ],
    resolutionMode: "investigation"
  };
}

/**
 * Returns all static diagnostic guidances for core rules.
 */
export function getAllRuleGuidances(): readonly DiagnosticGuidance[] {
  return (Object.keys(RULE_TEMPLATES) as RuleId[]).map((ruleId) =>
    getDiagnosticGuidance({ ruleId })
  );
}
