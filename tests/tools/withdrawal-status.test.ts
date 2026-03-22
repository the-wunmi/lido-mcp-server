import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetWithdrawalRequests,
  handleGetClaimableEth,
} from "../../src/tools/withdrawal-status.js";
import { sdk } from "../../src/sdk-factory.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function ensureMocks() {
  if (!(sdk.withdraw as any).requestsInfo) {
    (sdk.withdraw as any).requestsInfo = {};
  }
  if (!(sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo) {
    (sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo = vi.fn();
  }
  if (!(sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount) {
    (sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount = vi.fn();
  }
}

describe("handleGetWithdrawalRequests", () => {
  beforeEach(() => {
    ensureMocks();
  });

  it("returns withdrawal requests for the default wallet", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValue({
      claimableInfo: {
        claimableRequests: [
          { id: 1n, amountOfStETH: 1000000000000000000n, isClaimed: false },
        ],
        claimableAmountStETH: 1000000000000000000n,
      },
      pendingInfo: {
        pendingRequests: [],
        pendingAmountStETH: 0n,
      },
      claimableETH: {
        ethSum: 1000000000000000000n,
      },
    });

    const result = await handleGetWithdrawalRequests({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Withdrawal Requests for ${MOCK_ADDRESS}`);
    expect(text).toContain("Claimable requests (1):");
    expect(text).toContain("Request #1:");
    expect(text).toContain("finalized");
    expect(text).toContain("unclaimed");
  });

  it("returns withdrawal requests for a specified address", async () => {
    const addr = "0xcccccccccccccccccccccccccccccccccccccccc";
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValue({
      claimableInfo: { claimableRequests: [], claimableAmountStETH: 0n },
      pendingInfo: { pendingRequests: [], pendingAmountStETH: 0n },
      claimableETH: { ethSum: 0n },
    });

    const result = await handleGetWithdrawalRequests({ address: addr });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(addr);
    expect(result.content[0].text).toContain("No withdrawal requests found");
  });

  it("shows pending requests", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValue({
      claimableInfo: { claimableRequests: [], claimableAmountStETH: 0n },
      pendingInfo: {
        pendingRequests: [
          { id: 5n, amountOfStETH: 2000000000000000000n, timestamp: 1700000000n },
        ],
        pendingAmountStETH: 2000000000000000000n,
      },
      claimableETH: { ethSum: 0n },
    });

    const result = await handleGetWithdrawalRequests({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Pending requests (1):");
    expect(text).toContain("Request #5:");
    expect(text).toContain("pending since");
  });

  it("shows both claimable and pending requests", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockResolvedValue({
      claimableInfo: {
        claimableRequests: [
          { id: 1n, amountOfStETH: 1000000000000000000n, isClaimed: false },
        ],
        claimableAmountStETH: 1000000000000000000n,
      },
      pendingInfo: {
        pendingRequests: [
          { id: 2n, amountOfStETH: 2000000000000000000n, timestamp: 1700000000n },
        ],
        pendingAmountStETH: 2000000000000000000n,
      },
      claimableETH: { ethSum: 1000000000000000000n },
    });

    const result = await handleGetWithdrawalRequests({});
    const text = result.content[0].text;
    expect(text).toContain("Claimable requests (1):");
    expect(text).toContain("Pending requests (1):");
  });

  it("returns error for invalid address", async () => {
    const result = await handleGetWithdrawalRequests({ address: "not-valid" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getWithdrawalRequestsInfo).mockRejectedValue(
      new Error("withdrawal info failed"),
    );

    const result = await handleGetWithdrawalRequests({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("withdrawal info failed");
  });
});

describe("handleGetClaimableEth", () => {
  beforeEach(() => {
    ensureMocks();
  });

  it("returns claimable ETH breakdown", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 2000000000000000000n,
      requests: [
        { id: 1n },
        { id: 2n },
      ],
      ethByRequests: [
        1000000000000000000n,
        1000000000000000000n,
      ],
    });

    const result = await handleGetClaimableEth({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Claimable ETH for ${MOCK_ADDRESS}:`);
    expect(text).toContain("2 ETH");
    expect(text).toContain("Breakdown by request:");
    expect(text).toContain("Request #1:");
    expect(text).toContain("Request #2:");
  });

  it("reports no claimable ETH when ethSum is 0", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 0n,
      requests: [],
      ethByRequests: [],
    });

    const result = await handleGetClaimableEth({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("No claimable ETH");
  });

  it("uses a specified address", async () => {
    const addr = "0xdddddddddddddddddddddddddddddddddddddddd";
    vi.mocked((sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount).mockResolvedValue({
      ethSum: 0n,
      requests: [],
      ethByRequests: [],
    });

    const result = await handleGetClaimableEth({ address: addr });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(addr);
  });

  it("returns error for invalid address", async () => {
    const result = await handleGetClaimableEth({ address: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid input");
  });

  it("handles SDK error", async () => {
    vi.mocked((sdk.withdraw as any).requestsInfo.getClaimableRequestsETHByAccount).mockRejectedValue(
      new Error("claimable fetch failed"),
    );

    const result = await handleGetClaimableEth({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claimable fetch failed");
  });
});
