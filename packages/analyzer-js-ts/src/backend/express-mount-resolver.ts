// Express router mount resolver as specified in UNDRIFT Phase 6.
// Discovers app.use(prefix, router) and router.use(prefix, childRouter) mount declarations,
// resolves imported/required router files across workspace documents, and computes effective routes.

import type {
  DocumentUri,
  EvidenceRef,
  ParsedDocument,
  SourceDocument,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";

export interface ExpressMountInfo {
  readonly mountingDocUri: DocumentUri;
  readonly mountPrefix: string;
  readonly targetModuleSpecifier?: string;
  readonly targetDocUri?: DocumentUri;
  readonly targetRouterName?: string;
  readonly isDynamic?: boolean;
  readonly dynamicReason?: string;
  readonly sourceSpan: SourceSpan;
}

/**
 * Normalizes document URIs and paths to use forward slashes.
 */
export function normalizePath(pathStr: string): string {
  return pathStr.replace(/\\/g, "/");
}

/**
 * Combines a mount prefix and a child route path into an effective path.
 * Ensures no duplicate or missing slashes and prevents prefix duplication.
 */
export function combineRoutePaths(prefix: string, childPath: string): string {
  const normPrefix = prefix.trim();
  const normChild = childPath.trim();

  if (!normPrefix || normPrefix === "/") {
    return normChild.startsWith("/") ? normChild : "/" + normChild;
  }
  if (!normChild || normChild === "/") {
    return normPrefix.startsWith("/") ? normPrefix : "/" + normPrefix;
  }

  const cleanPrefix = normPrefix.startsWith("/")
    ? normPrefix.replace(/\/+$/, "")
    : "/" + normPrefix.replace(/\/+$/, "");

  const cleanChild = normChild.startsWith("/") ? normChild : "/" + normChild;

  // If child already begins with the prefix, avoid duplicating it
  if (cleanChild === cleanPrefix || cleanChild.startsWith(cleanPrefix + "/")) {
    return cleanChild;
  }

  return cleanPrefix + cleanChild;
}

/**
 * Resolves a relative module specifier (e.g. './routes/authRoutes.js')
 * against the directory of the mounting document.
 */
export function resolveRelativeSpecifier(
  mountingDocUri: DocumentUri,
  moduleSpecifier: string,
  knownDocUris: Iterable<DocumentUri>
): DocumentUri | undefined {
  if (!moduleSpecifier.startsWith(".")) {
    return undefined;
  }

  const normMountingUri = normalizePath(mountingDocUri);
  let prefix = "";
  let pathOnly = normMountingUri;

  if (normMountingUri.startsWith("file:///")) {
    prefix = "file:///";
    pathOnly = normMountingUri.slice(8);
  } else if (normMountingUri.startsWith("file://")) {
    prefix = "file://";
    pathOnly = normMountingUri.slice(7);
  } else if (normMountingUri.startsWith("/")) {
    prefix = "/";
    pathOnly = normMountingUri.slice(1);
  }

  const lastSlash = pathOnly.lastIndexOf("/");
  const dir = lastSlash >= 0 ? pathOnly.slice(0, lastSlash) : "";

  // Normalize path segments (handles ./ and ../)
  const parts = (dir ? dir.split("/") : []).concat(moduleSpecifier.split("/"));
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolvedParts.pop();
    } else {
      resolvedParts.push(part);
    }
  }

  const candidateBase = prefix + resolvedParts.join("/");

  // Try direct match, standard extensions (.js, .ts, .jsx, .tsx, /index.js, /index.ts)
  const candidateExtensions = [
    "",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".mjs",
    ".cjs",
    "/index.js",
    "/index.ts"
  ];

  const knownList = Array.from(knownDocUris).map((u) => ({
    original: u,
    normalized: normalizePath(u)
  }));

  for (const ext of candidateExtensions) {
    const candidate = candidateBase + ext;
    const match = knownList.find(
      (k) =>
        k.normalized === candidate ||
        k.normalized.endsWith("/" + candidate) ||
        candidate.endsWith("/" + k.normalized)
    );
    if (match) {
      return match.original;
    }
  }

  // Fallback: return candidate with .js extension if not in knownList
  const fallbackExt =
    candidateBase.endsWith(".js") ||
    candidateBase.endsWith(".ts") ||
    candidateBase.endsWith(".jsx") ||
    candidateBase.endsWith(".tsx")
      ? ""
      : ".js";
  return candidateBase + fallbackExt;
}

/**
 * Scans a parsed document for imports and requires, returning a map of bound names to module specifiers.
 */
export function extractImportMap(parsed: ParsedDocument): Map<string, string> {
  const importMap = new Map<string, string>();

  function walk(node: SyntaxNode): void {
    // 1. ES import statement: import router from './path'; or import { router } from './path';
    if (node.kind === "import_statement") {
      const sourceNode = node.childForField("source");
      if (sourceNode && sourceNode.kind === "string") {
        const specifier = sourceNode.text().slice(1, -1);
        const clause = node.namedChildren().find((c) => c.kind === "import_clause");
        if (clause) {
          for (const child of clause.namedChildren()) {
            if (child.kind === "identifier") {
              importMap.set(child.text(), specifier);
            } else if (child.kind === "named_imports") {
              for (const spec of child.namedChildren()) {
                if (spec.kind === "import_specifier") {
                  const nameChild = spec.childForField("name") ?? spec.namedChildren()[0];
                  const aliasChild = spec.childForField("alias") ?? spec.namedChildren()[1];
                  const bound = aliasChild ? aliasChild.text() : nameChild?.text();
                  if (bound) {
                    importMap.set(bound, specifier);
                  }
                }
              }
            }
          }
        }
      }
      return;
    }

    // 2. CommonJS require: const router = require('./path');
    if (node.kind === "variable_declarator") {
      const nameNode = node.childForField("name") ?? node.namedChildren()[0];
      const valNode = node.childForField("value") ?? node.namedChildren()[1];
      if (nameNode && valNode && valNode.kind === "call_expression") {
        const fn = valNode.childForField("function") ?? valNode.namedChildren()[0];
        const args = valNode.childForField("arguments")?.namedChildren() ?? [];
        if (fn?.text() === "require" && args.length > 0 && args[0].kind === "string") {
          const specifier = args[0].text().slice(1, -1);
          if (nameNode.kind === "identifier") {
            importMap.set(nameNode.text(), specifier);
          }
        }
      }
    }

    for (const child of node.namedChildren()) {
      walk(child);
    }
  }

  walk(parsed.root);
  return importMap;
}

/**
 * Discovers Express mount calls: `app.use(prefix, router)` or `router.use(prefix, childRouter)`.
 */
export function discoverExpressMounts(
  document: SourceDocument,
  parsed: ParsedDocument,
  knownDocUris: Iterable<DocumentUri>
): ExpressMountInfo[] {
  const mounts: ExpressMountInfo[] = [];
  const mapper = new PositionMapper(document.text, document.uri);
  const importMap = extractImportMap(parsed);

  function walk(node: SyntaxNode): void {
    if (node.kind === "call_expression") {
      const fnNode = node.childForField("function") ?? node.namedChildren()[0];
      if (fnNode && fnNode.kind === "member_expression") {
        const propNode = fnNode.childForField("property") ?? fnNode.namedChildren()[1];
        const objNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];

        if (propNode?.text() === "use" && objNode) {
          const receiver = objNode.text();
          // Express receivers commonly named app, router, server, or custom router variables
          const isExpressReceiver =
            receiver === "app" ||
            receiver === "router" ||
            receiver === "server" ||
            receiver.toLowerCase().includes("router") ||
            receiver.toLowerCase().includes("app");

          if (isExpressReceiver) {
            const argsNode = node.childForField("arguments");
            const args = argsNode ? argsNode.namedChildren() : [];

            // A route mount requires at least 2 arguments: prefix and router handler
            // e.g. app.use('/api/users', userRoutes) or app.use('/api', require('./routes'))
            if (args.length >= 2) {
              const prefixArg = args[0];
              const routerArg = args[args.length - 1]; // target router is typically the last arg

              let mountPrefix: string | undefined;
              let isDynamic = false;
              let dynamicReason: string | undefined;

              if (prefixArg.kind === "string") {
                const raw = prefixArg.text().slice(1, -1);
                // Must start with '/' to be an Express route mount prefix
                if (raw.startsWith("/")) {
                  mountPrefix = raw;
                }
              } else if (prefixArg.kind === "template_string") {
                // Static template without substitutions
                const subs = prefixArg
                  .namedChildren()
                  .filter((c) => c.kind === "template_substitution");
                if (subs.length === 0) {
                  const raw = prefixArg.text().slice(1, -1);
                  if (raw.startsWith("/")) {
                    mountPrefix = raw;
                  }
                } else {
                  isDynamic = true;
                  dynamicReason = `Dynamic mount prefix template in Express use(): ${prefixArg.text()}`;
                }
              } else {
                isDynamic = true;
                dynamicReason = `Dynamic mount prefix expression in Express use(): ${prefixArg.text()}`;
              }

              if (mountPrefix || isDynamic) {
                const callSpan = mapper.toSourceSpanFromUtf16(
                  node.range.start,
                  node.range.end,
                  document.uri
                );

                let targetModuleSpecifier: string | undefined;
                let targetDocUri: DocumentUri | undefined;
                let targetRouterName: string | undefined;

                // Case A: Inline require('./routes/...')
                if (routerArg.kind === "call_expression") {
                  const subFn = routerArg.childForField("function") ?? routerArg.namedChildren()[0];
                  const subArgs = routerArg.childForField("arguments")?.namedChildren() ?? [];
                  if (
                    subFn?.text() === "require" &&
                    subArgs.length > 0 &&
                    subArgs[0].kind === "string"
                  ) {
                    targetModuleSpecifier = subArgs[0].text().slice(1, -1);
                    targetDocUri = resolveRelativeSpecifier(
                      document.uri,
                      targetModuleSpecifier,
                      knownDocUris
                    );
                  }
                } else if (routerArg.kind === "identifier") {
                  // Case B: Identifier imported from module
                  const ident = routerArg.text();
                  targetRouterName = ident;
                  if (importMap.has(ident)) {
                    targetModuleSpecifier = importMap.get(ident);
                    if (targetModuleSpecifier) {
                      targetDocUri = resolveRelativeSpecifier(
                        document.uri,
                        targetModuleSpecifier,
                        knownDocUris
                      );
                    }
                  }
                }

                mounts.push({
                  mountingDocUri: document.uri,
                  mountPrefix: mountPrefix ?? "",
                  targetModuleSpecifier,
                  targetDocUri,
                  targetRouterName,
                  isDynamic,
                  dynamicReason,
                  sourceSpan: callSpan
                });
              }
            }
          }
        }
      }
    }

    for (const child of node.namedChildren()) {
      walk(child);
    }
  }

  walk(parsed.root);
  return mounts;
}

/**
 * Resolved router mount map for a workspace.
 * Maps document URIs and local router names to their effective mount prefixes and mount evidence.
 */
export class ExpressMountRegistry {
  private readonly documentMounts = new Map<
    DocumentUri,
    Array<{ prefix: string; mount: ExpressMountInfo }>
  >();

  private readonly localRouterMounts = new Map<
    string,
    Array<{ prefix: string; mount: ExpressMountInfo }>
  >();

  /**
   * Builds an ExpressMountRegistry by discovering mounts across all parsed workspace documents
   * and computing effective composite mount prefixes (resolving nested mounts).
   */
  public static build(
    entries: Array<{ document: SourceDocument; parsed: ParsedDocument }>
  ): ExpressMountRegistry {
    const registry = new ExpressMountRegistry();
    const docUris = entries.map((e) => e.document.uri);
    const allMounts: ExpressMountInfo[] = [];

    for (const entry of entries) {
      const mounts = discoverExpressMounts(entry.document, entry.parsed, docUris);
      allMounts.push(...mounts);
    }

    // Direct mounts: from mountingDoc -> targetDoc / targetRouter
    for (const mount of allMounts) {
      if (mount.targetDocUri) {
        registry.addDirectMount(mount.targetDocUri, mount.mountPrefix, mount);
      }
      if (mount.targetRouterName) {
        const key = `${normalizePath(mount.mountingDocUri)}#${mount.targetRouterName}`;
        registry.addLocalMount(key, mount.mountPrefix, mount);
      }
    }

    // Resolve nested mounts (e.g. server.js mounts cubit.routes.js at /api,
    // and cubit.routes.js mounts notification.routes.js at /notifications)
    // Compute transitive effective prefixes
    registry.resolveTransitiveMounts(allMounts);

    return registry;
  }

  private addDirectMount(targetDocUri: DocumentUri, prefix: string, mount: ExpressMountInfo): void {
    const norm = normalizePath(targetDocUri);
    const list = this.documentMounts.get(norm) ?? [];
    if (!list.some((item) => item.prefix === prefix)) {
      list.push({ prefix, mount });
      this.documentMounts.set(norm, list);
    }
  }

  private addLocalMount(key: string, prefix: string, mount: ExpressMountInfo): void {
    const list = this.localRouterMounts.get(key) ?? [];
    if (!list.some((item) => item.prefix === prefix)) {
      list.push({ prefix, mount });
      this.localRouterMounts.set(key, list);
    }
  }

  private resolveTransitiveMounts(allMounts: ExpressMountInfo[]): void {
    // For each document that is mounted, check if the mounting document itself is mounted
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const [targetDoc, mounts] of Array.from(this.documentMounts.entries())) {
        for (const currentItem of [...mounts]) {
          const { prefix, mount } = currentItem;
          const parentDoc = normalizePath(mount.mountingDocUri);
          const parentMounts = this.documentMounts.get(parentDoc);

          if (parentMounts && parentMounts.length > 0) {
            // Remove the bare intermediate prefix from targetList
            const targetList = this.documentMounts.get(targetDoc) ?? [];
            const itemIndex = targetList.indexOf(currentItem);
            if (itemIndex >= 0) {
              targetList.splice(itemIndex, 1);
            }

            for (const parent of parentMounts) {
              const compositePrefix = combineRoutePaths(parent.prefix, prefix);
              if (!targetList.some((item) => item.prefix === compositePrefix)) {
                targetList.push({ prefix: compositePrefix, mount });
                changed = true;
              }
            }
            this.documentMounts.set(targetDoc, targetList);
          }
        }
      }
    }
  }

  /**
   * Retrieves all effective mount prefixes for a document.
   */
  public getMountsForDocument(
    documentUri: DocumentUri
  ): Array<{ prefix: string; mount: ExpressMountInfo }> {
    const norm = normalizePath(documentUri);
    return this.documentMounts.get(norm) ?? [];
  }

  /**
   * Retrieves effective mount prefixes for a locally declared router in a document.
   */
  public getMountsForLocalRouter(
    documentUri: DocumentUri,
    routerName: string
  ): Array<{ prefix: string; mount: ExpressMountInfo }> {
    const key = `${normalizePath(documentUri)}#${routerName}`;
    return this.localRouterMounts.get(key) ?? [];
  }
}
