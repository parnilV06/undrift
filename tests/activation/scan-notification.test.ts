// Focused tests for scan command notification messages (Task A correction).
// Verifies that incomplete scan notifications accurately reflect acquisition failures
// and do not claim '0 files could not be acquired' when source acquisition succeeded.

import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: { registerCommand: vi.fn() },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
      show: vi.fn()
    }))
  }
}));

import { formatIncompleteScanMessage } from "../../apps/vscode-extension/src/extension";

describe("Scan Command Incomplete Notification", () => {
  it("does not report zero unacquired files when source acquisition succeeded", () => {
    const msg = formatIncompleteScanMessage(5, 2, 0);

    expect(msg).toBe("UNDRIFT: Analysis incomplete. Analyzed 5 files, found 2 findings.");
    expect(msg).not.toContain("could not be acquired");
    expect(msg).not.toContain("0 file");
  });

  it("reports failure count when files failed acquisition", () => {
    const msg = formatIncompleteScanMessage(3, 1, 2);

    expect(msg).toBe(
      "UNDRIFT: Analysis incomplete (2 files could not be acquired). Analyzed 3 files, found 1 finding."
    );
  });

  it("handles singular vs plural correctly for files and findings", () => {
    const singularAcquisitionFail = formatIncompleteScanMessage(1, 1, 1);
    expect(singularAcquisitionFail).toBe(
      "UNDRIFT: Analysis incomplete (1 file could not be acquired). Analyzed 1 file, found 1 finding."
    );

    const pluralAcquisitionFail = formatIncompleteScanMessage(4, 0, 3);
    expect(pluralAcquisitionFail).toBe(
      "UNDRIFT: Analysis incomplete (3 files could not be acquired). Analyzed 4 files, found 0 findings."
    );

    const zeroFindingsNoAcquisitionFail = formatIncompleteScanMessage(10, 0, 0);
    expect(zeroFindingsNoAcquisitionFail).toBe(
      "UNDRIFT: Analysis incomplete. Analyzed 10 files, found 0 findings."
    );
  });
});
