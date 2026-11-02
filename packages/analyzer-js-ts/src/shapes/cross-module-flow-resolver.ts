// Bounded, deterministic cross-module payload dataflow resolver
// Resolves payload arguments flowing across module boundaries, React hooks,
// and JSX component callback props to upstream object literals.

import * as path from "path";
import type {
  DocumentUri,
  EvidenceRef,
  FieldShape,
  ParsedDocument,
  SourceDocument,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import type {
  LocalDeclarationIndex,
  LocalVariableDeclaration
} from "../project-index/local-declaration-index";
import { extractObjectFields, type ShapeFieldResolver } from "./shape-extractor";

export interface CrossModuleFlowResolutionResult {
  readonly status: "resolved" | "conflicting" | "dynamic" | "none";
  readonly properties?: readonly FieldShape[];
  readonly evidence?: readonly EvidenceRef[];
  readonly sourceOrigin?: {
    readonly documentUri: DocumentUri;
    readonly node: SyntaxNode;
  };
  readonly reason?: string;
}

export interface FlowResolutionOptions {
  readonly pathHint?: string;
  readonly callNode?: SyntaxNode;
  readonly maxDepth?: number;
}

/**
 * Normalizes a file path or URI for comparison (forward slashes, lowercase on Windows).
 */
function normalizePath(p: string): string {
  if (!p || typeof p !== "string") return "";
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Matches an import module specifier from importingUri to a target document URI.
 */
export function matchesModuleSpecifier(
  importingUri: DocumentUri,
  specifier: string,
  targetUri: DocumentUri
): boolean {
  if (!importingUri || !specifier || !targetUri || typeof specifier !== "string") {
    return false;
  }
  if (!specifier.startsWith(".")) {
    // Check non-relative alias if applicable (e.g. '@/...' or '~/...')
    if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      const trimmedSpec = specifier.slice(2);
      const normTarget = normalizePath(targetUri.replace(/^file:\/\/\/?/, ""));
      return (
        normTarget.endsWith(normalizePath(trimmedSpec)) ||
        normTarget.endsWith(normalizePath(trimmedSpec) + ".js") ||
        normTarget.endsWith(normalizePath(trimmedSpec) + ".jsx") ||
        normTarget.endsWith(normalizePath(trimmedSpec) + ".ts") ||
        normTarget.endsWith(normalizePath(trimmedSpec) + ".tsx")
      );
    }
    return false;
  }

  const impPath = "/" + importingUri.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/");
  const importingDir = path.posix.dirname(impPath);
  const resolved = path.posix.resolve(importingDir, specifier);
  const normTarget = normalizePath(
    "/" + targetUri.replace(/^file:\/\/\/?/, "").replace(/\\/g, "/")
  );
  const normResolved = normalizePath(resolved);

  return (
    normResolved === normTarget ||
    normResolved + ".js" === normTarget ||
    normResolved + ".jsx" === normTarget ||
    normResolved + ".ts" === normTarget ||
    normResolved + ".tsx" === normTarget ||
    normResolved + "/index.js" === normTarget ||
    normResolved + "/index.jsx" === normTarget ||
    normResolved + "/index.ts" === normTarget ||
    normResolved + "/index.tsx" === normTarget
  );
}

/**
 * Bounded cross-module payload dataflow resolver.
 */
export class CrossModuleFlowResolver {
  private readonly maxDepth: number;

  constructor(
    private readonly index: LocalDeclarationIndex,
    maxDepth = 5
  ) {
    this.maxDepth = maxDepth;
  }

  /**
   * Resolves forwarded payload shape for parameter index of a given function across modules.
   */
  resolvePayloadFlow(
    fnName: string,
    paramIndex: number,
    documentUri: DocumentUri,
    options?: FlowResolutionOptions
  ): CrossModuleFlowResolutionResult {
    const visited = new Set<string>();
    return this.resolveParamInternal(
      documentUri,
      fnName,
      paramIndex,
      options?.pathHint,
      0,
      visited
    );
  }

  private resolveParamInternal(
    targetDocUri: DocumentUri,
    fnName: string,
    paramIndex: number,
    pathHint?: string,
    depth = 0,
    visited = new Set<string>()
  ): CrossModuleFlowResolutionResult {
    const key = `${targetDocUri}::${fnName}::${paramIndex}::${pathHint || ""}`;
    if (depth > this.maxDepth || visited.has(key)) {
      return { status: "dynamic", reason: "Max recursion depth or cycle detected" };
    }
    visited.add(key);

    // 1. Look up all declarations of fnName
    const allDecls = this.index.lookupSymbols(fnName);

    // 2. Find imports of fnName in other documents that import from targetDocUri
    const importDecls = allDecls.filter(
      (d) =>
        d.kind === "import" &&
        matchesModuleSpecifier(d.documentUri, d.moduleSpecifier, targetDocUri)
    );

    const candidateShapes: FieldShape[][] = [];
    const candidateEvidence: EvidenceRef[] = [];
    let hasDynamic = false;
    let foundCall = false;

    for (const imp of importDecls) {
      const impDocUri = imp.documentUri;
      const parsed = this.index.getParsedDocument(impDocUri);
      if (!parsed) continue;

      const localImportName = imp.name;
      const calls = this.findCallsToIdentifier(parsed.root, localImportName);

      for (const call of calls) {
        foundCall = true;
        const args = this.getCallArguments(call);
        if (paramIndex < args.length) {
          const arg = args[paramIndex];
          const res = this.resolveArgumentNode(
            arg,
            impDocUri,
            parsed,
            pathHint,
            depth + 1,
            visited
          );

          if (res.status === "resolved" && res.properties) {
            candidateShapes.push([...res.properties]);
            if (res.evidence) candidateEvidence.push(...res.evidence);
          } else if (res.status === "dynamic") {
            hasDynamic = true;
          }
        } else {
          hasDynamic = true;
        }
      }
    }

    if (!foundCall) {
      return { status: "none" };
    }

    if (candidateShapes.length === 0) {
      return { status: hasDynamic ? "dynamic" : "none" };
    }

    // Merge candidate shapes conservatively
    const merged = this.mergeCallsiteShapes(candidateShapes);
    if (!merged) {
      return { status: "conflicting" };
    }

    return {
      status: "resolved",
      properties: merged,
      evidence: candidateEvidence
    };
  }

  /**
   * Resolves an argument AST node in a given document to an object field shape.
   */
  resolveArgumentNode(
    argNode: SyntaxNode | undefined,
    docUri: DocumentUri,
    parsed: ParsedDocument,
    pathHint?: string,
    depth = 0,
    visited = new Set<string>()
  ): CrossModuleFlowResolutionResult {
    if (!argNode) {
      return { status: "none" };
    }

    const doc = this.index.getDocument(docUri);
    const mapper = doc ? new PositionMapper(doc.text, docUri) : undefined;

    // Case 1: Object literal directly
    if (argNode.kind === "object") {
      if (!mapper) return { status: "dynamic" };
      const fields = extractObjectFields(argNode, docUri, mapper);
      const evidence: EvidenceRef = {
        id: `ev-cross-payload-${argNode.range.start}`,
        kind: "literal-syntax",
        strength: "direct",
        source: mapper.toSourceSpanFromUtf16(argNode.range.start, argNode.range.end, docUri),
        description: `Direct object literal payload in ${docUri}`
      };
      return {
        status: "resolved",
        properties: fields,
        evidence: [evidence],
        sourceOrigin: { documentUri: docUri, node: argNode }
      };
    }

    // Case 2: Identifier
    if (argNode.kind === "identifier") {
      const identName = argNode.text();

      // 2a. Check if local variable declared as object literal or useState or ternary
      const localDecls = this.index.getDeclarationsForDocument(docUri);
      const varDecl = localDecls.find(
        (d): d is LocalVariableDeclaration => d.kind === "variable" && d.name === identName
      );

      if (varDecl?.objectFields && varDecl.objectFields.length > 0) {
        return {
          status: "resolved",
          properties: varDecl.objectFields,
          evidence: [varDecl.evidence]
        };
      }

      if (varDecl?.initializerNode) {
        const init = varDecl.initializerNode;
        if (init.kind === "object" && mapper) {
          const fields = extractObjectFields(init, docUri, mapper);
          const evidence: EvidenceRef = {
            id: `ev-cross-payload-${init.range.start}`,
            kind: "local-declaration",
            strength: "direct",
            source: mapper.toSourceSpanFromUtf16(init.range.start, init.range.end, docUri),
            description: `Object literal payload bound to '${identName}' in ${docUri}`
          };
          return {
            status: "resolved",
            properties: fields,
            evidence: [evidence, varDecl.evidence],
            sourceOrigin: { documentUri: docUri, node: init }
          };
        }

        if (init.kind === "ternary_expression") {
          return this.resolveArgumentNode(init, docUri, parsed, pathHint, depth + 1, visited);
        }

        // Check useState call: const [formData, setFormData] = useState(initialFormState)
        if (init.kind === "call_expression") {
          const callee = init.childForField("function");
          if (callee?.text() === "useState") {
            const uArgs = init.childForField("arguments")?.namedChildren() ?? [];
            if (uArgs.length > 0) {
              if (uArgs[0].kind === "object" && mapper) {
                const fields = extractObjectFields(uArgs[0], docUri, mapper);
                return {
                  status: "resolved",
                  properties: fields,
                  evidence: [varDecl.evidence],
                  sourceOrigin: { documentUri: docUri, node: uArgs[0] }
                };
              }
              if (uArgs[0].kind === "identifier") {
                const initDecl = localDecls.find(
                  (d): d is LocalVariableDeclaration =>
                    d.kind === "variable" && d.name === uArgs[0].text()
                );
                if (initDecl?.objectFields && initDecl.objectFields.length > 0) {
                  return {
                    status: "resolved",
                    properties: initDecl.objectFields,
                    evidence: [initDecl.evidence]
                  };
                }
                if (initDecl?.initializerNode?.kind === "object" && mapper) {
                  const fields = extractObjectFields(initDecl.initializerNode, docUri, mapper);
                  return {
                    status: "resolved",
                    properties: fields,
                    evidence: [initDecl.evidence],
                    sourceOrigin: { documentUri: docUri, node: initDecl.initializerNode }
                  };
                }
              }
            }
          }
        }
      }

      // 2b. Check if identName is parameter of enclosing function
      const enclosing = this.findEnclosingFunction(argNode);
      if (enclosing) {
        const pIndex = enclosing.params.indexOf(identName);
        if (pIndex >= 0) {
          // Subcase A: Returned from a custom hook/function
          const returnInfo = this.findReturnContainer(enclosing.fnNode, enclosing.name);
          if (returnInfo) {
            const hookCalls = this.findHookUsages(docUri, returnInfo.hookName, returnInfo.propName);
            for (const hc of hookCalls) {
              const res = this.resolveArgumentNode(
                hc.argNode,
                hc.docUri,
                hc.parsed,
                pathHint,
                depth + 1,
                visited
              );
              if (res.status === "resolved") return res;
            }
          }

          // Subcase B: Passed as JSX prop callback
          const jsxUsages = this.findJsxPropUsages(docUri, enclosing.name);
          for (const ju of jsxUsages) {
            const res = this.resolveComponentPropCall(
              ju.componentName,
              ju.propName,
              ju.docUri,
              pathHint,
              depth + 1,
              visited
            );
            if (res.status === "resolved") return res;
          }

          // Subcase C: Exported function called across modules
          if (enclosing.name) {
            const res = this.resolveParamInternal(
              docUri,
              enclosing.name,
              pIndex,
              pathHint,
              depth + 1,
              visited
            );
            if (res.status === "resolved") return res;
          }
        }
      }
    }

    // Case 3: Ternary expression (cond ? A : B)
    if (argNode.kind === "ternary_expression") {
      const con = argNode.childForField("consequence");
      const alt = argNode.childForField("alternative");

      if (pathHint === "signup" || pathHint === "register") {
        return this.resolveArgumentNode(con, docUri, parsed, pathHint, depth + 1, visited);
      }
      if (pathHint === "login") {
        return this.resolveArgumentNode(alt, docUri, parsed, pathHint, depth + 1, visited);
      }

      // When no hint, evaluate both branches and merge conservatively
      const conRes = this.resolveArgumentNode(con, docUri, parsed, pathHint, depth + 1, visited);
      const altRes = this.resolveArgumentNode(alt, docUri, parsed, pathHint, depth + 1, visited);

      if (
        conRes.status === "resolved" &&
        conRes.properties &&
        altRes.status === "resolved" &&
        altRes.properties
      ) {
        const merged = this.mergeCallsiteShapes([
          conRes.properties as FieldShape[],
          altRes.properties as FieldShape[]
        ]);
        if (merged) {
          return {
            status: "resolved",
            properties: merged,
            evidence: [...(conRes.evidence ?? []), ...(altRes.evidence ?? [])]
          };
        }
      } else if (conRes.status === "resolved") {
        return conRes;
      } else if (altRes.status === "resolved") {
        return altRes;
      }
    }

    return { status: "none" };
  }

  private findCallsToIdentifier(rootNode: SyntaxNode, targetName: string): SyntaxNode[] {
    const calls: SyntaxNode[] = [];
    function walk(n: SyntaxNode) {
      if (n.kind === "call_expression") {
        const fn = n.childForField("function");
        if (fn?.kind === "identifier" && fn.text() === targetName) {
          calls.push(n);
        }
      }
      for (const c of n.namedChildren()) walk(c);
    }
    walk(rootNode);
    return calls;
  }

  private getCallArguments(callNode: SyntaxNode): readonly SyntaxNode[] {
    return callNode.childForField("arguments")?.namedChildren() ?? [];
  }

  private findEnclosingFunction(
    node: SyntaxNode
  ): { fnNode: SyntaxNode; name?: string; params: string[] } | undefined {
    let curr: SyntaxNode | undefined = node.parent();
    while (curr) {
      if (
        curr.kind === "function_declaration" ||
        curr.kind === "arrow_function" ||
        curr.kind === "function_expression"
      ) {
        let name: string | undefined;
        const nameNode = curr.childForField("name");
        if (nameNode?.kind === "identifier") {
          name = nameNode.text();
        } else if (curr.parent()?.kind === "variable_declarator") {
          const varName = curr.parent()?.childForField("name");
          if (varName?.kind === "identifier") name = varName.text();
        }

        const paramsNode =
          curr.childForField("parameters") ??
          curr.namedChildren().find((c) => c.kind === "formal_parameters");
        const params: string[] = [];
        if (paramsNode) {
          for (const p of paramsNode.namedChildren()) {
            if (p.kind === "identifier") {
              params.push(p.text());
            } else if (p.kind === "required_parameter" || p.kind === "optional_parameter") {
              const pat = p.childForField("pattern") ?? p.namedChildren()[0];
              if (pat?.kind === "identifier") params.push(pat.text());
            }
          }
        }
        return { fnNode: curr, name, params };
      }
      curr = curr.parent();
    }
    return undefined;
  }

  private findReturnContainer(
    fnNode: SyntaxNode,
    localFnName?: string
  ): { hookName: string; propName: string } | undefined {
    if (!localFnName) return undefined;
    let parent: SyntaxNode | undefined = fnNode.parent();
    while (parent) {
      if (parent.kind === "function_declaration" || parent.kind === "variable_declarator") {
        const hookName = parent.childForField("name")?.text();
        if (hookName && hookName.startsWith("use")) {
          let propName = localFnName;
          function searchReturn(n: SyntaxNode) {
            if (n.kind === "return_statement") {
              const arg = n.childForField("argument") ?? n.namedChildren()[0];
              if (arg && arg.kind === "object") {
                for (const child of arg.namedChildren()) {
                  if (
                    child.kind === "shorthand_property_identifier" &&
                    child.text() === localFnName
                  ) {
                    propName = child.text();
                  } else if (child.kind === "pair") {
                    const k = child.childForField("key")?.text();
                    const v = child.childForField("value")?.text();
                    if (v === localFnName && k) propName = k;
                  }
                }
              }
            }
            for (const c of n.namedChildren()) searchReturn(c);
          }
          searchReturn(parent);
          if (propName) return { hookName, propName };
        }
      }
      parent = parent.parent();
    }
    return undefined;
  }

  private findHookUsages(
    hookDocUri: DocumentUri,
    hookName: string,
    propName: string
  ): Array<{ docUri: DocumentUri; parsed: ParsedDocument; argNode: SyntaxNode }> {
    const results: Array<{ docUri: DocumentUri; parsed: ParsedDocument; argNode: SyntaxNode }> = [];
    const hookDecls = this.index.lookupSymbols(hookName);
    const imports = hookDecls.filter(
      (d) =>
        d.kind === "import" && matchesModuleSpecifier(d.documentUri, d.moduleSpecifier, hookDocUri)
    );

    for (const imp of imports) {
      const impDocUri = imp.documentUri;
      const parsed = this.index.getParsedDocument(impDocUri);
      if (!parsed) continue;

      // Find calls: const state = useHook()
      function walk(n: SyntaxNode) {
        if (n.kind === "variable_declarator") {
          const val = n.childForField("value");
          if (val && val.kind === "call_expression") {
            const fn = val.childForField("function");
            if (fn?.text() === imp.name) {
              const varNameNode = n.childForField("name");
              if (varNameNode?.kind === "identifier") {
                const stateVarName = varNameNode.text();
                // Find calls to stateVarName.propName(...)
                function findPropCalls(m: SyntaxNode) {
                  if (m.kind === "call_expression") {
                    const cfn = m.childForField("function");
                    if (cfn?.kind === "member_expression") {
                      const obj = cfn.childForField("object") ?? cfn.namedChildren()[0];
                      const prop = cfn.childForField("property") ?? cfn.namedChildren()[1];
                      if (obj?.text() === stateVarName && prop?.text() === propName) {
                        const args = m.childForField("arguments")?.namedChildren() ?? [];
                        if (args.length > 0) {
                          results.push({ docUri: impDocUri, parsed: parsed!, argNode: args[0] });
                        }
                      }
                    }
                  }
                  for (const c of m.namedChildren()) findPropCalls(c);
                }
                findPropCalls(parsed!.root);
              } else if (varNameNode?.kind === "object_pattern") {
                // Destructured pattern e.g. const { addTransaction } = useTransactions();
                for (const elem of varNameNode.namedChildren()) {
                  let boundPropName: string | undefined;
                  if (elem.kind === "shorthand_property_identifier_pattern") {
                    if (elem.text() === propName) boundPropName = elem.text();
                  } else if (elem.kind === "pair_pattern") {
                    const k = elem.childForField("key")?.text();
                    const v = elem.childForField("value")?.text();
                    if (k === propName && v) boundPropName = v;
                  }
                  if (boundPropName) {
                    function findDestructuredCalls(m: SyntaxNode) {
                      if (m.kind === "call_expression") {
                        const cfn = m.childForField("function");
                        if (cfn?.kind === "identifier" && cfn.text() === boundPropName) {
                          const args = m.childForField("arguments")?.namedChildren() ?? [];
                          if (args.length > 0) {
                            results.push({ docUri: impDocUri, parsed: parsed!, argNode: args[0] });
                          }
                        }
                      }
                      for (const c of m.namedChildren()) findDestructuredCalls(c);
                    }
                    findDestructuredCalls(parsed!.root);
                  }
                }
              }
            }
          }
        }
        for (const c of n.namedChildren()) walk(c);
      }
      walk(parsed.root);
    }
    return results;
  }

  private findJsxPropUsages(
    containerDocUri: DocumentUri,
    handlerName?: string
  ): Array<{ componentName: string; propName: string; docUri: DocumentUri }> {
    if (!handlerName) return [];
    const results: Array<{ componentName: string; propName: string; docUri: DocumentUri }> = [];
    const parsed = this.index.getParsedDocument(containerDocUri);
    if (!parsed) return results;

    function walk(n: SyntaxNode) {
      if (n.kind === "jsx_element" || n.kind === "jsx_self_closing_element") {
        const openTag = n.childForField("open_tag") ?? n;
        const tagNameNode = openTag.childForField("name") ?? openTag.namedChildren()[0];
        const componentName = tagNameNode?.text();

        if (componentName) {
          for (const child of openTag.namedChildren()) {
            if (child.kind === "jsx_attribute") {
              const propNameNode = child.childForField("name") ?? child.namedChildren()[0];
              const valNode = child.childForField("value") ?? child.namedChildren()[1];
              const propName = propNameNode?.text();

              if (valNode?.kind === "jsx_expression" && propName) {
                const expr = valNode.namedChildren()[0];
                if (expr?.kind === "identifier" && expr.text() === handlerName) {
                  results.push({ componentName, propName, docUri: containerDocUri });
                }
              }
            }
          }
        }
      }
      for (const c of n.namedChildren()) walk(c);
    }
    walk(parsed.root);
    return results;
  }

  private resolveComponentPropCall(
    componentName: string,
    propName: string,
    callerDocUri: DocumentUri,
    pathHint?: string,
    depth = 0,
    visited = new Set<string>()
  ): CrossModuleFlowResolutionResult {
    const decls = this.index.getDeclarationsForDocument(callerDocUri);
    const impDecl = decls.find((d) => d.kind === "import" && d.name === componentName);
    if (!impDecl || impDecl.kind !== "import") {
      return { status: "none" };
    }

    // Find component document URI across index
    const allUris = this.index.getAllTrackedUris();
    let compDocUri: DocumentUri | undefined;
    for (const uri of allUris) {
      if (matchesModuleSpecifier(callerDocUri, impDecl.moduleSpecifier, uri)) {
        compDocUri = uri;
        break;
      }
    }
    if (!compDocUri) return { status: "none" };

    const compParsed = this.index.getParsedDocument(compDocUri);
    if (!compParsed) return { status: "none" };

    let shapeResult: CrossModuleFlowResolutionResult = { status: "none" };

    const walk = (n: SyntaxNode): void => {
      if (n.kind === "call_expression") {
        const fn = n.childForField("function");
        if (fn?.kind === "identifier" && fn.text() === propName) {
          const args = n.childForField("arguments")?.namedChildren() ?? [];
          if (args.length > 0) {
            shapeResult = this.resolveArgumentNode(
              args[0],
              compDocUri,
              compParsed,
              pathHint,
              depth + 1,
              visited
            );
          }
        }
      }
      for (const c of n.namedChildren()) walk(c);
    };
    walk(compParsed.root);
    return shapeResult;
  }

  /**
   * Merges field shapes across multiple callsites conservatively.
   */
  private mergeCallsiteShapes(candidateShapes: FieldShape[][]): FieldShape[] | undefined {
    if (candidateShapes.length === 0) return undefined;
    if (candidateShapes.length === 1) return candidateShapes[0];

    // Find all unique field names
    const allFieldNames = new Set<string>();
    for (const shape of candidateShapes) {
      for (const f of shape) {
        allFieldNames.add(f.name);
      }
    }

    const merged: FieldShape[] = [];
    for (const name of allFieldNames) {
      // Check presence across all callsites
      const presentCount = candidateShapes.filter((shape) =>
        shape.some((f) => f.name === name)
      ).length;
      const isUnconditional = presentCount === candidateShapes.length;

      // Find first occurrence to get type and evidence
      let representative: FieldShape | undefined;
      const collectedEvidence: EvidenceRef[] = [];

      for (const shape of candidateShapes) {
        const found = shape.find((f) => f.name === name);
        if (found) {
          if (!representative) representative = found;
          if (found.evidence) collectedEvidence.push(...found.evidence);
        }
      }

      if (representative) {
        merged.push({
          ...representative,
          presence: isUnconditional ? representative.presence : "optional",
          evidence: collectedEvidence.length > 0 ? collectedEvidence : representative.evidence
        });
      }
    }

    return merged;
  }
}
