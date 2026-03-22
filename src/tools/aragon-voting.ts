import { z } from "zod";
import { formatEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, formatPercent, formatTimestamp, formatDuration } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { getAragonVotingAddress, aragonVotingAbi } from "../utils/aragon-abi.js";
import { getLdoTokenAddress, ldoBalanceAbi } from "../utils/easytrack-abi.js";


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
    abi: aragonVotingAbi,
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
    const votingAddress = getAragonVotingAddress();
    const address = getAccountAddress();

    const [totalVotes, voteTime, ldoBalance] = await Promise.all([
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "votesLength",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "voteTime",
      }),
      publicClient.readContract({
        address: getLdoTokenAddress(),
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
          abi: aragonVotingAbi,
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
          abi: aragonVotingAbi,
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
            abi: aragonVotingAbi,
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
    const votingAddress = getAragonVotingAddress();
    const address = getAccountAddress();

    const totalVotes = await publicClient.readContract({
      address: votingAddress,
      abi: aragonVotingAbi,
      functionName: "votesLength",
    });

    if (BigInt(vote_id) >= totalVotes) {
      return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${Number(totalVotes) - 1}.`);
    }

    const [vote, canVote, voterState, ldoBalance] = await Promise.all([
      fetchVoteDetails(votingAddress, BigInt(vote_id)),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "canVote",
        args: [BigInt(vote_id), address],
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "getVoterState",
        args: [BigInt(vote_id), address],
      }),
      publicClient.readContract({
        address: getLdoTokenAddress(),
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
          abi: aragonVotingAbi,
          functionName: "vote",
          args: [BigInt(vote_id), support, false],
          account: address,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: votingAddress,
          abi: aragonVotingAbi,
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
      abi: aragonVotingAbi,
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

export const analyzeAragonVoteToolDef = {
  name: "lido_analyze_aragon_vote",
  description:
    "Deep analysis of an Aragon DAO vote: quorum progress %, time remaining, current phase " +
    "(main/objection/ended), pass/fail projection at current tallies, whether an execution script is present, " +
    "and top voter breakdown via CastVote events.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vote_id: {
        type: "number",
        description: "The vote ID to analyze.",
      },
    },
    required: ["vote_id"],
  },
  annotations: {
    title: "Analyze Aragon Vote",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getAragonVoteScriptToolDef = {
  name: "lido_get_aragon_vote_script",
  description:
    "Decode the EVM script from an Aragon vote into human-readable actions. " +
    "Shows target contract, function selector, and decoded arguments for known Lido ABIs. " +
    "Falls back to raw hex for unknown selectors.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vote_id: {
        type: "number",
        description: "The vote ID to decode the script for.",
      },
    },
    required: ["vote_id"],
  },
  annotations: {
    title: "Get Aragon Vote Script",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getAragonVoteTimelineToolDef = {
  name: "lido_get_aragon_vote_timeline",
  description:
    "Timeline for an Aragon vote: start time, main phase end, objection phase end, " +
    "current phase, time remaining, quorum status, and pass/fail projection.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vote_id: {
        type: "number",
        description: "The vote ID to get the timeline for.",
      },
    },
    required: ["vote_id"],
  },
  annotations: {
    title: "Get Aragon Vote Timeline",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const analyzeVoteSchema = z.object({
  vote_id: z.number().int().min(0),
});

const voteScriptSchema = z.object({
  vote_id: z.number().int().min(0),
});

const voteTimelineSchema = z.object({
  vote_id: z.number().int().min(0),
});

function getVotePhase(
  startDate: number,
  voteTime: number,
  objectionPhaseTime: number,
  now: number,
): { phase: string; timeRemaining: number } {
  const mainPhaseEnd = startDate + voteTime - objectionPhaseTime;
  const totalEnd = startDate + voteTime;

  if (now >= totalEnd) {
    return { phase: "Ended", timeRemaining: 0 };
  }
  if (now >= mainPhaseEnd) {
    return { phase: "Objection", timeRemaining: totalEnd - now };
  }
  return { phase: "Main", timeRemaining: mainPhaseEnd - now };
}

function wouldPass(vote: VoteData): { pass: boolean; reason: string } {
  const totalVoted = vote.yea + vote.nay;
  if (totalVoted === 0n) {
    return { pass: false, reason: "No votes cast" };
  }

  // Check support: yea / (yea + nay) > supportRequired
  const supportBps = (vote.yea * 10000n) / totalVoted;
  const requiredBps = (vote.supportRequired * 10000n) / BigInt(1e18);
  if (supportBps <= requiredBps) {
    return { pass: false, reason: `Support ${(Number(supportBps) / 100).toFixed(2)}% <= required ${(Number(requiredBps) / 100).toFixed(2)}%` };
  }

  // Check quorum: yea / votingPower > minAcceptQuorum
  if (vote.votingPower === 0n) {
    return { pass: false, reason: "No voting power" };
  }
  const quorumBps = (vote.yea * 10000n) / vote.votingPower;
  const requiredQuorumBps = (vote.minAcceptQuorum * 10000n) / BigInt(1e18);
  if (quorumBps < requiredQuorumBps) {
    return { pass: false, reason: `Quorum ${(Number(quorumBps) / 100).toFixed(2)}% < required ${(Number(requiredQuorumBps) / 100).toFixed(2)}%` };
  }

  return { pass: true, reason: "Support and quorum thresholds met" };
}

export async function handleAnalyzeAragonVote(args: Record<string, unknown>) {
  try {
    const { vote_id } = analyzeVoteSchema.parse(args);
    const votingAddress = getAragonVotingAddress();
    const now = Math.floor(Date.now() / 1000);

    const [totalVotes, voteTimeBigInt, objectionPhaseTimeBigInt] = await Promise.all([
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "votesLength",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "voteTime",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "objectionPhaseTime",
      }).catch(() => 0n),
    ]);

    if (BigInt(vote_id) >= totalVotes) {
      return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${Number(totalVotes) - 1}.`);
    }

    const vote = await fetchVoteDetails(votingAddress, BigInt(vote_id));
    const voteTimeNum = Number(voteTimeBigInt);
    const objPhaseTime = Number(objectionPhaseTimeBigInt);
    const startDate = Number(vote.startDate);

    const { phase, timeRemaining } = getVotePhase(startDate, voteTimeNum, objPhaseTime, now);
    const projection = wouldPass(vote);

    const totalVoted = vote.yea + vote.nay;
    const participation = vote.votingPower > 0n
      ? (Number(totalVoted * 10000n / vote.votingPower) / 100).toFixed(2)
      : "0.00";

    const quorumProgress = vote.votingPower > 0n
      ? (Number(vote.yea * 10000n / vote.votingPower) / 100).toFixed(2)
      : "0.00";
    const quorumRequired = (Number(vote.minAcceptQuorum) / 1e16).toFixed(2);

    const lines = [
      `=== Deep Analysis: Aragon Vote #${vote_id} ===`,
      "",
      `Status: ${vote.open ? "Open" : vote.executed ? "Executed" : "Closed"}`,
      `Phase: ${phase}${timeRemaining > 0 ? ` (${formatDuration(timeRemaining)} remaining)` : ""}`,
      "",
      "--- Tally ---",
      `  Yea: ${formatEther(vote.yea)} LDO (${formatVotePercent(vote.yea, totalVoted || 1n)})`,
      `  Nay: ${formatEther(vote.nay)} LDO (${formatVotePercent(vote.nay, totalVoted || 1n)})`,
      `  Participation: ${participation}% of ${formatEther(vote.votingPower)} LDO`,
      "",
      "--- Quorum ---",
      `  Progress: ${quorumProgress}% (Yea / Total Voting Power)`,
      `  Required: ${quorumRequired}%`,
      `  Status: ${Number(quorumProgress) >= Number(quorumRequired) ? "REACHED" : "NOT reached"}`,
      "",
      "--- Projection ---",
      `  Would pass at current tallies: ${projection.pass ? "YES" : "NO"}`,
      `  Reason: ${projection.reason}`,
      "",
      "--- Script ---",
      `  Has execution script: ${vote.script.length > 2 ? "Yes" : "No (text vote)"}`,
      `  Script size: ${vote.script.length > 2 ? `${(vote.script.length - 2) / 2} bytes` : "N/A"}`,
    ];

    // Fetch top voters from CastVote events (chunked to avoid block range limits)
    try {
      const castVoteEvent = {
        type: "event" as const,
        name: "CastVote" as const,
        inputs: [
          { name: "voteId", type: "uint256" as const, indexed: true },
          { name: "voter", type: "address" as const, indexed: true },
          { name: "supports", type: "bool" as const, indexed: false },
          { name: "stake", type: "uint256" as const, indexed: false },
        ],
      };

      const startBlock = BigInt(Number(vote.snapshotBlock));
      const currentBlock = await publicClient.getBlockNumber();
      const MAX_BLOCK_RANGE = 10_000n;

      let allLogs: Array<{ args: { voter?: string; supports?: boolean; stake?: bigint } }> = [];
      let from = startBlock;
      while (from <= currentBlock) {
        const to = from + MAX_BLOCK_RANGE > currentBlock ? currentBlock : from + MAX_BLOCK_RANGE;
        const chunk = await publicClient.getLogs({
          address: votingAddress,
          event: castVoteEvent,
          args: { voteId: BigInt(vote_id) },
          fromBlock: from,
          toBlock: to,
        });
        allLogs = allLogs.concat(chunk as typeof allLogs);
        from = to + 1n;
      }

      if (allLogs.length > 0) {
        const voters = allLogs
          .map((log) => ({
            voter: log.args.voter as string,
            supports: log.args.supports as boolean,
            stake: log.args.stake as bigint,
          }))
          .sort((a, b) => Number(b.stake - a.stake));

        const topVoters = voters.slice(0, 5);

        lines.push("", "--- Top Voters ---");
        for (const v of topVoters) {
          lines.push(
            `  ${v.voter}: ${v.supports ? "Yea" : "Nay"} — ${formatEther(v.stake)} LDO`,
          );
        }
        lines.push(`  (${allLogs.length} total votes cast)`);
      }
    } catch {
      lines.push("", "  (Unable to fetch voter breakdown — event logs may be unavailable)");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

const KNOWN_SELECTORS: Record<string, { name: string; params: string[] }> = {
  "0xb61d27f6": { name: "forward(bytes)", params: ["evmCallScript"] },
  "0xd948d468": { name: "createPermission(address,address,bytes32,address)", params: ["entity", "app", "role", "manager"] },
  "0x0b9d9f37": { name: "revokePermission(address,address,bytes32)", params: ["entity", "app", "role"] },
  "0x4b6a1dcc": { name: "removePermissionManager(address,bytes32)", params: ["app", "role"] },
  "0x907db0cb": { name: "setApp(bytes32,bytes32,address)", params: ["namespace", "appId", "app"] },
  "0xa1658fad": { name: "hasPermission(address,address,bytes32,bytes)", params: ["who", "where", "what", "how"] },
};

function decodeEvmScript(script: `0x${string}`): Array<{ target: string; selector: string; label: string; calldataHex: string }> {
  if (script.length <= 10) return []; // 0x + 8 chars spec ID minimum

  const actions: Array<{ target: string; selector: string; label: string; calldataHex: string }> = [];
  const bytes = script.slice(10); // skip 0x + 4-byte spec ID (8 hex chars)

  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 40 > bytes.length) break; // need at least 20 bytes for target
    const target = "0x" + bytes.slice(offset, offset + 40);
    offset += 40;

    if (offset + 8 > bytes.length) break; // 4 bytes for calldata length
    const calldataLen = parseInt(bytes.slice(offset, offset + 8), 16) * 2; // convert to hex chars
    offset += 8;

    if (offset + calldataLen > bytes.length) break;
    const calldataHex = "0x" + bytes.slice(offset, offset + calldataLen);
    offset += calldataLen;

    const selector = calldataHex.length >= 10 ? calldataHex.slice(0, 10) : calldataHex;
    const known = KNOWN_SELECTORS[selector];
    const label = known ? known.name : `unknown(${selector})`;

    actions.push({ target, selector, label, calldataHex });
  }

  return actions;
}

export async function handleGetAragonVoteScript(args: Record<string, unknown>) {
  try {
    const { vote_id } = voteScriptSchema.parse(args);
    const votingAddress = getAragonVotingAddress();

    const totalVotes = await publicClient.readContract({
      address: votingAddress,
      abi: aragonVotingAbi,
      functionName: "votesLength",
    });

    if (BigInt(vote_id) >= totalVotes) {
      return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${Number(totalVotes) - 1}.`);
    }

    const vote = await fetchVoteDetails(votingAddress, BigInt(vote_id));

    if (vote.script.length <= 2) {
      return textResult(
        `=== Aragon Vote #${vote_id} Script ===\n\n` +
        "This is a text-only vote with no execution script.\n" +
        "No on-chain actions will be performed if this vote passes."
      );
    }

    const actions = decodeEvmScript(vote.script);

    const lines = [
      `=== Aragon Vote #${vote_id} Script ===`,
      "",
      `Script size: ${(vote.script.length - 2) / 2} bytes`,
      `Actions found: ${actions.length}`,
      "",
    ];

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      lines.push(
        `Action ${i + 1}:`,
        `  Target: ${a.target}`,
        `  Function: ${a.label}`,
        `  Calldata: ${a.calldataHex.length > 66 ? a.calldataHex.slice(0, 66) + "..." : a.calldataHex}`,
        "",
      );
    }

    if (actions.length === 0) {
      lines.push("Unable to decode script actions. Raw script data:");
      lines.push(`  ${vote.script.slice(0, 200)}${vote.script.length > 200 ? "..." : ""}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetAragonVoteTimeline(args: Record<string, unknown>) {
  try {
    const { vote_id } = voteTimelineSchema.parse(args);
    const votingAddress = getAragonVotingAddress();
    const now = Math.floor(Date.now() / 1000);

    const [totalVotes, voteTimeBigInt, objectionPhaseTimeBigInt] = await Promise.all([
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "votesLength",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "voteTime",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "objectionPhaseTime",
      }).catch(() => 0n),
    ]);

    if (BigInt(vote_id) >= totalVotes) {
      return errorResult(`Vote #${vote_id} does not exist. Latest vote is #${Number(totalVotes) - 1}.`);
    }

    const vote = await fetchVoteDetails(votingAddress, BigInt(vote_id));
    const startDate = Number(vote.startDate);
    const voteTimeNum = Number(voteTimeBigInt);
    const objPhaseTime = Number(objectionPhaseTimeBigInt);

    const mainPhaseEnd = startDate + voteTimeNum - objPhaseTime;
    const totalEnd = startDate + voteTimeNum;
    const { phase, timeRemaining } = getVotePhase(startDate, voteTimeNum, objPhaseTime, now);

    const projection = wouldPass(vote);

    const quorumProgress = vote.votingPower > 0n
      ? (Number(vote.yea * 10000n / vote.votingPower) / 100).toFixed(2)
      : "0.00";
    const quorumRequired = (Number(vote.minAcceptQuorum) / 1e16).toFixed(2);

    const lines = [
      `=== Aragon Vote #${vote_id} Timeline ===`,
      "",
      `Start: ${formatTimestamp(vote.startDate)}`,
      `Main phase end: ${formatTimestamp(BigInt(mainPhaseEnd))}`,
    ];

    if (objPhaseTime > 0) {
      lines.push(`Objection phase end: ${formatTimestamp(BigInt(totalEnd))}`);
      lines.push(`Objection phase duration: ${formatDuration(objPhaseTime)}`);
    }

    lines.push(
      `Total vote duration: ${formatDuration(voteTimeNum)}`,
      "",
      `Current phase: ${phase}`,
      `Time remaining: ${timeRemaining > 0 ? formatDuration(timeRemaining) : "Ended"}`,
      "",
      "--- Status ---",
      `  Quorum reached: ${Number(quorumProgress) >= Number(quorumRequired) ? "YES" : "NO"} (${quorumProgress}% / ${quorumRequired}%)`,
      `  Would pass: ${projection.pass ? "YES" : "NO"} — ${projection.reason}`,
      `  Executed: ${vote.executed ? "Yes" : "No"}`,
    );

    // Phase progression visualization
    const elapsed = now - startDate;
    const total = voteTimeNum;
    const progressPct = Math.min(100, Math.max(0, (elapsed / total) * 100));

    lines.push(
      "",
      "--- Progress ---",
      `  [${"|".repeat(Math.floor(progressPct / 5))}${"·".repeat(20 - Math.floor(progressPct / 5))}] ${progressPct.toFixed(0)}%`,
    );

    if (objPhaseTime > 0) {
      const mainPhasePct = ((voteTimeNum - objPhaseTime) / voteTimeNum * 100).toFixed(0);
      lines.push(`  Main phase: 0% → ${mainPhasePct}% | Objection phase: ${mainPhasePct}% → 100%`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
