import { describe, it, expect } from "vitest";
import { ZodError, ZodIssue } from "zod";
import { handleToolError, sanitizeErrorMessage } from "../../src/utils/errors.js";

describe("errors utilities", () => {
  describe("sanitizeErrorMessage", () => {
    it("redacts http URLs", () => {
      expect(sanitizeErrorMessage("connect to http://example.com failed")).toBe(
        "connect to [REDACTED_URL] failed",
      );
    });

    it("redacts https URLs", () => {
      expect(sanitizeErrorMessage("connect to https://mainnet.infura.io/v3/KEY123 failed")).toBe(
        "connect to [REDACTED_URL] failed",
      );
    });

    it("redacts multiple URLs in the same message", () => {
      const msg = "tried https://a.com and http://b.com/path?x=1";
      expect(sanitizeErrorMessage(msg)).toBe(
        "tried [REDACTED_URL] and [REDACTED_URL]",
      );
    });

    it("leaves messages without URLs unchanged", () => {
      expect(sanitizeErrorMessage("something broke")).toBe("something broke");
    });

    it("handles empty string", () => {
      expect(sanitizeErrorMessage("")).toBe("");
    });

    it("redacts URL inside parentheses", () => {
      expect(sanitizeErrorMessage("(see https://docs.lido.fi/help)")).toBe(
        "(see [REDACTED_URL])",
      );
    });
  });

  describe("handleToolError", () => {
    it("handles ZodError with field paths", () => {
      const issues: ZodIssue[] = [
        { code: "invalid_type", expected: "string", received: "number", path: ["amount"], message: "Expected string" },
        { code: "invalid_type", expected: "string", received: "undefined", path: ["address"], message: "Required" },
      ];
      const zodErr = new ZodError(issues);
      const result = handleToolError(zodErr);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid input:");
      expect(result.content[0].text).toContain("amount: Expected string");
      expect(result.content[0].text).toContain("address: Required");
    });

    it("handles ZodError with nested paths", () => {
      const issues: ZodIssue[] = [
        { code: "invalid_type", expected: "string", received: "number", path: ["data", "nested", "field"], message: "Bad" },
      ];
      const zodErr = new ZodError(issues);
      const result = handleToolError(zodErr);

      expect(result.content[0].text).toContain("data.nested.field: Bad");
    });

    it("handles insufficient funds error", () => {
      const result = handleToolError(new Error("insufficient funds for gas * price + value"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Insufficient ETH balance");
    });

    it("handles slippage error with 'Too little received'", () => {
      const result = handleToolError(new Error("Too little received"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Swap slippage protection triggered");
    });

    it("handles slippage error with 'amountOutMinimum'", () => {
      const result = handleToolError(new Error("amountOutMinimum not met"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Swap slippage protection triggered");
    });

    it("handles STF swap failure", () => {
      const result = handleToolError(new Error("STF"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Swap failed");
    });

    it("handles TransferHelper swap failure", () => {
      const result = handleToolError(new Error("TransferHelper: TRANSFER_FROM_FAILED"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Swap failed");
    });

    it("handles STAKE_LIMIT error", () => {
      const result = handleToolError(new Error("STAKE_LIMIT"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Staking limit reached");
    });

    it("handles PAUSED error (uppercase)", () => {
      const result = handleToolError(new Error("PAUSED"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("protocol is currently paused");
    });

    it("handles paused error (lowercase)", () => {
      const result = handleToolError(new Error("Contract is paused"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("protocol is currently paused");
    });

    it("handles execution reverted with reason", () => {
      const result = handleToolError(
        new Error("execution reverted\nreason: APP_AUTH_FAILED\n"),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Transaction would revert: APP_AUTH_FAILED");
    });

    it("handles execution reverted without extractable reason", () => {
      const result = handleToolError(new Error("execution reverted"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Transaction would revert: execution reverted");
    });

    it("handles nonce error", () => {
      const result = handleToolError(new Error("nonce too low"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Nonce conflict");
    });

    it("sanitizes URLs in generic Error messages", () => {
      const result = handleToolError(
        new Error("fetch failed: https://mainnet.infura.io/v3/SECRET_KEY"),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).not.toContain("mainnet.infura.io");
      expect(result.content[0].text).toContain("[REDACTED_URL]");
    });

    it("handles non-Error objects (strings)", () => {
      const result = handleToolError("plain string error");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("plain string error");
    });

    it("handles non-Error objects (numbers)", () => {
      const result = handleToolError(42);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("42");
    });

    it("handles null/undefined errors", () => {
      const result1 = handleToolError(null);
      expect(result1.isError).toBe(true);
      expect(result1.content[0].text).toContain("null");

      const result2 = handleToolError(undefined);
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("undefined");
    });

    it("sanitizes URLs in non-Error objects", () => {
      const result = handleToolError("failed at https://rpc.example.com/key");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("[REDACTED_URL]");
      expect(result.content[0].text).not.toContain("rpc.example.com");
    });

    it("prioritizes specific error matchers over generic fallback", () => {
      // An error with "insufficient funds" AND a URL should match insufficient funds first
      const result = handleToolError(
        new Error("insufficient funds at https://rpc.test/key"),
      );
      expect(result.content[0].text).toContain("Insufficient ETH balance");
      // Should NOT contain the URL since it hit the specific handler
      expect(result.content[0].text).not.toContain("[REDACTED_URL]");
    });
  });
});
