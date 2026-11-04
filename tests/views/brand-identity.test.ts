/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";

const { mockVsCodeModule } = vi.hoisted(() => {
  const mockVsCodeModule = {
    Uri: {
      parse: (val: string) => ({
        scheme: "file",
        path: val,
        toString: () => val
      }),
      file: (fsPath: string) => ({
        scheme: "file",
        path: fsPath,
        toString: () => `file://${fsPath}`
      }),
      joinPath: (base: any, ...segments: string[]) => ({
        scheme: base.scheme ?? "file",
        path: [base.path, ...segments].join("/"),
        toString: () => `${base.path}/${segments.join("/")}`
      })
    },
    window: {
      createWebviewPanel: vi.fn(),
      showInformationMessage: vi.fn()
    },
    commands: {
      executeCommand: vi.fn()
    }
  };
  return { mockVsCodeModule };
});

vi.mock("vscode", () => mockVsCodeModule);

import {
  OverviewViewProvider,
  renderOverviewHtml,
  type BrandLogoUris,
  type OverviewViewModel
} from "../../apps/vscode-extension/src/views/overview-view";
import {
  renderReportHtml,
  ReportPanelManager,
  type ReportViewModel
} from "../../apps/vscode-extension/src/views/report-panel";

describe("Brand Identity Integration: Official UNDRIFT Logo", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const extDir = path.join(rootDir, "apps/vscode-extension");
  const resDir = path.join(extDir, "resources");
  const distResDir = path.join(extDir, "dist/resources");

  describe("A. Brand Assets Existence & Properties", () => {
    it("ensures canonical master logo exists and matches UNDRIFT.png", () => {
      const rootPng = path.join(rootDir, "UNDRIFT.png");
      const resMaster = path.join(resDir, "undrift-master.png");

      expect(fs.existsSync(rootPng)).toBe(true);
      expect(fs.existsSync(resMaster)).toBe(true);
      const rootBuf = fs.readFileSync(rootPng);
      const resBuf = fs.readFileSync(resMaster);
      expect(resBuf.length).toBe(rootBuf.length);
    });

    it("provides valid light variant for dark IDE surfaces", () => {
      const lightPng = path.join(resDir, "undrift-light.png");
      expect(fs.existsSync(lightPng)).toBe(true);
      const buf = fs.readFileSync(lightPng);
      // PNG signature
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
      expect(buf.length).toBeGreaterThan(10000);
    });

    it("provides valid dark variant for light IDE surfaces", () => {
      const darkPng = path.join(resDir, "undrift-dark.png");
      expect(fs.existsSync(darkPng)).toBe(true);
      const buf = fs.readFileSync(darkPng);
      // PNG signature
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
      expect(buf.length).toBeGreaterThan(10000);
    });

    it("provides 128x128 high-res extension icon", () => {
      const iconPng = path.join(resDir, "undrift-icon.png");
      expect(fs.existsSync(iconPng)).toBe(true);
      const buf = fs.readFileSync(iconPng);
      // Read width and height from IHDR chunk
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(128);
      expect(height).toBe(128);
    });

    it("provides 24x24 single-color Activity Bar SVG derived from official logo", () => {
      const svgPath = path.join(resDir, "undrift.svg");
      expect(fs.existsSync(svgPath)).toBe(true);
      const content = fs.readFileSync(svgPath, "utf8");
      expect(content).toContain('viewBox="0 0 24 24"');
      expect(content).toContain('width="24"');
      expect(content).toContain('height="24"');
      expect(content).toContain("currentColor");
      // Must NOT contain generic placeholder circle tracks
      expect(content).not.toContain('cx="4.5" cy="6.5"');
      expect(content).not.toContain("Top track: Consumer API contract");
      // Must contain official vector paths
      expect(content).toContain("<path d=");
    });

    it("copies all brand assets into dist/resources/ upon build", () => {
      expect(fs.existsSync(path.join(distResDir, "undrift-master.png"))).toBe(true);
      expect(fs.existsSync(path.join(distResDir, "undrift-light.png"))).toBe(true);
      expect(fs.existsSync(path.join(distResDir, "undrift-dark.png"))).toBe(true);
      expect(fs.existsSync(path.join(distResDir, "undrift-icon.png"))).toBe(true);
      expect(fs.existsSync(path.join(distResDir, "undrift.svg"))).toBe(true);
    });
  });

  describe("B. Extension Manifest Registration", () => {
    it("configures official extension icon in package.json", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"));
      expect(pkg.icon).toBe("resources/undrift-icon.png");
    });

    it("configures official SVG icon for viewsContainers.activitybar", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"));
      const containers = pkg.contributes?.viewsContainers?.activitybar;
      expect(Array.isArray(containers)).toBe(true);
      const undriftContainer = containers.find((c: { id: string }) => c.id === "undrift");
      expect(undriftContainer).toBeDefined();
      expect(undriftContainer.icon).toBe("resources/undrift.svg");
    });
  });

  describe("C. Sidebar Overview Branding", () => {
    const sampleModel: OverviewViewModel = {
      workspaceLabel: "Demo Workspace",
      status: "freshly-verified",
      timestamp: new Date().toISOString(),
      findings: [],
      warnings: []
    };

    it("renders official logo beside UNDRIFT title with theme-adaptive variants", () => {
      const html = renderOverviewHtml(sampleModel);
      expect(html).toContain("brand-logo-container");
      expect(html).toContain("brand-logo-light");
      expect(html).toContain("brand-logo-dark");
      expect(html).toContain("undrift-light.png");
      expect(html).toContain("undrift-dark.png");
      expect(html).toContain("UNDRIFT");
    });

    it("supports custom webview resource URIs resolved via asWebviewUri", () => {
      const customUris: BrandLogoUris = {
        light: "vscode-webview://test-id/resources/undrift-light.png",
        dark: "vscode-webview://test-id/resources/undrift-dark.png"
      };
      const html = renderOverviewHtml(sampleModel, "test-nonce", customUris);
      expect(html).toContain('src="vscode-webview://test-id/resources/undrift-light.png"');
      expect(html).toContain('src="vscode-webview://test-id/resources/undrift-dark.png"');
    });

    it("includes theme-adaptive CSS rules hiding and showing appropriate variants", () => {
      const html = renderOverviewHtml(sampleModel);
      expect(html).toContain("body.vscode-light .brand-logo-light");
      expect(html).toContain("body.vscode-light .brand-logo-dark");
      expect(html).toContain("body.vscode-dark .brand-logo-light");
      expect(html).toContain("body.vscode-dark .brand-logo-dark");
      expect(html).toContain("body.vscode-high-contrast .brand-logo-light");
    });

    it("includes official logo in empty states", () => {
      const notScannedModel: OverviewViewModel = {
        workspaceLabel: "Empty WS",
        status: "no-analysis",
        findings: [],
        warnings: []
      };
      const html = renderOverviewHtml(notScannedModel);
      expect(html).toContain("empty-state-brand");
      expect(html).toContain("empty-state-logo");
    });

    it("configures webview CSP with img-src allowing webview resource and data URIs", () => {
      const html = renderOverviewHtml(sampleModel);
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("img-src");
      expect(html).toContain("data:");
    });
  });

  describe("D. Integration Report Branding", () => {
    const sampleReportModel: ReportViewModel = {
      workspaceLabel: "Demo Workspace",
      status: "freshly-verified",
      findings: [],
      history: [],
      warnings: []
    };

    it("renders official logo beside UNDRIFT Integration Report heading", () => {
      const html = renderReportHtml(sampleReportModel);
      expect(html).toContain("report-brand-logo-container");
      expect(html).toContain("report-brand-logo");
      expect(html).toContain("brand-logo-light");
      expect(html).toContain("brand-logo-dark");
      expect(html).toContain("UNDRIFT Integration Report");
      expect(html).toContain("undrift-light.png");
      expect(html).toContain("undrift-dark.png");
    });

    it("supports custom webview resource URIs resolved via asWebviewUri in report", () => {
      const customUris: BrandLogoUris = {
        light: "vscode-webview://test-report/resources/undrift-light.png",
        dark: "vscode-webview://test-report/resources/undrift-dark.png"
      };
      const html = renderReportHtml(sampleReportModel, "test-nonce", customUris);
      expect(html).toContain('src="vscode-webview://test-report/resources/undrift-light.png"');
      expect(html).toContain('src="vscode-webview://test-report/resources/undrift-dark.png"');
    });

    it("configures report CSP with img-src directive", () => {
      const html = renderReportHtml(sampleReportModel);
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("img-src");
      expect(html).toContain("data:");
    });
  });

  describe("E. Provider Integration & Dynamic Badge", () => {
    it("initializes OverviewViewProvider with extensionUri without throwing", () => {
      const mockUri = { path: extDir, fsPath: extDir } as any;
      const provider = new OverviewViewProvider({
        extensionUri: mockUri
      });
      expect(provider).toBeDefined();
    });

    it("initializes ReportPanelManager with extensionUri without throwing", () => {
      const mockUri = { path: extDir, fsPath: extDir } as any;
      const manager = new ReportPanelManager({
        extensionUri: mockUri
      });
      expect(manager).toBeDefined();
    });
  });
});
