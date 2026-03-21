import { z } from "zod";
import { formatEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { textResult, errorResult } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";


const ARAGON_VOTING_ADDRESSES: Record<number, Address> = {
  1: "0x2e59A20f205bB85a89C53f1936454680651E618e",    // mainnet
  17000: "0xdA7d2573Df555002503F29aA4003e398d28cc00f", // holesky
  560048: "0x49B3512c44891bef83F8967d075121Bd1b07a01B", // hoodi
};

const LDO_TOKEN_ADDRESSES: Record<number, Address> = {
  1: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",    // mainnet
  17000: "0x14ae7daeecdf57034f3E9db8564e46Dba8D97344", // holesky
  560048: "0xEf2573966D009CcEA0Fc74451dee2193564198dc", // hoodi
};

function getVotingAddress(): Address {
  const addr = ARAGON_VOTING_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`Aragon voting not available on chain ${appConfig.chainId}`);
  return addr;
}

function getLdoAddress(): Address {
  const addr = LDO_TOKEN_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`LDO token not available on chain ${appConfig.chainId}`);
  return addr;
}


const votingAbi = [
  {
    name: "votesLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVote",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_voteId", type: "uint256" }],
    outputs: [
      { name: "open", type: "bool" },
      { name: "executed", type: "bool" },
      { name: "startDate", type: "uint64" },
      { name: "snapshotBlock", type: "uint64" },
      { name: "supportRequired", type: "uint64" },
      { name: "minAcceptQuorum", type: "uint64" },
      { name: "yea", type: "uint256" },
      { name: "nay", type: "uint256" },
      { name: "votingPower", type: "uint256" },
      { name: "script", type: "bytes" },
    ],
  },
  {
    name: "canVote",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_voter", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getVoterState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_voter", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "vote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_supports", type: "bool" },
      { name: "_executesIfDecided", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "voteTime",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

const ldoBalanceAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;


const VOTER_STATE_LABELS: Record<number, string> = {
  0: "Has not voted",
  1: "Voted Yea",
  2: "Voted Nay",
};


export const getAragonVoteToolDef = {
  name: "lido_get_aragon_vote",
  description:
    "Query Lido DAO Aragon governance votes. " +
    "Provide a vote_id to get details of a specific vote, or omit it to list recent votes. " +
    "Shows open/closed status, yea/nay counts, quorum progress, and your voting status. " +
    "LDO token holders can vote on DAO proposals.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vote_id: {
        type: "number",
        description: "Specific vote ID to query. If omitted, lists the most recent votes.",
      },
      count: {
        type: "number",
        description: "Number of recent votes to list (default: 5, max: 20). Only used when vote_id is omitted.",
      },
    },
  },
  annotations: {
    title: "Get Aragon Votes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const voteOnProposalToolDef = {
  name: "lido_vote_on_proposal",
  description:
    "Cast a vote on a Lido DAO Aragon governance proposal. " +
    "Requires LDO tokens in your wallet at the time the vote was created (snapshot block). " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vote_id: {
        type: "number",
        description: "The ID of the vote to cast on.",
      },
      support: {
        type: "boolean",
        description: "true = vote Yea (in favor), false = vote Nay (against).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vote_id", "support"],
  },
  annotations: {
    title: "Vote on Proposal",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true, // voting the same way twice is safe (overwrites previous vote)
    openWorldHint: false,
  },
};


const getVoteSchema = z.object({
  vote_id: z.number().int().min(0).optional(),
  count: z.number().int().min(1).max(20).optional().default(5),
});

const voteSchema = z.object({
  vote_id: z.number().int().min(0),
  support: z.boolean(),
  dry_run: z.boolean().optional().default(true),
});


function formatVotePercent(amount: bigint, total: bigint): string {
  if (total === 0n) return "0.00%";
  // Use basis points for precision: (amount * 10000) / total
  const bps = (amount * 10000n) / total;
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function formatSupportRequired(raw: bigint): string {
  // Aragon encodes percentages as values out of 10^18
  // e.g., 500000000000000000 = 50%
  const pct = Number(raw) / 1e16;
  return `${pct.toFixed(2)}%`;
}

function formatTimestamp(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

interface VoteData {
  open: boolean;
  executed: boolean;
  startDate: bigint;
  snapshotBlock: bigint;
  supportRequired: bigint;
  minAcceptQuorum: bigint;
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
  script: `0x${string}`;
}

async function fetchVoteDetails(votingAddress: Address, voteId: bigint): Promise<VoteData> {
  const result = await publicClient.readContract({
    address: votingAddress,
    abi: votingAbi,
    functionName: "getVote",
    args: [voteId],
  });

  return {
    open: result[0],
    executed: result[1],
    startDate: BigInt(result[2]),
    snapshotBlock: BigInt(result[3]),
    supportRequired: BigInt(result[4]),
    minAcceptQuorum: BigInt(result[5]),
    yea: BigInt(result[6]),
    nay: BigInt(result[7]),
    votingPower: BigInt(result[8]),
    script: result[9],
  };
}

function formatVoteSummary(voteId: number, vote: VoteData, voterState?: number, endDate?: bigint): string[] {
  const totalVoted = vote.yea + vote.nay;
  const participation = formatVotePercent(totalVoted, vote.votingPower);
  const yeaPct = formatVotePercent(vote.yea, totalVoted || 1n);
  const nayPct = formatVotePercent(vote.nay, totalVoted || 1n);

  let status = "Closed";
  if (vote.open) status = "Open";
  if (vote.executed) status = "Executed";

  const lines = [
    `Vote #${voteId}: ${status}`,
    `  Started: ${formatTimestamp(vote.startDate)}`,
  ];

  if (endDate !== undefined) {
    if (vote.open) {
      lines.push(`  Ends: ${formatTimestamp(endDate)}`);
    } else {
      lines.push(`  Ended: ${formatTimestamp(endDate)}`);
    }
  }

  lines.push(
    `  Yea: ${formatEther(vote.yea)} LDO (${yeaPct})`,
    `  Nay: ${formatEther(vote.nay)} LDO (${nayPct})`,
    `  Participation: ${participation} of ${formatEther(vote.votingPower)} LDO`,
    `  Support required: ${formatSupportRequired(vote.supportRequired)}`,
    `  Min quorum: ${formatSupportRequired(vote.minAcceptQuorum)}`,
  );

  if (voterState !== undefined) {
    lines.push(`  Your vote: ${VOTER_STATE_LABELS[voterState] ?? "Unknown"}`);
  }

  return lines;
}


export async function handleGetAragonVote(args: Record<string, unknown>) {
  try {
    const { vote_id, count } = getVoteSchema.parse(args);
    const votingAddress = getVotingAddress();
    const address = getAccountAddress();

    const [totalVotes, voteTime, ldoBalance] = await Promise.all([
      publicClient.readContract({
        address: votingAddress,
        abi: votingAbi,
        functionName: "votesLength",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: votingAbi,
        functionName: "voteTime",
      }),
      publicClient.readContract({
        address: getLdoAddress(),
        abi: ldoBalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const total = Number(totalVotes);
    const voteDuration = BigInt(voteTime);

    if (total === 0) {
      return textResult("No votes found in the Lido DAO Aragon voting contract.");
    }

    if (vote_id !== undefined) {
      if (vote_id >= total) {
        return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${total - 1}.`);
      }

      const [vote, voterState] = await Promise.all([
        fetchVoteDetails(votingAddress, BigInt(vote_id)),
        publicClient.readContract({
          address: votingAddress,
          abi: votingAbi,
          functionName: "getVoterState",
          args: [BigInt(vote_id), address],
        }),
      ]);

      const endDate = vote.startDate + voteDuration;
      const lines = [
        "=== Lido DAO Vote Details ===",
        "",
        ...formatVoteSummary(vote_id, vote, Number(voterState), endDate),
        "",
        `Your LDO balance: ${formatEther(ldoBalance)} LDO`,
      ];

      if (vote.open) {
        const canVote = await publicClient.readContract({
          address: votingAddress,
          abi: votingAbi,
          functionName: "canVote",
          args: [BigInt(vote_id), address],
        });
        lines.push(`Can you vote: ${canVote ? "YES" : "NO (no LDO at snapshot block or already voted)"}`);

        if (canVote) {
          lines.push(
            "",
            "To vote: use lido_vote_on_proposal with vote_id and support (true=Yea, false=Nay)",
          );
        }
      }

      lines.push(
        "",
        `Snapshot block: ${vote.snapshotBlock.toString()}`,
        `Has execution script: ${vote.script.length > 2 ? "Yes" : "No (text vote)"}`,
      );

      return textResult(lines.join("\n"));
    }

    const fetchCount = Math.min(count, total);

    const lines = [
      `=== Lido DAO Recent Votes (${fetchCount} of ${total} total) ===`,
      "",
      `Your LDO balance: ${formatEther(ldoBalance)} LDO`,
      `Vote duration: ${Number(voteDuration) / 3600}h`,
      "",
    ];

    const voteIds = Array.from({ length: fetchCount }, (_, i) => total - 1 - i);
    const votes = await Promise.all(
      voteIds.map(async (id) => {
        const [vote, voterState] = await Promise.all([
          fetchVoteDetails(votingAddress, BigInt(id)),
          publicClient.readContract({
            address: votingAddress,
            abi: votingAbi,
            functionName: "getVoterState",
            args: [BigInt(id), address],
          }),
        ]);
        return { id, vote, voterState: Number(voterState) };
      }),
    );

    for (const { id, vote, voterState } of votes) {
      const endDate = vote.startDate + voteDuration;
      lines.push(...formatVoteSummary(id, vote, voterState, endDate), "");
    }

    const openVotes = votes.filter(v => v.vote.open);
    if (openVotes.length > 0) {
      lines.push(
        `${openVotes.length} vote(s) currently open.`,
        "Use lido_vote_on_proposal to cast your vote.",
      );
    } else {
      lines.push("No votes currently open.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleVoteOnProposal(args: Record<string, unknown>) {
  try {
    const { vote_id, support, dry_run } = voteSchema.parse(args);
    const votingAddress = getVotingAddress();
    const address = getAccountAddress();

    const totalVotes = await publicClient.readContract({
      address: votingAddress,
      abi: votingAbi,
      functionName: "votesLength",
    });

    if (BigInt(vote_id) >= totalVotes) {
      return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${Number(totalVotes) - 1}.`);
    }

    const [vote, canVote, voterState, ldoBalance] = await Promise.all([
      fetchVoteDetails(votingAddress, BigInt(vote_id)),
      publicClient.readContract({
        address: votingAddress,
        abi: votingAbi,
        functionName: "canVote",
        args: [BigInt(vote_id), address],
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: votingAbi,
        functionName: "getVoterState",
        args: [BigInt(vote_id), address],
      }),
      publicClient.readContract({
        address: getLdoAddress(),
        abi: ldoBalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    if (!vote.open) {
      return errorResult(
        `Vote #${vote_id} is ${vote.executed ? "already executed" : "closed"}. ` +
        "Only open votes can be voted on.",
      );
    }

    if (!canVote) {
      const currentState = Number(voterState);
      if (currentState === 1 || currentState === 2) {
        return errorResult(
          `You have already voted ${VOTER_STATE_LABELS[currentState]} on vote #${vote_id}. ` +
          "You can change your vote by calling this tool again with a different support value.",
        );
      }
      return errorResult(
        `You cannot vote on vote #${vote_id}. ` +
        "This usually means you had no LDO tokens at the snapshot block " +
        `(block ${vote.snapshotBlock.toString()}).`,
      );
    }

    const supportLabel = support ? "Yea (in favor)" : "Nay (against)";

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 100_000n;
      let gasEstimateNote = "(using conservative estimate)";

      try {
        await publicClient.simulateContract({
          address: votingAddress,
          abi: votingAbi,
          functionName: "vote",
          args: [BigInt(vote_id), support, false],
          account: address,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: votingAddress,
          abi: votingAbi,
          functionName: "vote",
          args: [BigInt(vote_id), support, false],
          account: address,
        });
        gasEstimateNote = "";
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        "=== DRY RUN: Vote on Lido DAO Proposal ===",
        "",
        `Vote: #${vote_id}`,
        `Your vote: ${supportLabel}`,
        `Your LDO balance: ${formatEther(ldoBalance)} LDO`,
        "",
        "Current tally:",
        `  Yea: ${formatEther(vote.yea)} LDO`,
        `  Nay: ${formatEther(vote.nay)} LDO`,
        `  Participation: ${formatVotePercent(vote.yea + vote.nay, vote.votingPower)}`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Simulation note: ${simulationError}`);
      }

      lines.push(
        "",
        "What this does:",
        `  Your vote of ${supportLabel} will be recorded on-chain.`,
        "  Your voting power equals your LDO balance at the vote's snapshot block.",
        "  You can change your vote later by voting again while the vote is open.",
      );

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: votingAddress,
      abi: votingAbi,
      functionName: "vote",
      args: [BigInt(vote_id), support, false],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const lines = [
      "=== Vote Cast on Lido DAO Proposal ===",
      `Transaction hash: ${txHash}`,
      `Vote: #${vote_id}`,
      `Your vote: ${supportLabel}`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      "",
      "Use lido_get_aragon_vote to see the updated tally.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
