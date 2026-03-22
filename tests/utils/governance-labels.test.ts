import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_STATE_LABELS,
  GOVERNANCE_STATE_DESCRIPTIONS,
  EASY_TRACK_STATUS_LABELS,
} from "../../src/utils/governance-labels.js";

describe("governance-labels constants", () => {
  describe("GOVERNANCE_STATE_LABELS", () => {
    it("contains all 6 governance states (0-5)", () => {
      expect(Object.keys(GOVERNANCE_STATE_LABELS)).toHaveLength(6);
      for (let i = 0; i <= 5; i++) {
        expect(GOVERNANCE_STATE_LABELS[i]).toBeDefined();
        expect(typeof GOVERNANCE_STATE_LABELS[i]).toBe("string");
      }
    });

    it("maps 0 to NotInitialized", () => {
      expect(GOVERNANCE_STATE_LABELS[0]).toBe("NotInitialized");
    });

    it("maps 1 to Normal", () => {
      expect(GOVERNANCE_STATE_LABELS[1]).toBe("Normal");
    });

    it("maps 2 to VetoSignalling", () => {
      expect(GOVERNANCE_STATE_LABELS[2]).toBe("VetoSignalling");
    });

    it("maps 3 to VetoSignallingDeactivation", () => {
      expect(GOVERNANCE_STATE_LABELS[3]).toBe("VetoSignallingDeactivation");
    });

    it("maps 4 to VetoCooldown", () => {
      expect(GOVERNANCE_STATE_LABELS[4]).toBe("VetoCooldown");
    });

    it("maps 5 to RageQuit", () => {
      expect(GOVERNANCE_STATE_LABELS[5]).toBe("RageQuit");
    });

    it("returns undefined for out-of-range keys", () => {
      expect(GOVERNANCE_STATE_LABELS[6]).toBeUndefined();
      expect(GOVERNANCE_STATE_LABELS[-1]).toBeUndefined();
    });
  });

  describe("GOVERNANCE_STATE_DESCRIPTIONS", () => {
    it("contains all 6 governance states (0-5)", () => {
      expect(Object.keys(GOVERNANCE_STATE_DESCRIPTIONS)).toHaveLength(6);
      for (let i = 0; i <= 5; i++) {
        expect(GOVERNANCE_STATE_DESCRIPTIONS[i]).toBeDefined();
        expect(typeof GOVERNANCE_STATE_DESCRIPTIONS[i]).toBe("string");
        expect(GOVERNANCE_STATE_DESCRIPTIONS[i].length).toBeGreaterThan(0);
      }
    });

    it("has a description for each label", () => {
      for (const key of Object.keys(GOVERNANCE_STATE_LABELS)) {
        expect(GOVERNANCE_STATE_DESCRIPTIONS[Number(key)]).toBeDefined();
      }
    });

    it("state 1 (Normal) mentions proposals can be executed", () => {
      expect(GOVERNANCE_STATE_DESCRIPTIONS[1]).toContain("proposals can be executed");
    });

    it("state 2 (VetoSignalling) mentions veto", () => {
      expect(GOVERNANCE_STATE_DESCRIPTIONS[2]).toContain("veto");
    });

    it("state 5 (RageQuit) mentions rage quit", () => {
      expect(GOVERNANCE_STATE_DESCRIPTIONS[5]).toContain("rage quit");
    });
  });

  describe("EASY_TRACK_STATUS_LABELS", () => {
    it("contains exactly 4 status labels", () => {
      expect(Object.keys(EASY_TRACK_STATUS_LABELS)).toHaveLength(4);
    });

    it("has label for 'active'", () => {
      expect(EASY_TRACK_STATUS_LABELS["active"]).toBeDefined();
      expect(EASY_TRACK_STATUS_LABELS["active"]).toContain("Active");
    });

    it("has label for 'enacted'", () => {
      expect(EASY_TRACK_STATUS_LABELS["enacted"]).toBeDefined();
      expect(EASY_TRACK_STATUS_LABELS["enacted"]).toContain("Enacted");
    });

    it("has label for 'rejected'", () => {
      expect(EASY_TRACK_STATUS_LABELS["rejected"]).toBeDefined();
      expect(EASY_TRACK_STATUS_LABELS["rejected"]).toContain("Rejected");
    });

    it("has label for 'cancelled'", () => {
      expect(EASY_TRACK_STATUS_LABELS["cancelled"]).toBeDefined();
      expect(EASY_TRACK_STATUS_LABELS["cancelled"]).toContain("Cancelled");
    });

    it("returns undefined for unknown statuses", () => {
      expect(EASY_TRACK_STATUS_LABELS["unknown"]).toBeUndefined();
      expect(EASY_TRACK_STATUS_LABELS[""]).toBeUndefined();
    });
  });
});
