// Targeted test suite for Next.js App Router and Pages Router API route extraction
import { describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  deriveNextJsRouteInfo,
  extractNextJsObservations,
  NextJsExtractor
} from "@undrift/analyzer-js-ts";
import type { SourceDocument } from "@undrift/core";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string): SourceDocument {
  return {
    uri,
    languageId: uri.endsWith(".ts") || uri.endsWith(".tsx") ? "typescript" : "javascript",
    text,
    contentHash: "hash-" + uri
  };
}

describe("Next.js Provider Route Extraction", () => {
  describe("1. Route Path Derivation", () => {
    it("derives route path from App Router route.ts", () => {
      const info = deriveNextJsRouteInfo("app/api/users/route.ts");
      expect(info).toBeDefined();
      expect(info?.routerKind).toBe("app");
      expect(info?.routePattern.rawPath).toBe("/api/users");
      expect(info?.routePattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("derives dynamic parameter segments from App Router [id]", () => {
      const info = deriveNextJsRouteInfo("src/app/api/users/[userId]/route.ts");
      expect(info).toBeDefined();
      expect(info?.routerKind).toBe("app");
      expect(info?.routePattern.rawPath).toBe("/api/users/:userId");
      expect(info?.routePattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" },
        { kind: "parameter", name: "userId" }
      ]);
    });

    it("strips Next.js route groups like (auth) from App Router URLs", () => {
      const info = deriveNextJsRouteInfo("app/api/(auth)/login/route.ts");
      expect(info).toBeDefined();
      expect(info?.routePattern.rawPath).toBe("/api/login");
    });

    it("strips Next.js parallel route slots like @modal from App Router URLs", () => {
      const info = deriveNextJsRouteInfo("app/api/@slot/dashboard/route.ts");
      expect(info).toBeDefined();
      expect(info?.routePattern.rawPath).toBe("/api/dashboard");
    });

    it("handles catch-all route segments [...slug]", () => {
      const info = deriveNextJsRouteInfo("app/api/files/[...slug]/route.ts");
      expect(info).toBeDefined();
      expect(info?.routePattern.rawPath).toBe("/api/files/*");
      expect(info?.routePattern.segments[2]).toEqual({ kind: "wildcard" });
    });

    it("derives route path from Pages Router files", () => {
      const info = deriveNextJsRouteInfo("pages/api/posts.ts");
      expect(info).toBeDefined();
      expect(info?.routerKind).toBe("pages");
      expect(info?.routePattern.rawPath).toBe("/api/posts");
    });

    it("derives route path from Pages Router index and parameter files", () => {
      const indexInfo = deriveNextJsRouteInfo("pages/api/items/index.ts");
      expect(indexInfo?.routePattern.rawPath).toBe("/api/items");

      const paramInfo = deriveNextJsRouteInfo("pages/api/items/[id].ts");
      expect(paramInfo?.routePattern.rawPath).toBe("/api/items/:id");
    });

    it("returns undefined for non-Next.js route files", () => {
      expect(deriveNextJsRouteInfo("src/controllers/userController.ts")).toBeUndefined();
      expect(deriveNextJsRouteInfo("app/components/Header.tsx")).toBeUndefined();
    });
  });

  describe("2. App Router Named HTTP-Method Exports", () => {
    it("extracts named exported functions GET and POST", async () => {
      const code = `
        export async function GET(request: Request) {
          return Response.json({ status: "ok" });
        }
        export function POST(req: Request) {
          return Response.json({ created: true });
        }
      `;
      const doc = makeDoc("app/api/users/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);

      const [obsGet, obsPost] = result.observations;
      expect(obsGet.role).toBe("provider");
      expect(obsGet.framework).toBe("nextjs");
      expect(obsGet.endpoint.method.state).toBe("known");
      expect(obsGet.endpoint.method.value).toBe("GET");
      expect(obsGet.endpoint.path.state).toBe("known");
      expect(obsGet.endpoint.path.value?.rawPath).toBe("/api/users");

      expect(obsPost.endpoint.method.value).toBe("POST");
    });

    it("extracts exported constants and export specifiers", async () => {
      const code = `
        export const DELETE = async () => Response.json({ deleted: true });
        const PUT = async () => Response.json({ updated: true });
        export { PUT };
      `;
      const doc = makeDoc("app/api/items/[id]/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.observations).toHaveLength(2);
      const methods = result.observations.map((o) => o.endpoint.method.value).sort();
      expect(methods).toEqual(["DELETE", "PUT"]);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/items/:id");
    });

    it("extracts aliased App Router HTTP method exports (NextAuth pattern)", async () => {
      const code = `
        import NextAuth from "next-auth";
        const handler = NextAuth({ providers: [] });
        export { handler as GET, handler as POST };
      `;
      const doc = makeDoc("app/api/auth/[...nextauth]/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);
      const methods = result.observations.map((o) => o.endpoint.method.value).sort();
      expect(methods).toEqual(["GET", "POST"]);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/auth/*");
    });

    it("extracts object destructuring App Router HTTP method exports", async () => {
      const code = `
        const handlers = {
          GET: async () => Response.json({ ok: true }),
          POST: async () => Response.json({ created: true })
        };
        export const { GET, POST } = handlers;
      `;
      const doc = makeDoc("app/api/feed/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);
      const methods = result.observations.map((o) => o.endpoint.method.value).sort();
      expect(methods).toEqual(["GET", "POST"]);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/feed");
    });

    it("reports UNSUPPORTED_PATTERN warning when route.ts has no HTTP exports", async () => {
      const code = `
        export function helper() {
          return 42;
        }
      `;
      const doc = makeDoc("app/api/invalid/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.observations).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
      expect(result.warnings[0].scope).toBe("provider");
      expect(result.warnings[0].affectsCompleteness).toBe(true);
    });
  });

  describe("3. Pages Router Default Handler Method Dispatch", () => {
    it("extracts methods from switch (req.method) statements", async () => {
      const code = `
        export default function handler(req: any, res: any) {
          switch (req.method) {
            case "GET":
              return res.status(200).json([]);
            case "POST":
              return res.status(201).json({});
            default:
              return res.status(405).end();
          }
        }
      `;
      const doc = makeDoc("pages/api/todos.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);

      const methods = result.observations.map((o) => o.endpoint.method.value).sort();
      expect(methods).toEqual(["GET", "POST"]);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/todos");
    });

    it("extracts methods from if (req.method === '...') condition branches", async () => {
      const code = `
        export default function handler(req: any, res: any) {
          if (req.method === "DELETE") {
            return res.status(200).json({ success: true });
          } else if (req.method === "PATCH") {
            return res.status(200).json({ patched: true });
          }
        }
      `;
      const doc = makeDoc("pages/api/posts/[id].ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);
      const methods = result.observations.map((o) => o.endpoint.method.value).sort();
      expect(methods).toEqual(["DELETE", "PATCH"]);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/posts/:id");
    });

    it("reports UNSUPPORTED_PATTERN and does NOT invent methods for ambiguous handlers", async () => {
      const code = `
        export default function handler(req: any, res: any) {
          res.json({ message: "Hello world" });
        }
      `;
      const doc = makeDoc("pages/api/ambiguous.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.observations).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
      expect(result.warnings[0].scope).toBe("provider");
      expect(result.warnings[0].affectsCompleteness).toBe(true);
    });
  });

  describe("4. Phase 6.3: Safe Percent-Encoding & Dynamic Route Normalization", () => {
    it("normalizes App Router dynamic parameters from percent-encoded URIs (%5Bid%5D)", () => {
      const infoClasses = deriveNextJsRouteInfo(
        "file:///z:/OLD%20PC%20Files/parnil%20-%20My%20Files/SlotTrack/app/api/classes/%5Bid%5D/route.ts"
      );
      expect(infoClasses).toBeDefined();
      expect(infoClasses?.routePattern.rawPath).toBe("/api/classes/:id");
      expect(infoClasses?.routePattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "classes" },
        { kind: "parameter", name: "id" }
      ]);

      const infoBookings = deriveNextJsRouteInfo(
        "file:///project/app/api/bookings/%5Bid%5D/route.ts"
      );
      expect(infoBookings?.routePattern.rawPath).toBe("/api/bookings/:id");
    });

    it("normalizes App Router NextAuth catch-all from percent-encoded URI (%5B...nextauth%5D)", () => {
      const info = deriveNextJsRouteInfo("file:///project/app/api/auth/%5B...nextauth%5D/route.ts");
      expect(info).toBeDefined();
      expect(info?.routePattern.rawPath).toBe("/api/auth/*");
      expect(info?.routePattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "auth" },
        { kind: "wildcard" }
      ]);
    });

    it("normalizes App Router required catch-all [...slug] vs optional catch-all [[...slug]]", () => {
      const reqInfo = deriveNextJsRouteInfo("file:///app/api/posts/%5B...slug%5D/route.ts");
      expect(reqInfo?.routePattern.rawPath).toBe("/api/posts/*");
      expect(reqInfo?.routePattern.segments[2]).toEqual({ kind: "wildcard" });

      const optInfo = deriveNextJsRouteInfo("file:///app/api/docs/%5B%5B...slug%5D%5D/route.ts");
      expect(optInfo?.routePattern.rawPath).toBe("/api/docs/*?");
      expect(optInfo?.routePattern.segments[2]).toEqual({ kind: "wildcard", optional: true });
    });

    it("strips percent-encoded route groups (%28auth%29) and parallel routes (%40modal)", () => {
      const groupInfo = deriveNextJsRouteInfo(
        "file:///app/api/%28dashboard%29/analytics/%5Bid%5D/route.ts"
      );
      expect(groupInfo?.routePattern.rawPath).toBe("/api/analytics/:id");

      const parallelInfo = deriveNextJsRouteInfo("file:///app/api/%40modal/feed/route.ts");
      expect(parallelInfo?.routePattern.rawPath).toBe("/api/feed");
    });

    it("handles Windows file paths containing spaces and unencoded backslashes", () => {
      const winInfo = deriveNextJsRouteInfo(
        "C:\\Users\\John Doe\\My Projects\\app\\api\\classes\\[id]\\route.ts"
      );
      expect(winInfo?.routePattern.rawPath).toBe("/api/classes/:id");
    });

    it("normalizes Pages Router percent-encoded dynamic parameters and catch-alls", () => {
      const postInfo = deriveNextJsRouteInfo("file:///pages/api/posts/%5Bid%5D.ts");
      expect(postInfo?.routePattern.rawPath).toBe("/api/posts/:id");

      const optCatchAll = deriveNextJsRouteInfo("file:///pages/api/docs/%5B%5B...slug%5D%5D.ts");
      expect(optCatchAll?.routePattern.rawPath).toBe("/api/docs/*?");
      expect(optCatchAll?.routePattern.segments[2]).toEqual({ kind: "wildcard", optional: true });

      const indexInfo = deriveNextJsRouteInfo("file:///pages/api/items/%5Bid%5D/index.ts");
      expect(indexInfo?.routePattern.rawPath).toBe("/api/items/:id");
    });

    it("extracts observations from App Router handler with percent-encoded URI", async () => {
      const code = `
        export async function GET(req: Request) { return Response.json([]); }
        export async function PATCH(req: Request) { return Response.json({}); }
        export async function DELETE(req: Request) { return Response.json({}); }
      `;
      const doc = makeDoc("file:///app/api/classes/%5Bid%5D/route.ts", code);
      const parsed = await parser.parse({ document: doc });
      const result = extractNextJsObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(3);
      for (const obs of result.observations) {
        expect(obs.endpoint.path.value?.rawPath).toBe("/api/classes/:id");
        expect(obs.endpoint.path.value?.segments).toEqual([
          { kind: "static", value: "api" },
          { kind: "static", value: "classes" },
          { kind: "parameter", name: "id" }
        ]);
      }
    });
  });
});
