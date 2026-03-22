import { describe, it, expect, vi, beforeEach } from "vitest";
import { publicClient, walletClient, getAccountAddress } from "../../src/sdk-factory.js";
import {
  handleGetTokenInfo,
  handleGetAllowance,
  handleApproveToken,
  handleTransferToken,
  handleRevokeApproval,
  tokenInfoToolDef,
  allowanceToolDef,
  approveTokenToolDef,
  transferTokenToolDef,
  revokeApprovalToolDef,
} from "../../src/tools/tokens.js";

const MOCK_SPENDER = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
const MOCK_RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";

describe("token tool definitions", () => {
  it("tokenInfoToolDef has correct shape", () => {
    expect(tokenInfoToolDef.name).toBe("lido_get_token_info");
    expect(tokenInfoToolDef.annotations.readOnlyHint).toBe(true);
    expect(tokenInfoToolDef.inputSchema.required).toContain("token");
  });

  it("allowanceToolDef has correct shape", () => {
    expect(allowanceToolDef.name).toBe("lido_get_allowance");
    expect(allowanceToolDef.annotations.readOnlyHint).toBe(true);
    expect(allowanceToolDef.inputSchema.required).toContain("token");
    expect(allowanceToolDef.inputSchema.required).toContain("spender");
  });

  it("approveTokenToolDef has correct shape", () => {
    expect(approveTokenToolDef.name).toBe("lido_approve_token");
    expect(approveTokenToolDef.annotations.readOnlyHint).toBe(false);
  });

  it("transferTokenToolDef has correct shape", () => {
    expect(transferTokenToolDef.name).toBe("lido_transfer_token");
    expect(transferTokenToolDef.annotations.readOnlyHint).toBe(false);
    expect(transferTokenToolDef.annotations.destructiveHint).toBe(true);
  });

  it("revokeApprovalToolDef has correct shape", () => {
    expect(revokeApprovalToolDef.name).toBe("lido_revoke_approval");
    expect(revokeApprovalToolDef.annotations.readOnlyHint).toBe(false);
  });
});

describe("handleGetTokenInfo", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
  });

  it("returns token info for stETH", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce("Liquid staked Ether 2.0") // name
      .mockResolvedValueOnce("stETH")                    // symbol
      .mockResolvedValueOnce(18)                          // decimals
      .mockResolvedValueOnce(9_000_000n * 10n ** 18n);   // totalSupply

    const result = await handleGetTokenInfo({ token: "stETH" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("stETH");
    expect(text).toContain("Liquid staked Ether");
    expect(text).toContain("18");
  });

  it("rejects missing token", async () => {
    const result = await handleGetTokenInfo({});

    expect(result.isError).toBe(true);
  });

  it("rejects invalid token name", async () => {
    const result = await handleGetTokenInfo({ token: "INVALID" });

    expect(result.isError).toBe(true);
  });

  it("handles RPC errors", async () => {
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(new Error("rpc error"));

    const result = await handleGetTokenInfo({ token: "stETH" });

    expect(result.isError).toBe(true);
  });
});

describe("handleGetAllowance", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
  });

  it("returns allowance for stETH", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(5n * 10n ** 18n);

    const result = await handleGetAllowance({
      token: "stETH",
      spender: MOCK_SPENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Allowance");
    expect(result.content[0].text).toContain("5");
  });

  it("rejects missing spender", async () => {
    const result = await handleGetAllowance({ token: "stETH" });

    expect(result.isError).toBe(true);
  });

  it("rejects invalid spender address", async () => {
    const result = await handleGetAllowance({
      token: "stETH",
      spender: "not-an-address",
    });

    expect(result.isError).toBe(true);
  });
});

describe("handleApproveToken", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
    vi.mocked(publicClient.waitForTransactionReceipt).mockReset();
  });

  it("performs dry run by default", async () => {
    // Mock balanceOf + allowance reads
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(100n * 10n ** 18n)  // balanceOf
      .mockResolvedValueOnce(0n);                 // allowance
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: true } as any);

    const result = await handleApproveToken({
      token: "stETH",
      spender: MOCK_SPENDER,
      amount: "10.0",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("Your balance:");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("supports 'max' amount for unlimited approval", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(100n * 10n ** 18n)  // balanceOf
      .mockResolvedValueOnce(0n);                 // allowance
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: true } as any);

    const result = await handleApproveToken({
      token: "stETH",
      spender: MOCK_SPENDER,
      amount: "max",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(result.content[0].text).toContain("unlimited");
    expect(result.content[0].text).toContain("WARNING");
  });

  it("rejects missing token", async () => {
    const result = await handleApproveToken({
      spender: MOCK_SPENDER,
      amount: "10.0",
    });

    expect(result.isError).toBe(true);
  });
});

describe("handleTransferToken", () => {
  beforeEach(() => {
    vi.mocked(publicClient.readContract).mockReset();
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
    vi.mocked(publicClient.waitForTransactionReceipt).mockReset();
  });

  it("performs dry run by default", async () => {
    // Mock balanceOf to return sufficient balance
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(10n * 10n ** 18n);
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: true } as any);

    const result = await handleTransferToken({
      token: "stETH",
      to: MOCK_RECIPIENT,
      amount: "1.0",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("rejects missing recipient", async () => {
    const result = await handleTransferToken({
      token: "stETH",
      amount: "1.0",
    });

    expect(result.isError).toBe(true);
  });

  it("rejects invalid amount", async () => {
    const result = await handleTransferToken({
      token: "stETH",
      to: MOCK_RECIPIENT,
      amount: "not-a-number",
    });

    expect(result.isError).toBe(true);
  });
});

describe("handleRevokeApproval", () => {
  beforeEach(() => {
    vi.mocked(publicClient.simulateContract).mockReset();
    vi.mocked(walletClient.writeContract).mockReset();
    vi.mocked(publicClient.waitForTransactionReceipt).mockReset();
  });

  it("performs dry run by default", async () => {
    vi.mocked(publicClient.simulateContract).mockResolvedValueOnce({ result: true } as any);

    const result = await handleRevokeApproval({
      token: "stETH",
      spender: MOCK_SPENDER,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("DRY RUN");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("rejects missing spender", async () => {
    const result = await handleRevokeApproval({ token: "stETH" });

    expect(result.isError).toBe(true);
  });
});
