import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleGetAragonVote,
  handleVoteOnProposal,
  handleAnalyzeAragonVote,
  handleGetAragonVoteScript,
  handleGetAragonVoteTimeline,
} from "../../src/tools/aragon-voting.js";
import { publicClient, walletClient } from "../../src/sdk-factory.js";

function makeVoteTuple({
  open = true,
  executed = false,
  startDate = 1700000000n,
  snapshotBlock = 17900000n,
  supportRequired = 500000000000000000n, // 50%
  minAcceptQuorum = 50000000000000000n,  // 5%
  yea = 1000000000000000000000n,         // 1000 LDO
  nay = 100000000000000000000n,          // 100 LDO
  votingPower = 10000000000000000000000n, // 10000 LDO
  script = "0x" as `0x${string}`,
} = {}) {
  return [open, executed, startDate, snapshotBlock, supportRequired, minAcceptQuorum, yea, nay, votingPower, script];
}

describe("handleGetAragonVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns specific vote details when vote_id is given", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(500000000000000000n) // LDO balance
      .mockResolvedValueOnce(makeVoteTuple()) // getVote
      .mockResolvedValueOnce(1) // getVoterState (Yea)
      .mockResolvedValueOnce(true); // canVote

    const result = await handleGetAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Lido DAO Vote Details");
    expect(text).toContain("Vote #5: Open");
    expect(text).toContain("Yea:");
    expect(text).toContain("Nay:");
    expect(text).toContain("Your vote: Voted Yea");
    expect(text).toContain("Can you vote: YES");
  });

  it("returns recent votes when no vote_id is given", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(3n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(1000000000000000000n) // LDO balance
      .mockResolvedValueOnce(makeVoteTuple({ open: true }))
      .mockResolvedValueOnce(0) // voter state
      .mockResolvedValueOnce(makeVoteTuple({ open: false }))
      .mockResolvedValueOnce(1) // voter state
      .mockResolvedValueOnce(makeVoteTuple({ open: false, executed: true }))
      .mockResolvedValueOnce(2); // voter state

    const result = await handleGetAragonVote({});
    const text = result.content[0].text;

    expect(text).toContain("Lido DAO Recent Votes (3 of 3 total)");
    expect(text).toContain("1 vote(s) currently open");
  });

  it("returns error when vote_id exceeds total", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(5n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n); // LDO balance

    const result = await handleGetAragonVote({ vote_id: 10 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Vote #10 does not exist");
  });

  it("returns message when no votes exist", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(0n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n); // LDO balance

    const result = await handleGetAragonVote({});
    const text = result.content[0].text;

    expect(text).toContain("No votes found");
  });

  it("handles custom count parameter", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(20n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n); // LDO balance

    // Mock 2 votes (count=2)
    for (let i = 0; i < 2; i++) {
      vi.mocked(publicClient.readContract)
        .mockResolvedValueOnce(makeVoteTuple({ open: false }))
        .mockResolvedValueOnce(0);
    }

    const result = await handleGetAragonVote({ count: 2 });
    const text = result.content[0].text;

    expect(text).toContain("2 of 20 total");
  });
});

describe("handleVoteOnProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dry run output for a valid vote", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple()) // getVote
      .mockResolvedValueOnce(true) // canVote
      .mockResolvedValueOnce(0) // getVoterState
      .mockResolvedValueOnce(1000000000000000000n); // LDO balance

    const result = await handleVoteOnProposal({ vote_id: 5, support: true });
    const text = result.content[0].text;

    expect(text).toContain("DRY RUN: Vote on Lido DAO Proposal");
    expect(text).toContain("Vote: #5");
    expect(text).toContain("Your vote: Yea (in favor)");
    expect(text).toContain("Simulation:");
  });

  it("executes vote when dry_run=false", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple()) // getVote
      .mockResolvedValueOnce(true) // canVote
      .mockResolvedValueOnce(0) // getVoterState
      .mockResolvedValueOnce(1000000000000000000n); // LDO balance

    vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xvotehash" as `0x${string}`);
    vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({
      status: "success",
    } as any);

    const result = await handleVoteOnProposal({ vote_id: 5, support: false, dry_run: false });
    const text = result.content[0].text;

    expect(text).toContain("Vote Cast on Lido DAO Proposal");
    expect(text).toContain("Transaction hash: 0xvotehash");
    expect(text).toContain("Your vote: Nay (against)");
    expect(text).toContain("Status: Confirmed");
  });

  it("returns error when vote does not exist", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(5n); // votesLength

    const result = await handleVoteOnProposal({ vote_id: 10, support: true });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Vote #10 does not exist");
  });

  it("returns error when vote is closed", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple({ open: false })) // getVote (closed)
      .mockResolvedValueOnce(false) // canVote
      .mockResolvedValueOnce(0) // getVoterState
      .mockResolvedValueOnce(0n); // LDO balance

    const result = await handleVoteOnProposal({ vote_id: 5, support: true });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("closed");
  });

  it("returns error when user cannot vote", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple()) // getVote (open)
      .mockResolvedValueOnce(false) // canVote
      .mockResolvedValueOnce(0) // getVoterState (has not voted)
      .mockResolvedValueOnce(0n); // LDO balance

    const result = await handleVoteOnProposal({ vote_id: 5, support: true });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("cannot vote");
  });

  it("returns already voted error when canVote=false and voterState=1", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple()) // getVote (open)
      .mockResolvedValueOnce(false) // canVote
      .mockResolvedValueOnce(1) // getVoterState (Voted Yea)
      .mockResolvedValueOnce(1000000000000000000n); // LDO balance

    const result = await handleVoteOnProposal({ vote_id: 5, support: true });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("already voted");
  });

  it("returns error for missing required params", async () => {
    const result = await handleVoteOnProposal({ support: true });
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleAnalyzeAragonVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deep analysis of a vote", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(86400n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple()); // getVote

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Deep Analysis: Aragon Vote #5");
    expect(text).toContain("Tally");
    expect(text).toContain("Quorum");
    expect(text).toContain("Projection");
    expect(text).toContain("Script");
  });

  it("returns error when vote does not exist", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(3n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(86400n); // objectionPhaseTime

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Vote #5 does not exist");
  });

  it("shows correct phase and pass/fail projection", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n)
      .mockResolvedValueOnce(259200n)
      .mockResolvedValueOnce(0n) // no objection phase
      .mockResolvedValueOnce(makeVoteTuple({
        yea: 5000000000000000000000n, // 5000 LDO
        nay: 100000000000000000000n,   // 100 LDO
        votingPower: 10000000000000000000000n, // 10000 LDO
      }));

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Would pass at current tallies: YES");
    expect(text).toContain("Support and quorum thresholds met");
  });

  it("shows Top Voters section when CastVote events are returned", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple({
        snapshotBlock: 17900000n,
        yea: 5000000000000000000000n,
        nay: 100000000000000000000n,
        votingPower: 10000000000000000000000n,
      }));

    vi.mocked(publicClient.getBlockNumber).mockResolvedValueOnce(18000000n);
    vi.mocked(publicClient.getLogs).mockResolvedValueOnce([
      {
        args: {
          voter: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          supports: true,
          stake: 3000000000000000000000n, // 3000 LDO
        },
      },
      {
        args: {
          voter: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          supports: false,
          stake: 1000000000000000000000n, // 1000 LDO
        },
      },
      {
        args: {
          voter: "0xcccccccccccccccccccccccccccccccccccccccc",
          supports: true,
          stake: 500000000000000000000n, // 500 LDO
        },
      },
    ] as any);

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Top Voters");
    expect(text).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(text).toContain("Yea");
    expect(text).toContain("3000");
    expect(text).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(text).toContain("Nay");
    expect(text).toContain("3 total votes cast");
  });

  it("shows fallback message when getLogs fails", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple({
        snapshotBlock: 17900000n,
      }));

    vi.mocked(publicClient.getBlockNumber).mockRejectedValueOnce(
      new Error("getLogs RPC error")
    );

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Unable to fetch voter breakdown");
  });

  it("shows 'No votes cast' when yea and nay are both zero", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple({
        yea: 0n,
        nay: 0n,
        votingPower: 10000000000000000000000n,
      }));

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Would pass at current tallies: NO");
    expect(text).toContain("No votes cast");
  });

  it("shows 'No voting power' when votingPower is zero", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(0n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple({
        yea: 1000000000000000000000n,
        nay: 0n,
        votingPower: 0n,
        supportRequired: 500000000000000000n,
        minAcceptQuorum: 50000000000000000n,
      }));

    const result = await handleAnalyzeAragonVote({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Would pass at current tallies: NO");
    expect(text).toContain("No voting power");
  });

  it("handles missing vote_id parameter", async () => {
    const result = await handleAnalyzeAragonVote({});
    expect(result).toHaveProperty("isError", true);
  });
});

describe("handleGetAragonVoteScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns text-vote message for empty script", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple({ script: "0x" })); // getVote

    const result = await handleGetAragonVoteScript({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("text-only vote");
    expect(text).toContain("no execution script");
  });

  it("decodes EVM script with known selector", async () => {
    const target = "1234567890abcdef1234567890abcdef12345678";
    const selector = "b61d27f6";
    const calldata = selector + "00".repeat(32);
    const calldataLenHex = (calldata.length / 2).toString(16).padStart(8, "0");
    const script = ("0x00000001" + target + calldataLenHex + calldata) as `0x${string}`;

    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(makeVoteTuple({ script })); // getVote

    const result = await handleGetAragonVoteScript({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Aragon Vote #5 Script");
    expect(text).toContain("Actions found:");
    expect(text).toContain("forward(bytes)");
  });

  it("returns error when vote does not exist", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce(3n);

    const result = await handleGetAragonVoteScript({ vote_id: 5 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Vote #5 does not exist");
  });
});

describe("handleGetAragonVoteTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns timeline for a vote", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n) // votesLength
      .mockResolvedValueOnce(259200n) // voteTime
      .mockResolvedValueOnce(86400n) // objectionPhaseTime
      .mockResolvedValueOnce(makeVoteTuple()); // getVote

    const result = await handleGetAragonVoteTimeline({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).toContain("Aragon Vote #5 Timeline");
    expect(text).toContain("Start:");
    expect(text).toContain("Main phase end:");
    expect(text).toContain("Objection phase end:");
    expect(text).toContain("Current phase:");
    expect(text).toContain("Progress");
  });

  it("returns error when vote does not exist", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(3n)
      .mockResolvedValueOnce(259200n)
      .mockResolvedValueOnce(86400n);

    const result = await handleGetAragonVoteTimeline({ vote_id: 5 });
    expect(result).toHaveProperty("isError", true);
    expect(result.content[0].text).toContain("Vote #5 does not exist");
  });

  it("omits objection phase info when objectionPhaseTime is 0", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce(10n)
      .mockResolvedValueOnce(259200n)
      .mockResolvedValueOnce(0n) // no objection phase
      .mockResolvedValueOnce(makeVoteTuple());

    const result = await handleGetAragonVoteTimeline({ vote_id: 5 });
    const text = result.content[0].text;

    expect(text).not.toContain("Objection phase end:");
  });
});
