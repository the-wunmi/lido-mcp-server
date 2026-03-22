import { z } from "zod";
import { walletClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, formatTimestamp } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import {
  getSnapshotProposals,
  getSnapshotProposal,
  getSnapshotVotes,
  getSnapshotVotingPower,
  submitSnapshotVote,
  LIDO_SNAPSHOT_SPACE,
  SNAPSHOT_EIP712_DOMAIN,
  SNAPSHOT_VOTE_TYPES,
} from "../utils/snapshot-client.js";


export const getSnapshotProposalsToolDef = {
  name: "lido_get_snapshot_proposals",
  description:
    "List governance proposals from the Lido Snapshot space (lido-snapshot.eth). " +
    "Filter by state (active/closed/pending/all), count, and search text. " +
    "Returns proposal id, title, state, scores, quorum, dates, and author.",
  inputSchema: {
    type: "object" as const,
    properties: {
      state: {
        type: "string",
        description: "Filter by proposal state: 'active', 'closed', 'pending', or 'all' (default: 'all').",
        enum: ["active", "closed", "pending", "all"],
      },
      count: {
        type: "number",
        description: "Number of proposals to return (default: 10, max: 50).",
      },
      search: {
        type: "string",
        description: "Search text to filter proposal titles.",
      },
    },
  },
  annotations: {
    title: "Get Snapshot Proposals",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const getSnapshotProposalToolDef = {
  name: "lido_get_snapshot_proposal",
  description:
    "Get full details of a specific Lido Snapshot proposal by ID. " +
    "Returns complete body, choices, scores, strategies, your vote (if any), and your voting power.",
  inputSchema: {
    type: "object" as const,
    properties: {
      proposal_id: {
        type: "string",
        description: "The Snapshot proposal ID (hex string starting with 0x).",
      },
    },
    required: ["proposal_id"],
  },
  annotations: {
    title: "Get Snapshot Proposal Detail",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const voteOnSnapshotToolDef = {
  name: "lido_vote_on_snapshot",
  description:
    "Cast a vote on a Lido Snapshot proposal via EIP-712 signed message. " +
    "This is NOT an on-chain transaction — it signs a message and posts to the Snapshot Sequencer. " +
    "No gas is required. Defaults to dry_run=true (validates without submitting). " +
    "Set dry_run=false to actually submit the vote.",
  inputSchema: {
    type: "object" as const,
    properties: {
      proposal_id: {
        type: "string",
        description: "The Snapshot proposal ID to vote on.",
      },
      choice: {
        type: "number",
        description: "Choice number (1-indexed, matching the proposal's choices array).",
      },
      reason: {
        type: "string",
        description: "Optional reason for your vote.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, validate only without submitting. Default: true.",
      },
    },
    required: ["proposal_id", "choice"],
  },
  annotations: {
    title: "Vote on Snapshot Proposal",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};


const getProposalsSchema = z.object({
  state: z.enum(["active", "closed", "pending", "all"]).optional().default("all"),
  count: z.number().int().min(1).max(50).optional().default(10),
  search: z.string().optional(),
});

const getProposalSchema = z.object({
  proposal_id: z.string().min(1),
});

const voteSnapshotSchema = z.object({
  proposal_id: z.string().min(1),
  choice: z.number().int().min(1),
  reason: z.string().optional().default(""),
  dry_run: z.boolean().optional().default(true),
});


function truncateBody(body: string, maxLen = 500): string {
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + "...";
}

function formatProposalState(state: string): string {
  switch (state) {
    case "active": return "Active";
    case "closed": return "Closed";
    case "pending": return "Pending";
    default: return state;
  }
}


export async function handleGetSnapshotProposals(args: Record<string, unknown>) {
  try {
    const { state, count, search } = getProposalsSchema.parse(args);

    const proposals = await getSnapshotProposals({
      state: state === "all" ? undefined : state,
      first: count,
      search,
    });

    if (proposals.length === 0) {
      return textResult(
        `No ${state !== "all" ? state + " " : ""}Snapshot proposals found` +
        (search ? ` matching "${search}"` : "") + "."
      );
    }

    const lines = [
      `=== Lido Snapshot Proposals (${proposals.length} results) ===`,
      `Space: ${LIDO_SNAPSHOT_SPACE}`,
      "",
    ];

    for (const p of proposals) {
      const totalScores = p.scores_total;
      const choicesWithScores = p.choices
        .map((c, i) => {
          const score = p.scores[i] ?? 0;
          const pct = totalScores > 0 ? ((score / totalScores) * 100).toFixed(1) : "0.0";
          return `${c}: ${score.toFixed(2)} (${pct}%)`;
        })
        .join(", ");

      lines.push(
        `${formatProposalState(p.state)} | ${p.title}`,
        `  ID: ${p.id}`,
        `  Author: ${p.author}`,
        `  Dates: ${formatTimestamp(p.start)} → ${formatTimestamp(p.end)}`,
        `  Votes: ${p.votes} | Quorum: ${p.quorum.toFixed(2)}`,
        `  Scores: ${choicesWithScores}`,
        "",
      );
    }

    const activeCount = proposals.filter(p => p.state === "active").length;
    if (activeCount > 0) {
      lines.push(
        `${activeCount} proposal(s) currently active.`,
        "Use lido_get_snapshot_proposal for full details.",
        "Use lido_vote_on_snapshot to cast your vote.",
      );
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetSnapshotProposal(args: Record<string, unknown>) {
  try {
    const { proposal_id } = getProposalSchema.parse(args);
    const address = getAccountAddress();

    const proposal = await getSnapshotProposal(proposal_id);
    if (!proposal) {
      return errorResult(`Snapshot proposal not found: ${proposal_id}`);
    }

    const [userVotes, vp] = await Promise.all([
      getSnapshotVotes(proposal_id, address),
      getSnapshotVotingPower(address, proposal_id).catch(() => null),
    ]);

    const userVote = userVotes.length > 0 ? userVotes[0] : null;
    const totalScores = proposal.scores_total;

    const lines = [
      `=== Snapshot Proposal: ${proposal.title} ===`,
      "",
      `ID: ${proposal.id}`,
      `State: ${formatProposalState(proposal.state)}`,
      `Type: ${proposal.type}`,
      `Author: ${proposal.author}`,
      `Created: ${formatTimestamp(proposal.created)}`,
      `Voting: ${formatTimestamp(proposal.start)} → ${formatTimestamp(proposal.end)}`,
      `Total votes: ${proposal.votes}`,
      `Quorum: ${proposal.quorum.toFixed(2)}`,
      `Snapshot block: ${proposal.snapshot}`,
      "",
      "--- Choices & Scores ---",
    ];

    for (let i = 0; i < proposal.choices.length; i++) {
      const choice = proposal.choices[i];
      const score = proposal.scores[i] ?? 0;
      const pct = totalScores > 0 ? ((score / totalScores) * 100).toFixed(1) : "0.0";
      lines.push(`  ${i + 1}. ${choice}: ${score.toFixed(2)} (${pct}%)`);
    }

    lines.push("");

    if (proposal.strategies.length > 0) {
      lines.push("--- Voting Strategies ---");
      for (const s of proposal.strategies) {
        lines.push(`  - ${s.name} (network: ${s.network})`);
      }
      lines.push("");
    }

    lines.push("--- Your Status ---");
    if (vp) {
      lines.push(`  Voting power: ${vp.vp.toFixed(2)} (state: ${vp.vp_state})`);
    } else {
      lines.push("  Voting power: unable to calculate");
    }

    if (userVote) {
      const choiceLabel = proposal.choices[userVote.choice - 1] ?? `Choice ${userVote.choice}`;
      lines.push(
        `  Your vote: ${choiceLabel} (power: ${userVote.vp.toFixed(2)})`,
        userVote.reason ? `  Reason: ${userVote.reason}` : "  Reason: (none)",
      );
    } else {
      lines.push("  Your vote: Not yet voted");
    }

    lines.push("", "--- Proposal Body ---", truncateBody(proposal.body, 2000));

    if (proposal.state === "active" && !userVote) {
      lines.push(
        "",
        "This proposal is active. Use lido_vote_on_snapshot to cast your vote.",
      );
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleVoteOnSnapshot(args: Record<string, unknown>) {
  try {
    const { proposal_id, choice, reason, dry_run } = voteSnapshotSchema.parse(args);
    const address = getAccountAddress();

    const proposal = await getSnapshotProposal(proposal_id);
    if (!proposal) {
      return errorResult(`Snapshot proposal not found: ${proposal_id}`);
    }

    if (proposal.state !== "active") {
      return errorResult(
        `Proposal is ${proposal.state}, not active. Only active proposals can be voted on.`
      );
    }

    if (choice < 1 || choice > proposal.choices.length) {
      return errorResult(
        `Invalid choice ${choice}. Must be between 1 and ${proposal.choices.length}. ` +
        `Choices: ${proposal.choices.map((c, i) => `${i + 1}=${c}`).join(", ")}`
      );
    }

    const choiceLabel = proposal.choices[choice - 1];

    let vp: { vp: number; vp_state: string } | null = null;
    try {
      vp = await getSnapshotVotingPower(address, proposal_id);
    } catch {
      // VP check may fail
    }

    if (vp && vp.vp === 0) {
      return errorResult(
        "You have zero voting power for this proposal. " +
        "Your voting power is determined by the strategies at the proposal's snapshot block."
      );
    }

    if (dry_run) {
      const lines = [
        "=== DRY RUN: Vote on Snapshot Proposal ===",
        "",
        `Proposal: ${proposal.title}`,
        `ID: ${proposal.id}`,
        `Your choice: ${choice}. ${choiceLabel}`,
        reason ? `Reason: ${reason}` : "Reason: (none)",
        "",
        `Your voting power: ${vp ? vp.vp.toFixed(2) : "unknown"}`,
        "",
        "Note: Snapshot voting is off-chain (no gas required).",
        "The vote will be signed via EIP-712 and posted to the Snapshot Sequencer.",
        "",
        "Set dry_run=false to submit your vote.",
      ];
      return textResult(lines.join("\n"));
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      from: address,
      space: LIDO_SNAPSHOT_SPACE,
      timestamp: BigInt(timestamp),
      proposal: proposal_id as `0x${string}`,
      choice,
      reason: reason || "",
      app: "lido-mcp-server",
      metadata: "{}",
    };

    const sig = await walletClient.signTypedData({
      domain: SNAPSHOT_EIP712_DOMAIN,
      types: SNAPSHOT_VOTE_TYPES,
      primaryType: "Vote",
      message,
    });

    const result = await submitSnapshotVote({
      address,
      sig,
      data: {
        domain: SNAPSHOT_EIP712_DOMAIN,
        types: SNAPSHOT_VOTE_TYPES,
        message: {
          ...message,
          timestamp,
        },
      },
    });

    const lines = [
      "=== Vote Submitted on Snapshot ===",
      "",
      `Proposal: ${proposal.title}`,
      `Your vote: ${choice}. ${choiceLabel}`,
      reason ? `Reason: ${reason}` : "",
      `Vote ID: ${result.id}`,
      "",
      "Your vote has been recorded off-chain on Snapshot.",
      "Use lido_get_snapshot_proposal to see the updated scores.",
    ].filter(Boolean);

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
