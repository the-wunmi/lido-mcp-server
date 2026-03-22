import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleL2GetBalance,
  handleL2Transfer,
  handleL2GetInfo,
} from "../../src/tools/l2-wsteth.js";
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

describe("handleL2GetBalance", () => {
  it("returns wstETH and ETH balances for default wallet", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(5n * 10n ** 18n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(3n * 10n ** 18n);

    const result = await handleL2GetBalance({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${MOCK_ADDRESS}`);
    expect(text).toContain("ETH:");
    expect(text).toContain("5");
    expect(text).toContain("wstETH:");
    expect(text).toContain("3");
  });

  it("returns balances for a specified address", async () => {
    const addr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n * 10n ** 18n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(2n * 10n ** 18n);

    const result = await handleL2GetBalance({ address: addr });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Balances for ${addr}`);
  });

  it("returns error for invalid address format", async () => {
    const result = await handleL2GetBalance({ address: "not-an-address" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for address that is too short", async () => {
    const result = await handleL2GetBalance({ address: "0x1234" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("displays zero balances correctly", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(0n);
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleL2GetBalance({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("ETH:    0");
    expect(text).toContain("wstETH: 0");
  });

  it("includes L2 informational note", async () => {
    const result = await handleL2GetBalance({});

    const text = result.content[0].text;
    expect(text).toContain("wstETH on L2 is a bridged token");
  });

  it("handles RPC error from getBalance", async () => {
    vi.mocked(publicClient.getBalance).mockRejectedValueOnce(
      new Error("RPC connection failed"),
    );

    const result = await handleL2GetBalance({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("RPC connection failed");
  });

  it("handles RPC error from readContract", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(
      new Error("readContract failed"),
    );

    const result = await handleL2GetBalance({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("readContract failed");
  });
});

describe("handleL2Transfer", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockResolvedValue(10n * 10n ** 18n);
    (publicClient as any).simulateContract = vi.fn().mockResolvedValue({ result: true });
    (publicClient as any).estimateContractGas = vi.fn().mockResolvedValue(55_000n);
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    vi.mocked(walletClient.writeContract).mockResolvedValue("0xmocktxhash" as `0x${string}`);
  });

  it("performs a dry run by default", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "1.0",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain(`From: ${MOCK_ADDRESS}`);
    expect(text).toContain(`To: ${RECEIVER}`);
    expect(text).toContain("1.0 wstETH");
    expect(text).toContain("Gas estimate:");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("performs a dry run when dry_run=true explicitly", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "2.5",
      dry_run: true,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("2.5 wstETH");
  });

  it("executes a real transfer when dry_run=false", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "1.0",
      dry_run: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain("DRY RUN");
    expect(text).toContain("0xmocktxhash");
    expect(text).toContain("Confirmed");
    expect(text).toContain(`From: ${MOCK_ADDRESS}`);
    expect(text).toContain(`To: ${RECEIVER}`);
    expect(text).toContain("1.0 wstETH");
  });

  it("reports Failed status when receipt is not success", async () => {
    (publicClient as any).waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });

    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "1.0",
      dry_run: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Failed");
  });

  it("returns error for invalid address", async () => {
    const result = await handleL2Transfer({
      to: "not-an-address",
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for invalid amount (zero)", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for invalid amount (negative text)", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "-1",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for insufficient balance", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValue(0n);

    const result = await handleL2Transfer({
      to: RECEIVER,
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient wstETH balance");
  });

  it("dry run shows conservative estimate on simulation failure", async () => {
    (publicClient as any).simulateContract = vi.fn().mockRejectedValueOnce(
      new Error("execution reverted"),
    );

    const result = await handleL2Transfer({
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
    const otherAddr = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result = await handleL2Transfer({
      to: otherAddr,
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not match the configured wallet address");
  });

  it("returns missing required field error", async () => {
    const result = await handleL2Transfer({
      to: RECEIVER,
      // missing amount
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});

describe("handleL2GetInfo", () => {
  it("returns wstETH token info", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(
      500_000n * 10n ** 18n,
    );

    const result = await handleL2GetInfo({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("wstETH on");
    expect(text).toContain("Contract:");
    expect(text).toContain("Total bridged supply:");
    expect(text).toContain("500000");
    expect(text).toContain("About wstETH on L2:");
    expect(text).toContain("What you can do on L2:");
    expect(text).toContain("What requires L1:");
  });

  it("displays zero total supply", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(0n);

    const result = await handleL2GetInfo({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Total bridged supply: 0");
  });

  it("handles RPC error", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(
      new Error("RPC error"),
    );

    const result = await handleL2GetInfo({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("RPC error");
  });

  it("mentions contract address from WSTETH_ADDRESSES", async () => {
    const result = await handleL2GetInfo({});

    const text = result.content[0].text;
    expect(text).toContain("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0");
  });
});
