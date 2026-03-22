import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateReceiver, validateAmountCap } from "../../src/utils/security.js";
import { securityConfig } from "../../src/config.js";
import { getAccountAddress } from "../../src/sdk-factory.js";
import { parseEther } from "viem";

const mockedSecurityConfig = securityConfig as {
  mode: string;
  allowedReceivers: Set<string> | null;
  maxTransactionWei: bigint | null;
};
const mockedGetAccountAddress = getAccountAddress as ReturnType<typeof vi.fn>;

describe("security utilities", () => {
  beforeEach(() => {
    mockedSecurityConfig.allowedReceivers = null;
    mockedSecurityConfig.maxTransactionWei = null;
    mockedGetAccountAddress.mockReturnValue(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  describe("validateReceiver", () => {
    describe("when allowedReceivers is null (no allowlist configured)", () => {
      it("allows the wallet's own address", () => {
        const result = validateReceiver(
          "0x1234567890abcdef1234567890abcdef12345678",
        );
        expect(result).toBeNull();
      });

      it("allows the wallet address with different casing (case-insensitive)", () => {
        const result = validateReceiver(
          "0x1234567890ABCDEF1234567890ABCDEF12345678",
        );
        expect(result).toBeNull();
      });

      it("rejects a different address", () => {
        const result = validateReceiver(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        expect(result).not.toBeNull();
        expect(result).toContain("does not match the configured wallet address");
        expect(result).toContain("LIDO_ALLOWED_RECEIVERS");
      });
    });

    describe("when allowedReceivers is configured", () => {
      beforeEach(() => {
        mockedSecurityConfig.allowedReceivers = new Set([
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ]);
      });

      it("allows an address in the allowlist", () => {
        const result = validateReceiver(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        expect(result).toBeNull();
      });

      it("allows an address in the allowlist (case-insensitive)", () => {
        const result = validateReceiver(
          "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        );
        expect(result).toBeNull();
      });

      it("rejects an address not in the allowlist", () => {
        const result = validateReceiver(
          "0xcccccccccccccccccccccccccccccccccccccccc",
        );
        expect(result).not.toBeNull();
        expect(result).toContain("not in the allowed receivers list");
        expect(result).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        expect(result).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      });

      it("rejects the wallet's own address if it's not in the allowlist", () => {
        const result = validateReceiver(
          "0x1234567890abcdef1234567890abcdef12345678",
        );
        expect(result).not.toBeNull();
        expect(result).toContain("not in the allowed receivers list");
      });
    });

    describe("with empty allowedReceivers set", () => {
      beforeEach(() => {
        mockedSecurityConfig.allowedReceivers = new Set();
      });

      it("rejects all addresses", () => {
        const result = validateReceiver(
          "0x1234567890abcdef1234567890abcdef12345678",
        );
        expect(result).not.toBeNull();
        expect(result).toContain("not in the allowed receivers list");
      });
    });
  });

  describe("validateAmountCap", () => {
    describe("when maxTransactionWei is null (no cap)", () => {
      it("allows any amount", () => {
        expect(validateAmountCap(parseEther("1000000"))).toBeNull();
      });

      it("allows zero", () => {
        expect(validateAmountCap(0n)).toBeNull();
      });
    });

    describe("when maxTransactionWei is configured", () => {
      beforeEach(() => {
        mockedSecurityConfig.maxTransactionWei = parseEther("10");
      });

      it("allows amounts under the cap", () => {
        expect(validateAmountCap(parseEther("5"))).toBeNull();
      });

      it("allows amounts exactly at the cap", () => {
        expect(validateAmountCap(parseEther("10"))).toBeNull();
      });

      it("rejects amounts over the cap", () => {
        const result = validateAmountCap(parseEther("10.000000000000000001"));
        expect(result).not.toBeNull();
        expect(result).toContain("exceeds the maximum transaction limit");
        expect(result).toContain("10 ETH");
        expect(result).toContain("LIDO_MAX_TRANSACTION_ETH");
      });

      it("rejects much larger amounts", () => {
        const result = validateAmountCap(parseEther("100"));
        expect(result).not.toBeNull();
        expect(result).toContain("100 ETH");
        expect(result).toContain("exceeds the maximum transaction limit");
      });

      it("allows zero", () => {
        expect(validateAmountCap(0n)).toBeNull();
      });
    });

    describe("with very small cap", () => {
      beforeEach(() => {
        mockedSecurityConfig.maxTransactionWei = 1n;
      });

      it("allows 1 wei", () => {
        expect(validateAmountCap(1n)).toBeNull();
      });

      it("rejects 2 wei", () => {
        const result = validateAmountCap(2n);
        expect(result).not.toBeNull();
        expect(result).toContain("exceeds the maximum transaction limit");
      });
    });
  });
});
