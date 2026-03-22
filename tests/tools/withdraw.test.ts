import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRequestWithdrawal, handleClaimWithdrawal } from "../../src/tools/withdraw.js";
import { publicClient, sdk, getAccountAddress } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("handleRequestWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);

    vi.mocked(sdk.withdraw.approval.getAllowance).mockResolvedValue(10n * 10n ** 18n);
    vi.mocked(sdk.withdraw.approval.approve).mockResolvedValue(undefined as never);

    vi.mocked(sdk.withdraw.request.splitAmountToRequests).mockReturnValue(
      [1000000000000000000n] as never,
    );
    vi.mocked(sdk.withdraw.request.requestWithdrawalEstimateGas).mockResolvedValue(200_000n);
    vi.mocked(sdk.withdraw.request.requestWithdrawalSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.withdraw.request.requestWithdrawalPopulateTx).mockResolvedValue({
      to: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1" as `0x${string}`,
      from: MOCK_ADDRESS as `0x${string}`,
      value: 0n,
      data: "0x" as `0x${string}`,
    });
    vi.mocked(sdk.withdraw.request.requestWithdrawal).mockResolvedValue({
      hash: "0xmockwithdrawhash",
      result: {
        requests: [{ requestId: 1n, amountOfStETH: 1000000000000000000n }],
      },
    } as never);
  });

  it("performs a dry run by default", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("1.0 stETH");
  });

  it("dry run shows split requests", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Split into 1 request(s)");
  });

  it("dry run shows gas estimate and simulation", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Gas estimate: 200000");
    expect(text).toContain("Simulation: SUCCESS");
  });

  it("dry run shows 'Approval needed: No' when allowance is sufficient", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    expect(result.content[0].text).toContain("Approval needed: No");
  });

  it("dry run shows 'Approval needed: YES' when allowance is insufficient", async () => {
    vi.mocked(sdk.withdraw.approval.getAllowance).mockResolvedValue(0n);
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    const text = result.content[0].text;
    expect(text).toContain("Approval needed: YES");
    expect(text).toContain("Simulation: SKIPPED");
  });

  it("dry run does not call requestWithdrawal", async () => {
    await handleRequestWithdrawal({ amount: "1.0" });
    expect(sdk.withdraw.request.requestWithdrawal).not.toHaveBeenCalled();
  });

  it("executes withdrawal when dry_run=false", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Withdrawal Request Submitted");
    expect(text).toContain("0xmockwithdrawhash");
    expect(text).toContain("Request #1");
    expect(text).toContain("queue");
  });

  it("execute calls sdk.withdraw.request.requestWithdrawal", async () => {
    await handleRequestWithdrawal({ amount: "1.0", dry_run: false });
    expect(sdk.withdraw.request.requestWithdrawal).toHaveBeenCalledWith({
      amount: 1000000000000000000n,
      token: "stETH",
    });
  });

  it("execute triggers approval when allowance is insufficient", async () => {
    vi.mocked(sdk.withdraw.approval.getAllowance).mockResolvedValue(0n);
    const result = await handleRequestWithdrawal({ amount: "1.0", dry_run: false });
    expect(result.isError).toBeUndefined();
    expect(sdk.withdraw.approval.approve).toHaveBeenCalledWith({
      token: "stETH",
      amount: 1000000000000000000n + 2n,
    });
    expect(result.content[0].text).toContain("approval was granted automatically");
  });

  it("execute does not trigger approval when allowance is sufficient", async () => {
    await handleRequestWithdrawal({ amount: "1.0", dry_run: false });
    expect(sdk.withdraw.approval.approve).not.toHaveBeenCalled();
  });

  it("defaults to stETH token", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    expect(result.content[0].text).toContain("stETH");
  });

  it("accepts wstETH token", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0", token: "wstETH" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("wstETH");
  });

  it("passes wstETH token to SDK", async () => {
    await handleRequestWithdrawal({ amount: "1.0", token: "wstETH", dry_run: false });
    expect(sdk.withdraw.request.requestWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ token: "wstETH" }),
    );
  });

  it("accepts receiver matching the wallet address", async () => {
    const result = await handleRequestWithdrawal({
      amount: "1.0",
      receiver: MOCK_ADDRESS,
      dry_run: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Withdrawal Request Submitted");
  });

  it("rejects receiver that does not match wallet (no allowlist)", async () => {
    const result = await handleRequestWithdrawal({
      amount: "1.0",
      receiver: "0x0000000000000000000000000000000000000001",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not match the configured wallet address");
  });

  it("rejects missing amount", async () => {
    const result = await handleRequestWithdrawal({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects zero amount", async () => {
    const result = await handleRequestWithdrawal({ amount: "0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects invalid token type", async () => {
    const result = await handleRequestWithdrawal({ amount: "1.0", token: "DAI" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("rejects invalid receiver address format", async () => {
    const result = await handleRequestWithdrawal({
      amount: "1.0",
      receiver: "not-an-address",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles gas estimation failure gracefully in dry run", async () => {
    vi.mocked(sdk.withdraw.request.requestWithdrawalEstimateGas).mockRejectedValue(
      new Error("gas estimation failed"),
    );
    const result = await handleRequestWithdrawal({ amount: "1.0" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("300000");
    expect(text).toContain("conservative estimate");
  });

  it("handles SDK errors during execution", async () => {
    vi.mocked(sdk.withdraw.request.requestWithdrawal).mockRejectedValue(
      new Error("execution reverted\nreason: AMOUNT_TOO_LARGE"),
    );
    const result = await handleRequestWithdrawal({ amount: "1.0", dry_run: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("revert");
  });
});

describe("handleClaimWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountAddress).mockReturnValue(MOCK_ADDRESS as `0x${string}`);
    vi.mocked(publicClient.getGasPrice).mockResolvedValue(20_000_000_000n);

    vi.mocked(sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 1000000000000000000n,
      sortedIds: [1n],
      hints: [100n],
    } as never);

    vi.mocked(sdk.withdraw.views.getLastCheckpointIndex).mockResolvedValue(100n);
    vi.mocked(sdk.withdraw.views.findCheckpointHints).mockResolvedValue([100n]);

    vi.mocked(sdk.withdraw.claim.claimRequestsPopulateTx).mockResolvedValue({
      to: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1" as `0x${string}`,
      from: MOCK_ADDRESS as `0x${string}`,
      value: 0n,
      data: "0x" as `0x${string}`,
    });
    vi.mocked(sdk.withdraw.claim.claimRequestsSimulateTx).mockResolvedValue(undefined as never);
    vi.mocked(sdk.withdraw.claim.claimRequestsEstimateGas).mockResolvedValue(150_000n);
    vi.mocked(sdk.withdraw.claim.claimRequests).mockResolvedValue({
      hash: "0xmockclaimhash",
      result: undefined,
    } as never);
  });

  it("performs a dry run by default (claim all)", async () => {
    const result = await handleClaimWithdrawal({});
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
    expect(text).toContain("claiming 1 withdrawal request(s)");
  });

  it("dry run calls populate, simulate, and estimateGas", async () => {
    await handleClaimWithdrawal({});
    expect(sdk.withdraw.claim.claimRequestsPopulateTx).toHaveBeenCalled();
    expect(sdk.withdraw.claim.claimRequestsSimulateTx).toHaveBeenCalled();
    expect(sdk.withdraw.claim.claimRequestsEstimateGas).toHaveBeenCalled();
    expect(sdk.withdraw.claim.claimRequests).not.toHaveBeenCalled();
  });

  it("returns message when no claimable requests exist", async () => {
    vi.mocked(sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 0n,
      sortedIds: [],
      hints: [],
    } as never);
    const result = await handleClaimWithdrawal({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No claimable withdrawal requests found");
  });

  it("performs a dry run with specific request IDs", async () => {
    const result = await handleClaimWithdrawal({ request_ids: ["1"] });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("claiming 1 withdrawal request(s)");
  });

  it("verifies ownership of specific request IDs", async () => {
    await handleClaimWithdrawal({ request_ids: ["1"] });
    expect(sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount).toHaveBeenCalledWith({
      account: MOCK_ADDRESS,
    });
  });

  it("returns error when request IDs are not owned by caller", async () => {
    vi.mocked(sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 1000000000000000000n,
      sortedIds: [1n],
      hints: [100n],
    } as never);
    const result = await handleClaimWithdrawal({ request_ids: ["999"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not claimable by your address");
    expect(result.content[0].text).toContain("999");
  });

  it("looks up checkpoint hints for specific request IDs", async () => {
    await handleClaimWithdrawal({ request_ids: ["1"] });
    expect(sdk.withdraw.views.getLastCheckpointIndex).toHaveBeenCalled();
    expect(sdk.withdraw.views.findCheckpointHints).toHaveBeenCalled();
  });

  it("executes claim when dry_run=false (claim all)", async () => {
    const result = await handleClaimWithdrawal({ dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Withdrawal Claimed");
    expect(text).toContain("0xmockclaimhash");
  });

  it("execute calls sdk.withdraw.claim.claimRequests", async () => {
    await handleClaimWithdrawal({ dry_run: false });
    expect(sdk.withdraw.claim.claimRequests).toHaveBeenCalledWith({
      requestsIds: [1n],
      hints: [100n],
    });
  });

  it("executes claim with specific request IDs when dry_run=false", async () => {
    const result = await handleClaimWithdrawal({ request_ids: ["1"], dry_run: false });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Withdrawal Claimed");
    expect(text).toContain("0xmockclaimhash");
  });

  it("execute with specific IDs passes sorted IDs and hints to SDK", async () => {
    await handleClaimWithdrawal({ request_ids: ["1"], dry_run: false });
    expect(sdk.withdraw.claim.claimRequests).toHaveBeenCalledWith({
      requestsIds: [1n],
      hints: [100n],
    });
  });

  it("shows claim result details when available", async () => {
    vi.mocked(sdk.withdraw.claim.claimRequests).mockResolvedValue({
      hash: "0xmockclaimhash",
      result: {
        requests: [
          {
            requestId: 1n,
            amountOfETH: 1000000000000000000n,
            receiver: MOCK_ADDRESS as `0x${string}`,
          },
        ],
      },
    } as never);
    const result = await handleClaimWithdrawal({ dry_run: false });
    const text = result.content[0].text;
    expect(text).toContain("Request #1");
    expect(text).toContain("ETH");
    expect(text).toContain("Total ETH received:");
  });

  it("rejects non-numeric request IDs", async () => {
    const result = await handleClaimWithdrawal({ request_ids: ["abc"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK errors during claim execution", async () => {
    vi.mocked(sdk.withdraw.claim.claimRequests).mockRejectedValue(
      new Error("execution reverted\nreason: AlreadyClaimed"),
    );
    const result = await handleClaimWithdrawal({ dry_run: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("revert");
  });

  it("handles empty request_ids array (claim all behavior)", async () => {
    const result = await handleClaimWithdrawal({ request_ids: [] });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("DRY RUN");
  });
});
