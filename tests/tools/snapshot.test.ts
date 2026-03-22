import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetSnapshotProposals,
  handleGetSnapshotProposal,
  handleVoteOnSnapshot,
} from "../../src/tools/snapshot.js";
import { walletClient } from "../../src/sdk-factory.js";

vi.mock("../../src/utils/snapshot-client.js", () => ({
  getSnapshotProposals: vi.fn(),
  getSnapshotProposal: vi.fn(),
  getSnapshotVotes: vi.fn(),
  getSnapshotVotingPower: vi.fn(),
  submitSnapshotVote: vi.fn(),
  LIDO_SNAPSHOT_SPACE: "lido-snapshot.eth",
  SNAPSHOT_EIP712_DOMAIN: { name: "snapshot", version: "0.1.4" },
  SNAPSHOT_VOTE_TYPES: {
    Vote: [
      { name: "from", type: "address" },
      { name: "space", type: "string" },
      { name: "timestamp", type: "uint64" },
      { name: "proposal", type: "bytes32" },
      { name: "choice", type: "uint32" },
      { name: "reason", type: "string" },
      { name: "app", type: "string" },
      { name: "metadata", type: "string" },
    ],
  },
}));

import {
  getSnapshotProposals,
  getSnapshotProposal,
  getSnapshotVotes,
  getSnapshotVotingPower,
  submitSnapshotVote,
} from "../../src/utils/snapshot-client.js";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

const mockProposal = {
  id: "0xabc123",
  title: "Test Proposal",
  body: "This is a test proposal body.",
  state: "active",
  type: "single-choice",
  author: "0xauthor",
  created: 1700000000,
  start: 1700000000,
  end: 1700259200,
  choices: ["For", "Against", "Abstain"],
  scores: [100, 50, 10],
  scores_total: 160,
  quorum: 50,
  votes: 30,
  snapshot: "18000000",
  space: { id: "lido-snapshot.eth" },
  strategies: [{ name: "erc20-balance-of", network: "1", params: {} }],
};

describe("handleGetSnapshotProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of proposals", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([mockProposal]);

    const result = await handleGetSnapshotProposals({});
    const text = result.content[0].text;

    expect(text).toContain("Lido Snapshot Proposals");
    expect(text).toContain("Test Proposal");
    expect(text).toContain("Active");
    expect(text).toContain("lido-snapshot.eth");
  });

  it("returns no proposals message when empty", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([]);

    const result = await handleGetSnapshotProposals({});
    const text = result.content[0].text;

    expect(text).toContain("No");
    expect(text).toContain("Snapshot proposals found");
  });

  it("filters by state", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([]);

    await handleGetSnapshotProposals({ state: "closed" });

    expect(getSnapshotProposals).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" })
    );
  });

  it("passes search parameter", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([]);

    await handleGetSnapshotProposals({ search: "treasury" });

    expect(getSnapshotProposals).toHaveBeenCalledWith(
      expect.objectContaining({ search: "treasury" })
    );
  });

  it("passes count parameter", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([]);

    await handleGetSnapshotProposals({ count: 5 });

    expect(getSnapshotProposals).toHaveBeenCalledWith(
      expect.objectContaining({ first: 5 })
    );
  });

  it("handles API error gracefully", async () => {
    vi.mocked(getSnapshotProposals).mockRejectedValueOnce(
      new Error("Snapshot API error: 500")
    );

    const result = await handleGetSnapshotProposals({});
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Snapshot API error");
  });

  it("shows active proposals hint", async () => {
    vi.mocked(getSnapshotProposals).mockResolvedValueOnce([mockProposal]);

    const result = await handleGetSnapshotProposals({});
    const text = result.content[0].text;

    expect(text).toContain("1 proposal(s) currently active");
    expect(text).toContain("lido_vote_on_snapshot");
  });
});

describe("handleGetSnapshotProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns full proposal details", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);
    vi.mocked(getSnapshotVotes).mockResolvedValueOnce([]);
    vi.mocked(getSnapshotVotingPower).mockResolvedValueOnce({
      vp: 100.5,
      vp_by_strategy: [100.5],
      vp_state: "final",
    });

    const result = await handleGetSnapshotProposal({ proposal_id: "0xabc123" });
    const text = result.content[0].text;

    expect(text).toContain("Snapshot Proposal: Test Proposal");
    expect(text).toContain("ID: 0xabc123");
    expect(text).toContain("State: Active");
    expect(text).toContain("Choices & Scores");
    expect(text).toContain("For:");
    expect(text).toContain("Against:");
    expect(text).toContain("Voting power: 100.50");
    expect(text).toContain("Your vote: Not yet voted");
    expect(text).toContain("Proposal Body");
    expect(text).toContain("lido_vote_on_snapshot");
  });

  it("shows user's existing vote", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);
    vi.mocked(getSnapshotVotes).mockResolvedValueOnce([
      { id: "v1", voter: MOCK_ADDRESS, choice: 1, vp: 50.0, reason: "I agree", created: 1700000100 },
    ]);
    vi.mocked(getSnapshotVotingPower).mockResolvedValueOnce({
      vp: 50.0,
      vp_by_strategy: [50.0],
      vp_state: "final",
    });

    const result = await handleGetSnapshotProposal({ proposal_id: "0xabc123" });
    const text = result.content[0].text;

    expect(text).toContain("Your vote: For");
    expect(text).toContain("power: 50.00");
    expect(text).toContain("Reason: I agree");
  });

  it("returns error when proposal not found", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(null);

    const result = await handleGetSnapshotProposal({ proposal_id: "0xnonexistent" });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("not found");
  });

  it("handles missing proposal_id parameter", async () => {
    const result = await handleGetSnapshotProposal({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleVoteOnSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dry run output for a valid vote", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);
    vi.mocked(getSnapshotVotingPower).mockResolvedValueOnce({
      vp: 75.0,
      vp_by_strategy: [75.0],
      vp_state: "final",
    });

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xabc123",
      choice: 1,
    });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Vote on Snapshot Proposal");
    expect(text).toContain("Test Proposal");
    expect(text).toContain("Your choice: 1. For");
    expect(text).toContain("Your voting power: 75.00");
    expect(text).toContain("Set dry_run=false");
  });

  it("submits vote when dry_run=false", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);
    vi.mocked(getSnapshotVotingPower).mockResolvedValueOnce({
      vp: 75.0,
      vp_by_strategy: [75.0],
      vp_state: "final",
    });
    vi.mocked(walletClient.signTypedData).mockResolvedValueOnce("0xsignature" as `0x${string}`);
    vi.mocked(submitSnapshotVote).mockResolvedValueOnce({ id: "vote-id-123" });

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xabc123",
      choice: 2,
      reason: "My reason",
      dry_run: false,
    });
    const text = result.content[0].text;

    expect(text).toContain("Vote Submitted on Snapshot");
    expect(text).toContain("Your vote: 2. Against");
    expect(text).toContain("Reason: My reason");
    expect(text).toContain("Vote ID: vote-id-123");
  });

  it("returns error when proposal is not active", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce({
      ...mockProposal,
      state: "closed",
    });

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xabc123",
      choice: 1,
    });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("closed");
    expect(result.content[0].text).toContain("not active");
  });

  it("returns error for invalid choice number", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xabc123",
      choice: 10,
    });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Invalid choice 10");
  });

  it("returns error when voting power is zero", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(mockProposal);
    vi.mocked(getSnapshotVotingPower).mockResolvedValueOnce({
      vp: 0,
      vp_by_strategy: [0],
      vp_state: "final",
    });

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xabc123",
      choice: 1,
    });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("zero voting power");
  });

  it("returns error when proposal not found", async () => {
    vi.mocked(getSnapshotProposal).mockResolvedValueOnce(null);

    const result = await handleVoteOnSnapshot({
      proposal_id: "0xnonexistent",
      choice: 1,
    });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("not found");
  });

  it("handles missing required params", async () => {
    const result = await handleVoteOnSnapshot({});
    expect(result).toHaveProperty("isError", true);
  });
});
