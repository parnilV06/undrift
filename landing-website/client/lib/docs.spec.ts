import { describe, it, expect } from "vitest";
import { docGroups, docPages, getDocGroup, getAdjacentDocPages } from "./docs";

describe("docs structure and content integrity", () => {
  it("should contain all 7 documentation groups", () => {
    expect(docGroups.length).toBe(7);
    const groupIds = docGroups.map((g) => g.id);
    expect(groupIds).toEqual([
      "overview",
      "getting-started",
      "concepts",
      "drift-types",
      "analysis-engine",
      "compatibility",
      "reference",
    ]);
  });

  it("should contain at least 25 detailed pages across all groups", () => {
    expect(docPages.length).toBeGreaterThanOrEqual(25);
  });

  it("should have zero placeholder pages (every page has sections)", () => {
    for (const page of docPages) {
      expect(page.sections, `Page ${page.path} has undefined sections`).toBeDefined();
      expect(
        page.sections!.length,
        `Page ${page.path} has empty sections`,
      ).toBeGreaterThan(0);
    }
  });

  it("should have valid section ids, titles, and bodies for all pages", () => {
    for (const page of docPages) {
      for (const section of page.sections!) {
        expect(section.id, `Section in ${page.path} missing id`).toBeTruthy();
        expect(section.title, `Section in ${page.path} missing title`).toBeTruthy();
        expect(
          section.body.length,
          `Section ${section.id} in ${page.path} has empty body`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("should have all paths starting with /docs/", () => {
    for (const page of docPages) {
      expect(page.path.startsWith("/docs/")).toBe(true);
    }
  });

  it("should resolve doc groups correctly via getDocGroup", () => {
    const introGroup = getDocGroup("/docs/introduction");
    expect(introGroup).toBeDefined();
    expect(introGroup?.id).toBe("overview");

    const rulesGroup = getDocGroup("/docs/drift-types/http-method");
    expect(rulesGroup).toBeDefined();
    expect(rulesGroup?.id).toBe("drift-types");
  });

  it("should correctly compute adjacent pages for navigation", () => {
    const firstPage = docPages[0];
    const adjacentFirst = getAdjacentDocPages(firstPage.path);
    expect(adjacentFirst.previous).toBeUndefined();
    expect(adjacentFirst.next?.path).toBe(docPages[1].path);

    const secondPage = docPages[1];
    const adjacentSecond = getAdjacentDocPages(secondPage.path);
    expect(adjacentSecond.previous?.path).toBe(firstPage.path);
    expect(adjacentSecond.next?.path).toBe(docPages[2].path);
  });
});

