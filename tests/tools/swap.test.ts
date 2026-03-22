import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetSwapQuote, handleSwapEthForLdo } from "../../src/tools/swap.js";
import { publicClient, walletClient, getAccountAddress } from "../../src/sdk-factory.js";
import { appConfig } from "../../src/config.js";

describe("handleGetSwapQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns swap quote for given ETH amount", async () => {
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(1000000000000000000000n);

    const result = await handleGetSwapQuote({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("ETH");
    expect(text).toContain("LDO Swap Quote");
    expect(text).toContain("Input: 1.0 ETH");
    expect(text).toContain("Expected output:");
    expect(text).toContain("LDO");
    expect(text).toContain("Effective price:");
    expect(text).toContain("Pool fee: 0.3%");
    expect(text).toContain("Your balances:");
  });

  it("warns when insufficient ETH for swap + gas", async () => {
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleGetSwapQuote({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("Warning");
    expect(text).toContain("not have enough ETH");
  });

  it("returns N/A effective price when quoter returns zero LDO output", async () => {
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [0n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleGetSwapQuote({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("Effective price: N/A");
  });

  it("rejects on non-mainnet chain", async () => {
    const original = appConfig.chainId;
    (appConfig as any).chainId = 17000;
    try {
      const result = await handleGetSwapQuote({ amount: "1.0" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("only available on Ethereum mainnet");
    } finally {
      (appConfig as any).chainId = original;
    }
  });

  it("returns error for invalid amount", async () => {
    const result = await handleGetSwapQuote({ amount: "abc" });
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for zero amount", async () => {
    const result = await handleGetSwapQuote({ amount: "0" });
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for missing amount", async () => {
    const result = await handleGetSwapQuote({});
    expect(result).toHaveProperty("isError", true);
  });

  it("handles quoter failure gracefully", async () => {
    vi.mocked(publicClient.simulateContract).mockRejectedValueOnce(
      new Error("Pool liquidity insufficient")
    );
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleGetSwapQuote({ amount: "1.0" });
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleSwapEthForLdo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dry run output for valid swap", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: 500000000000000000000n } as any);
    vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(180_000n);

    const result = await handleSwapEthForLdo({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Swap ETH for LDO");
    expect(text).toContain("Input: 1.0 ETH");
    expect(text).toContain("Expected output:");
    expect(text).toContain("Minimum output (after 0.5% slippage):");
    expect(text).toContain("Simulation: SUCCESS");
    expect(text).toContain("Set dry_run=false to execute");
  });

  it("executes swap when dry_run=false", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xswaphash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
      gasUsed: 170_000n,
    } as any);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(1500000000000000000000n);

    const result = await handleSwapEthForLdo({ amount: "1.0", dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("Swap Complete: ETH");
    expect(text).toContain("LDO");
    expect(text).toContain("Transaction hash: 0xswaphash");
    expect(text).toContain("Status: Confirmed");
    expect(text).toContain("Your LDO balance:");
    expect(text).toContain("lido_vote_on_proposal");
  });

  it("returns error for insufficient ETH balance", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(500000000000000000n);

    const result = await handleSwapEthForLdo({ amount: "1.0" });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Insufficient ETH balance");
  });

  it("reports reverted swap transaction", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xswaphash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "reverted",
      gasUsed: 170_000n,
    } as any);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleSwapEthForLdo({ amount: "1.0", dry_run: false });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("reverted");
  });

  it("respects custom slippage_percent", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: 500000000000000000000n } as any);
    vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(180_000n);

    const result = await handleSwapEthForLdo({ amount: "1.0", slippage_percent: 2.0 });
    const text = result.content[0].text;

    expect(text).toContain("after 2% slippage");
  });

  it("rejects on non-mainnet chain", async () => {
    const original = appConfig.chainId;
    (appConfig as any).chainId = 17000;
    try {
      const result = await handleSwapEthForLdo({ amount: "1.0" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("only available on Ethereum mainnet");
    } finally {
      (appConfig as any).chainId = original;
    }
  });

  it("returns error for invalid amount", async () => {
    const result = await handleSwapEthForLdo({ amount: "xyz" });
    expect(result).toHaveProperty("isError", true);
  });

  it("returns error for slippage > 5%", async () => {
    const result = await handleSwapEthForLdo({ amount: "1.0", slippage_percent: 10 });
    expect(result).toHaveProperty("isError", true);
  });

  it("defaults to dry_run=true", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(10000000000000000000n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({
      result: [500000000000000000000n, 0n, 0, 150_000n],
    } as any);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: 500000000000000000000n } as any);
    vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(180_000n);

    const result = await handleSwapEthForLdo({ amount: "1.0" });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN");
  });
});
