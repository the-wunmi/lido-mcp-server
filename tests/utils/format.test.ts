import { describe, it, expect } from "vitest";
import {
  formatETH,
  formatStETH,
  formatWstETH,
  formatGwei,
  formatPercent,
  textResult,
  errorResult,
  formatTimestamp,
  formatDuration,
  ethAmountSchema,
} from "../../src/utils/format.js";

describe("format utilities", () => {
  describe("formatETH", () => {
    it("formats wei to ETH string", () => {
      expect(formatETH(1_000_000_000_000_000_000n)).toBe("1 ETH");
    });
    it("formats zero", () => {
      expect(formatETH(0n)).toBe("0 ETH");
    });
    it("formats fractional amounts", () => {
      expect(formatETH(500_000_000_000_000_000n)).toBe("0.5 ETH");
    });
  });

  describe("formatStETH", () => {
    it("formats wei to stETH string", () => {
      expect(formatStETH(2_500_000_000_000_000_000n)).toBe("2.5 stETH");
    });
  });

  describe("formatWstETH", () => {
    it("formats wei to wstETH string", () => {
      expect(formatWstETH(3_000_000_000_000_000_000n)).toBe("3 wstETH");
    });
  });

  describe("formatGwei", () => {
    it("formats wei to gwei", () => {
      expect(formatGwei(20_000_000_000n)).toBe("20 Gwei");
    });
    it("formats fractional gwei", () => {
      expect(formatGwei(1_500_000_000n)).toBe("1.5 Gwei");
    });
  });

  describe("formatPercent", () => {
    it("formats with default 2 decimals", () => {
      expect(formatPercent(3.456)).toBe("3.46%");
    });
    it("formats with custom decimals", () => {
      expect(formatPercent(3.456, 1)).toBe("3.5%");
    });
    it("formats zero", () => {
      expect(formatPercent(0)).toBe("0.00%");
    });
  });

  describe("textResult", () => {
    it("wraps text in MCP content format", () => {
      const result = textResult("hello");
      expect(result).toEqual({
        content: [{ type: "text", text: "hello" }],
      });
    });
  });

  describe("errorResult", () => {
    it("wraps error message with isError flag", () => {
      const result = errorResult("something broke");
      expect(result).toEqual({
        content: [{ type: "text", text: "Error: something broke" }],
        isError: true,
      });
    });
  });

  describe("formatTimestamp", () => {
    it("formats unix timestamp to UTC string", () => {
      const result = formatTimestamp(1700000000);
      expect(result).toMatch(/2023-11-14/);
      expect(result).toMatch(/UTC$/);
    });
    it("handles bigint input", () => {
      const result = formatTimestamp(1700000000n);
      expect(result).toMatch(/UTC$/);
    });
  });

  describe("formatDuration", () => {
    it("formats days and hours", () => {
      expect(formatDuration(90000)).toBe("1d 1h");
    });
    it("formats hours and minutes", () => {
      expect(formatDuration(3660)).toBe("1h 1m");
    });
    it("omits zero hours and minutes", () => {
      // 1 day + 1 minute: hours=0 is skipped, minutes skipped when days > 0
      expect(formatDuration(86460)).toBe("1d");
    });
    it("returns 0s for zero or negative", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(-10)).toBe("0s");
    });
    it("formats just seconds when small", () => {
      expect(formatDuration(45)).toBe("45s");
    });
  });

  describe("ethAmountSchema", () => {
    it("accepts valid amounts", () => {
      expect(ethAmountSchema.parse("1.0")).toBe("1.0");
      expect(ethAmountSchema.parse("100")).toBe("100");
      expect(ethAmountSchema.parse("0.001")).toBe("0.001");
    });

    it("rejects zero", () => {
      expect(() => ethAmountSchema.parse("0")).toThrow();
      expect(() => ethAmountSchema.parse("0.0")).toThrow();
    });

    it("rejects negative amounts", () => {
      expect(() => ethAmountSchema.parse("-1.0")).toThrow();
    });

    it("rejects non-numeric strings", () => {
      expect(() => ethAmountSchema.parse("abc")).toThrow();
      expect(() => ethAmountSchema.parse("")).toThrow();
    });

    it("rejects more than 18 decimal places", () => {
      expect(() => ethAmountSchema.parse("1." + "0".repeat(19))).toThrow();
    });

    it("accepts up to 18 decimal places", () => {
      expect(ethAmountSchema.parse("1." + "0".repeat(17) + "1")).toBeTruthy();
    });
  });
});
