import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleL2GetStethBalance,
  handleL2TransferSteth,
} from "../../src/tools/l2-steth.js";
import {
  publicClient,
  walletClient,
  getAccountAddress,
} from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const RECEIVER = "0x1234567890abcdef1234567890abcdef12345678";

beforeEach(() => {
  vi.mocked(publicClient.readContract).mockReset().mockResolvedValue(0n);
  vi.mocked(publicClient.getBalance).mockReset().mockResolvedValue(10n * 10n ** 18n);
  vi.mocked(publicClient.getGasPrice).mockReset().mockResolvedValue(20_000_000_000n);
  vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
});

describe("handleL2GetStethBalance", () => {
  it("returns stETH and ETH balances for default wallet", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(7n * 10n ** 18n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(4n * 10n ** 18n);

    const result = await handleL2GetStethBalance({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${MOCK_ADDRESS} on Optimism`);
    expect(text).toContain("ETH:");
    expect(text).toContain("7");
    expect(text).toContain("stETH:");
    expect(text).toContain("4");
  });

  it("returns balances for a specified address", async () => {
    const addr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n * 10n ** 18n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(2n * 10n ** 18n);

    const result = await handleL2GetStethBalance({ address: addr });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${addr} on Optimism`);
  });

  it("returns error for invalid address format", async () => {
    const result = await handleL2GetStethBalance({ address: "bad-addr" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for address that is too short", async () => {
    const result = await handleL2GetStethBalance({ address: "0xabc" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("displays zero balances correctly", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(0n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleL2GetStethBalance({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("ETH:   0");
    expect(text).toContain("stETH: 0");
  });

  it("includes rebasing note about stETH on Optimism", async () => {
    const result = await handleL2GetStethBalance({});

    const text = result.content[0].text;
    expect(text).toContain("rebasing token");
    expect(text).toContain("1-2 wei rounding");
  });

  it("handles RPC error from getBalance", async () => {
    vi.mocked(publicClient.getBalance).mockRejectedValueOnce(
      new Error("RPC timeout"),
    );

    const result = await handleL2GetStethBalance({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("RPC timeout");
  });

  it("handles RPC error from readContract", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(
      new Error("contract call failed"),
    );

    const result = await handleL2GetStethBalance({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("contract call failed");
  });
});

describe("handleL2TransferSteth", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockResolvedValue(10n * 10n ** 18n);
    (publicClient as any).simulateContract = vi.fn().mockResolvedValue({ result: true });
    (publicClient as any).estimateContractGas = vi.fn().mockResolvedValue(55_000n);
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    vi.mocked(walletClient.writeContract).mockResolvedValue("0xmocktxhash" as `0x${string}`);
  });

  it("performs a dry run by default", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("Transfer stETH on Optimism");
    expect(text).toContain(`From: ${MOCK_ADDRESS}`);
    expect(text).toContain(`To: ${RECEIVER}`);
    expect(text).toContain("1.0 stETH");
    expect(text).toContain("Gas estimate:");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("performs a dry run when dry_run=true explicitly", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "3.5",
      dry_run: true,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("3.5 stETH");
  });

  it("executes a real transfer when dry_run=false", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "2.0",
      dry_run: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain("DRY RUN");
    expect(text).toContain("stETH Transfer on Optimism");
    expect(text).toContain("0xmocktxhash");
    expect(text).toContain("Confirmed");
    expect(text).toContain(`From: ${MOCK_ADDRESS}`);
    expect(text).toContain(`To: ${RECEIVER}`);
    expect(text).toContain("2.0 stETH");
  });

  it("reports Failed status when receipt is not success", async () => {
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });

    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
      dry_run: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Failed");
  });

  it("includes rebasing note in executed transfer output", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
      dry_run: false,
    });

    const text = result.content[0].text;
    expect(text).toContain("1-2 wei");
  });

  it("includes rebasing note in dry run output", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
    });

    const text = result.content[0].text;
    expect(text).toContain("rebasing token");
    expect(text).toContain("1-2 wei");
  });

  it("returns error for invalid address", async () => {
    const result = await handleL2TransferSteth({
      to: "invalid",
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for zero amount", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for negative amount", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "-5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for insufficient stETH balance", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValue(
      500_000_000_000_000n,
    );

    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient stETH balance");
  });

  it("dry run shows conservative estimate on simulation failure", async () => {
    (publicClient as any).simulateContract = vi.fn().mockRejectedValueOnce(
      new Error("execution reverted"),
    );

    const result = await handleL2TransferSteth({
      to: RECEIVER,
      amount: "1.0",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("Simulation: FAILED");
    expect(text).toContain("65000");
    expect(text).toContain("conservative estimate");
  });

  it("returns receiver validation error for disallowed address", async () => {
    const otherAddr = "0xcccccccccccccccccccccccccccccccccccccccc";

    const result = await handleL2TransferSteth({
      to: otherAddr,
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not match the configured wallet address");
  });

  it("returns error when required fields are missing", async () => {
    const result = await handleL2TransferSteth({
      to: RECEIVER,
      // amount is missing
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});
