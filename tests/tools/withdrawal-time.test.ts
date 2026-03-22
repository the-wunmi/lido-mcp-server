import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEstimateWithdrawalTime } from "../../src/tools/withdrawal-time.js";
import { sdk } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function ensureMocks() {
  if (!sdk.withdraw.views.getUnfinalizedStETH) {
    (sdk.withdraw.views as any).getUnfinalizedStETH = vi.fn();
  }
  if (!sdk.withdraw.views.isPaused) {
    (sdk.withdraw.views as any).isPaused = vi.fn();
  }
  if (!sdk.withdraw.views.isBunkerModeActive) {
    (sdk.withdraw.views as any).isBunkerModeActive = vi.fn();
  }
  if (!sdk.withdraw.views.isTurboModeActive) {
    (sdk.withdraw.views as any).isTurboModeActive = vi.fn();
  }

  if (!(sdk.withdraw as any).waitingTime) {
    (sdk.withdraw as any).waitingTime = {};
  }
  if (!(sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount) {
    (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount = vi.fn();
  }
  if (!(sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByRequestIds) {
    (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByRequestIds = vi.fn();
  }

  if (!(sdk.withdraw as any).requestsInfo) {
    (sdk.withdraw as any).requestsInfo = {};
  }
  if (!(sdk.withdraw as any).requestsInfo.getPendingRequestsInfo) {
    (sdk.withdraw as any).requestsInfo.getPendingRequestsInfo = vi.fn();
  }
}

function setDefaultQueueMocks() {
  vi.mocked((sdk.withdraw.views as any).getUnfinalizedStETH).mockResolvedValue(
    500n * 10n ** 18n,
  );
  vi.mocked((sdk.withdraw.views as any).isPaused).mockResolvedValue(false);
  vi.mocked((sdk.withdraw.views as any).isBunkerModeActive).mockResolvedValue(false);
  vi.mocked((sdk.withdraw.views as any).isTurboModeActive).mockResolvedValue(true);
}

describe("handleEstimateWithdrawalTime", () => {
  beforeEach(() => {
    ensureMocks();
    setDefaultQueueMocks();
  });

  it("estimates withdrawal time by amount", async () => {
    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount,
    ).mockResolvedValue({
      status: "pending",
      requestInfo: {
        type: "buffer",
        finalizationIn: 48,
        finalizationAt: "2024-01-15T12:00:00Z",
      },
    });

    const result = await handleEstimateWithdrawalTime({ amount: "10.0" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Withdrawal Time Estimate");
    expect(text).toContain("Mode: Turbo");
    expect(text).toContain("Estimate for withdrawing 10.0 stETH:");
    expect(text).toContain("~48 hours");
    expect(text).toContain("using protocol buffer");
  });

  it("shows immediately finalized status for amount", async () => {
    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount,
    ).mockResolvedValue({
      status: "finalized",
      requestInfo: {
        type: "buffer",
        finalizationIn: 0,
        finalizationAt: "",
      },
    });

    const result = await handleEstimateWithdrawalTime({ amount: "0.1" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("finalize immediately");
  });

  it("estimates withdrawal time by request IDs", async () => {
    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByRequestIds,
    ).mockResolvedValue([
      {
        status: "finalized",
        requestInfo: { requestId: 42, type: "buffer", finalizationIn: 0, finalizationAt: "" },
      },
      {
        status: "pending",
        requestInfo: {
          requestId: 43,
          type: "rewardsOnly",
          finalizationIn: 72,
          finalizationAt: "2024-01-16T00:00:00Z",
        },
      },
    ]);

    const result = await handleEstimateWithdrawalTime({
      request_ids: ["42", "43"],
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Per-request estimates:");
    expect(text).toContain("Request #42: FINALIZED");
    expect(text).toContain("Request #43: ~72h");
    expect(text).toContain("waiting for staking rewards");
  });

  it("checks pending requests for an address when no amount or request_ids given", async () => {
    vi.mocked(
      (sdk.withdraw as any).requestsInfo.getPendingRequestsInfo,
    ).mockResolvedValue({
      pendingRequests: [
        { id: 10n, amountOfStETH: 5000000000000000000n, stringId: "10", timestamp: 1700000000n },
      ],
      pendingAmountStETH: 5000000000000000000n,
    });

    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByRequestIds,
    ).mockResolvedValue([
      {
        status: "pending",
        requestInfo: {
          requestId: 10,
          type: "validatorBalances",
          finalizationIn: 120,
          finalizationAt: "2024-01-20T00:00:00Z",
        },
      },
    ]);

    const result = await handleEstimateWithdrawalTime({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Checking pending requests for ${MOCK_ADDRESS}`);
    expect(text).toContain("Found 1 pending request(s):");
    expect(text).toContain("Request #10:");
    expect(text).toContain("waiting for validator exits");
  });

  it("reports no pending requests when none exist", async () => {
    vi.mocked(
      (sdk.withdraw as any).requestsInfo.getPendingRequestsInfo,
    ).mockResolvedValue({
      pendingRequests: [],
      pendingAmountStETH: 0n,
    });

    const result = await handleEstimateWithdrawalTime({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No pending withdrawal requests found");
  });

  it("shows PAUSED warning and exits early", async () => {
    vi.mocked((sdk.withdraw.views as any).isPaused).mockResolvedValueOnce(true);

    const result = await handleEstimateWithdrawalTime({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Mode: PAUSED");
    expect(text).toContain("Withdrawals are currently PAUSED");
  });

  it("shows bunker mode warning", async () => {
    vi.mocked((sdk.withdraw.views as any).isBunkerModeActive).mockResolvedValueOnce(true);
    vi.mocked((sdk.withdraw.views as any).isTurboModeActive).mockResolvedValueOnce(false);

    vi.mocked(
      (sdk.withdraw as any).requestsInfo.getPendingRequestsInfo,
    ).mockResolvedValue({
      pendingRequests: [],
      pendingAmountStETH: 0n,
    });

    const result = await handleEstimateWithdrawalTime({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Mode: Bunker");
    expect(text).toContain("BUNKER mode");
  });

  it("returns error for invalid request_ids (non-numeric)", async () => {
    const result = await handleEstimateWithdrawalTime({
      request_ids: ["abc"],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("returns error for invalid address", async () => {
    const result = await handleEstimateWithdrawalTime({ address: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error in queue state gracefully", async () => {
    vi.mocked((sdk.withdraw.views as any).getUnfinalizedStETH).mockRejectedValueOnce(
      new Error("queue state error"),
    );

    const result = await handleEstimateWithdrawalTime({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("queue state error");
  });

  it("handles waiting time API failure gracefully for amount estimation", async () => {
    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount,
    ).mockRejectedValue(new Error("API unavailable"));

    const result = await handleEstimateWithdrawalTime({ amount: "1.0" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Could not estimate");
  });

  it("accepts valid amount format", async () => {
    vi.mocked(
      (sdk.withdraw as any).waitingTime.getWithdrawalWaitingTimeByAmount,
    ).mockResolvedValue({
      status: "pending",
      requestInfo: {
        type: "buffer",
        finalizationIn: 24,
        finalizationAt: "2024-01-14T12:00:00Z",
      },
    });

    const result = await handleEstimateWithdrawalTime({ amount: "0.5" });
    expect(result.isError).toBeUndefined();
  });

  it("returns error for zero amount", async () => {
    const result = await handleEstimateWithdrawalTime({ amount: "0" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });
});
