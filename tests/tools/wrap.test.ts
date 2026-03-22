import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleWrapSteth, handleWrapEth, handleUnwrap } from "../../src/tools/wrap.js";
import { publicClient, sdk, getAccountAddress } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleWrapSteth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(sdk.steth.balance).mockResolvedValue(5n * 10n ** 18n);
    vi.mocked(sdk.wrap.getStethForWrapAllowance).mockResolvedValue(10n * 10n ** 18n);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);
    vi.mocked(sdk.wrap.wrapStethPopulateTx).mockResolvedValue({
      to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      from: MOCK_ADDRESS as `0x${string}`,
      value: 0n,
      data: "0xea598cb0",
    } as never);
    vi.mocked(sdk.wrap.wrapStethSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.wrap.wrapStethEstimateGas).mockResolvedValue(80_000n);
    vi.mocked(sdk.wrap.wrapSteth).mockResolvedValue({
      hash: "0xmockwraphash",
      result: { stethWrapped: 1000000000000000000n, wstethReceived: 850000000000000000n },
    } as never);
    vi.mocked(sdk.wrap.approveStethForWrap).mockResolvedValue(undefined as never);
  });

  it("performs a dry run by default", async () => {
    const result = await handleWrapSteth({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("1.0 stETH");
  });

  it("dry run includes gas and simulation information", async () => {
    const result = await handleWrapSteth({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Gas estimate");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("dry run shows 'Approval needed: No' when allowance is sufficient", async () => {
    const result = await handleWrapSteth({ amount: "1.0" });
    expect(result.content[0].text).toContain("Approval needed: No");
  });

  it("dry run calls populate, simulate, and estimateGas SDK methods", async () => {
    await handleWrapSteth({ amount: "1.0" });
    expect(sdk.wrap.wrapStethPopulateTx).toHaveBeenCalled();
    expect(sdk.wrap.wrapStethSimulateTx).toHaveBeenCalled();
    expect(sdk.wrap.wrapStethEstimateGas).toHaveBeenCalled();
    expect(sdk.wrap.wrapSteth).not.toHaveBeenCalled();
  });

  it("dry run shows approval needed when allowance is insufficient", async () => {
    vi.mocked(sdk.wrap.getStethForWrapAllowance).mockResolvedValue(0n);
    const result = await handleWrapSteth({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Approval needed: YES");
    expect(text).toContain("simulation skipped");
  });

  it("dry run does not call simulateTx when approval is needed", async () => {
    vi.mocked(sdk.wrap.getStethForWrapAllowance).mockResolvedValue(0n);
    await handleWrapSteth({ amount: "1.0" });
    expect(sdk.wrap.wrapStethSimulateTx).not.toHaveBeenCalled();
  });

  it("executes wrapping when dry_run=false", async () => {
    const result = await handleWrapSteth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Wrap Successful");
    expect(text).toContain("0xmockwraphash");
    expect(text).toContain("stETH wrapped:");
    expect(text).toContain("wstETH received:");
  });

  it("execute calls sdk.wrap.wrapSteth", async () => {
    await handleWrapSteth({ amount: "1.0", dry_run: false });
    expect(sdk.wrap.wrapSteth).toHaveBeenCalledWith({ value: 1000000000000000000n });
  });

  it("execute triggers approval when allowance is insufficient", async () => {
    vi.mocked(sdk.wrap.getStethForWrapAllowance).mockResolvedValue(0n);
    const result = await handleWrapSteth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    expect(sdk.wrap.approveStethForWrap).toHaveBeenCalledWith({
      value: 1000000000000000000n + 2n,
    });
    expect(result.content[0].text).toContain("approval was granted automatically");
  });

  it("execute does not trigger approval when allowance is sufficient", async () => {
    const result = await handleWrapSteth({ amount: "1.0", dry_run: false });
    expect(sdk.wrap.approveStethForWrap).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain("approval was granted");
  });

  it("returns error when stETH balance is insufficient", async () => {
    vi.mocked(sdk.steth.balance).mockResolvedValue(500000000000000000n);
    const result = await handleWrapSteth({ amount: "1.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient stETH balance");
  });

  it("returns error when stETH balance is zero", async () => {
    vi.mocked(sdk.steth.balance).mockResolvedValue(0n);
    const result = await handleWrapSteth({ amount: "0.1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient stETH balance");
  });

  it("rejects missing amount", async () => {
    const result = await handleWrapSteth({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects zero amount", async () => {
    const result = await handleWrapSteth({ amount: "0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects non-numeric amount", async () => {
    const result = await handleWrapSteth({ amount: "xyz" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});

describe("handleWrapEth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(publicClient.getBalance).mockResolvedValue(10n * 10n ** 18n);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);
    vi.mocked(publicClient.call).mockResolvedValue({ data: "0x" });
    vi.mocked(sdk.wrap.wrapEthPopulateTx).mockResolvedValue({
      to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      from: MOCK_ADDRESS as `0x${string}`,
      value: 1000000000000000000n,
      data: "0x",
    } as never);
    vi.mocked(sdk.wrap.wrapEthSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.wrap.wrapEthEstimateGas).mockResolvedValue(120_000n);
    vi.mocked(sdk.wrap.wrapEth).mockResolvedValue({
      hash: "0xmockwrapethhash",
      result: { stethWrapped: 1000000000000000000n, wstethReceived: 850000000000000000n },
    } as never);
  });

  it("performs a dry run by default", async () => {
    const result = await handleWrapEth({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("1.0 ETH");
  });

  it("dry run includes gas estimate", async () => {
    const result = await handleWrapEth({ amount: "1.0" });
    expect(result.content[0].text).toContain("Gas estimate");
  });

  it("dry run calls populate and estimateGas SDK methods", async () => {
    await handleWrapEth({ amount: "1.0" });
    expect(sdk.wrap.wrapEthPopulateTx).toHaveBeenCalled();
    expect(sdk.wrap.wrapEthEstimateGas).toHaveBeenCalled();
    expect(sdk.wrap.wrapEth).not.toHaveBeenCalled();
  });

  it("executes wrapping when dry_run=false", async () => {
    const result = await handleWrapEth({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Wrap ETH");
    expect(text).toContain("Successful");
    expect(text).toContain("0xmockwrapethhash");
    expect(text).toContain("stETH wrapped:");
    expect(text).toContain("wstETH received:");
  });

  it("execute calls sdk.wrap.wrapEth", async () => {
    await handleWrapEth({ amount: "1.0", dry_run: false });
    expect(sdk.wrap.wrapEth).toHaveBeenCalledWith({ value: 1000000000000000000n });
  });

  it("returns error when ETH balance is insufficient", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(500000000000000000n);
    const result = await handleWrapEth({ amount: "1.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient ETH balance");
  });

  it("returns error when ETH balance is zero", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValue(0n);
    const result = await handleWrapEth({ amount: "0.01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient ETH balance");
  });

  it("rejects missing amount", async () => {
    const result = await handleWrapEth({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects zero amount", async () => {
    const result = await handleWrapEth({ amount: "0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});

describe("handleUnwrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(sdk.wsteth.balance).mockResolvedValue(3n * 10n ** 18n);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);
    vi.mocked(sdk.wrap.unwrapPopulateTx).mockResolvedValue({
      to: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      from: MOCK_ADDRESS as `0x${string}`,
      value: 0n,
      data: "0xde0e9a3e",
    } as never);
    vi.mocked(sdk.wrap.unwrapSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.wrap.unwrapEstimateGas).mockResolvedValue(70_000n);
    vi.mocked(sdk.wrap.unwrap).mockResolvedValue({
      hash: "0xmockunwraphash",
      result: { wstethUnwrapped: 1000000000000000000n, stethReceived: 1170000000000000000n },
    } as never);
  });

  it("performs a dry run by default", async () => {
    const result = await handleUnwrap({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("1.0 wstETH");
  });

  it("dry run includes gas and simulation information", async () => {
    const result = await handleUnwrap({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Gas estimate");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("dry run calls populate, simulate, and estimateGas SDK methods", async () => {
    await handleUnwrap({ amount: "1.0" });
    expect(sdk.wrap.unwrapPopulateTx).toHaveBeenCalled();
    expect(sdk.wrap.unwrapSimulateTx).toHaveBeenCalled();
    expect(sdk.wrap.unwrapEstimateGas).toHaveBeenCalled();
    expect(sdk.wrap.unwrap).not.toHaveBeenCalled();
  });

  it("executes unwrapping when dry_run=false", async () => {
    const result = await handleUnwrap({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Unwrap Successful");
    expect(text).toContain("0xmockunwraphash");
    expect(text).toContain("wstETH unwrapped:");
    expect(text).toContain("stETH received:");
  });

  it("execute calls sdk.wrap.unwrap", async () => {
    await handleUnwrap({ amount: "1.0", dry_run: false });
    expect(sdk.wrap.unwrap).toHaveBeenCalledWith({ value: 1000000000000000000n });
  });

  it("returns error when wstETH balance is insufficient", async () => {
    vi.mocked(sdk.wsteth.balance).mockResolvedValue(500000000000000000n);
    const result = await handleUnwrap({ amount: "1.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient wstETH balance");
  });

  it("returns error when wstETH balance is zero", async () => {
    vi.mocked(sdk.wsteth.balance).mockResolvedValue(0n);
    const result = await handleUnwrap({ amount: "0.1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient wstETH balance");
  });

  it("rejects missing amount", async () => {
    const result = await handleUnwrap({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects zero amount", async () => {
    const result = await handleUnwrap({ amount: "0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects non-numeric amount", async () => {
    const result = await handleUnwrap({ amount: "not-a-number" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK errors gracefully during execution", async () => {
    vi.mocked(sdk.wrap.unwrap).mockRejectedValue(new Error("execution reverted\nreason: unknown"));
    const result = await handleUnwrap({ amount: "1.0", dry_run: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("revert");
  });
});
