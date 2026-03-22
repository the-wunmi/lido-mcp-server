import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const prompts = [
  {
    name: "stake-eth-safely",
    description:
      "Guided workflow for safely staking ETH with Lido. " +
      "Walks through protocol checks, balance verification, dry-run simulation, and execution.",
    arguments: [
      {
        name: "amount",
        description: "Amount of ETH to stake (e.g. '1.0'). If omitted, the workflow will help determine an amount.",
        required: false,
      },
    ],
  },
  {
    name: "manage-position",
    description:
      "Monitor and manage a Lido staking position. " +
      "Checks balances, APR, rewards, withdrawal status, and governance state. " +
      "Optionally set bounds for autonomous monitoring.",
    arguments: [
      {
        name: "address",
        description: "Ethereum address to analyze. Defaults to configured wallet.",
        required: false,
      },
    ],
  },
  {
    name: "withdraw-steth",
    description:
      "Guided workflow for withdrawing stETH to ETH. " +
      "Handles the full lifecycle: request, monitor, and claim.",
    arguments: [
      {
        name: "amount",
        description: "Amount of stETH to withdraw (e.g. '1.0'). If omitted, the workflow will help determine an amount.",
        required: false,
      },
    ],
  },
  {
    name: "review-governance",
    description:
      "Review the current Lido governance state and assess whether any action is needed. " +
      "Checks dual governance state, veto signalling, escrow details, and provides analysis.",
    arguments: [],
  },
  {
    name: "participate-governance",
    description:
      "Comprehensive governance participation workflow. " +
      "Checks voting power, reviews active proposals/motions across all governance systems " +
      "(Aragon, Snapshot, Easy Track, Dual Governance), and guides through voting or objecting.",
    arguments: [
      {
        name: "address",
        description: "Ethereum address to check voting power for. Defaults to configured wallet.",
        required: false,
      },
    ],
  },
];

function getPromptMessages(name: string, args: Record<string, string> | undefined) {
  switch (name) {
    case "stake-eth-safely": {
      const amount = args?.amount;
      const amountInstruction = amount
        ? `The user wants to stake ${amount} ETH.`
        : "Ask the user how much ETH they want to stake.";

      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to stake ETH with Lido. ${amountInstruction}`,
              "",
              "Please follow this safe staking workflow:",
              "1. Check protocol status with lido_get_protocol_status — verify staking is not paused and limits are not exceeded",
              "2. Check my balances with lido_get_balances — verify I have enough ETH",
              "3. Check current APR with lido_get_staking_apr (include 7-day SMA) — show me the yield I'll earn",
              "4. Run a dry-run with lido_stake_eth (dry_run=true) — show me the gas cost and confirm the tx would succeed",
              "5. Only after I confirm, execute with lido_stake_eth (dry_run=false)",
              "",
              "At each step, explain what you're checking and why. If anything looks wrong, stop and explain before continuing.",
              "Do NOT skip the dry run. Do NOT execute without my explicit confirmation.",
            ].join("\n"),
          },
        },
      ];
    }

    case "manage-position": {
      const address = args?.address;
      const addrInstruction = address
        ? `Analyze the position for address ${address}.`
        : "Use the configured wallet address.";

      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want a comprehensive analysis of my Lido staking position. ${addrInstruction}`,
              "",
              "Please do the following:",
              "1. Use lido_analyze_position to get a full position overview (include check_claimable=true)",
              "2. Check lido_get_protocol_status for any protocol-level issues",
              "3. Check lido_get_governance_state to see if governance is in a concerning state",
              "",
              "Then provide me with:",
              "- A summary of my total exposure (ETH + stETH + wstETH)",
              "- Current yield performance vs 7-day average",
              "- Any withdrawals I should claim",
              "- Whether governance state affects my position",
              "- Specific recommendations on what I should do next",
              "",
              "If I want to set up ongoing monitoring, ask me about bounds:",
              "- Minimum acceptable APR (below which I should consider withdrawing)",
              "- Maximum position size in ETH (above which I should consider rebalancing)",
              "- Minimum position size in ETH (below which I should consider staking more)",
            ].join("\n"),
          },
        },
      ];
    }

    case "withdraw-steth": {
      const amount = args?.amount;
      const amountInstruction = amount
        ? `I want to withdraw ${amount} stETH.`
        : "Help me determine how much to withdraw.";

      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to withdraw stETH from Lido back to ETH. ${amountInstruction}`,
              "",
              "Please follow this withdrawal workflow:",
              "1. Check my balances with lido_get_balances — show how much stETH/wstETH I have",
              "2. Check protocol status with lido_get_protocol_status — verify the withdrawal queue mode and show min/max amounts",
              "3. Check existing withdrawals with lido_get_withdrawal_requests — show any pending or claimable requests",
              "4. If there are claimable requests, ask if I want to claim those first (lido_claim_withdrawal)",
              "5. For a new withdrawal: dry-run with lido_request_withdrawal (dry_run=true) first",
              "6. Only after I confirm, execute with lido_request_withdrawal (dry_run=false)",
              "",
              "Important context:",
              "- Withdrawals typically take 1-5 days to finalize",
              "- Large amounts are automatically split into multiple requests (max 1000 stETH each)",
              "- I can withdraw using either stETH or wstETH as the source token",
              "- After the request is finalized, I'll need to call lido_claim_withdrawal to receive ETH",
            ].join("\n"),
          },
        },
      ];
    }

    case "review-governance": {
      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "I want to understand the current state of Lido governance and whether it affects my position.",
              "",
              "Please:",
              "1. Use lido_get_governance_state to get the dual governance status",
              "2. Use lido_get_aragon_vote to list recent DAO votes — highlight any open votes",
              "3. Explain what the current governance state means in plain language",
              "4. Tell me whether proposals are currently being vetoed or blocked",
              "5. Explain the veto signalling progress — how close are stakers to triggering a veto?",
              "6. If there are open Aragon votes, summarize them and ask if I want to vote",
              "7. If I want to participate in dual governance, explain how lido_lock_steth_governance works",
              "   and offer to help me lock stETH in the veto signalling escrow",
              "",
              "Context for interpretation:",
              "- Aragon votes are how LDO holders govern the DAO (protocol upgrades, fee changes, treasury)",
              "- Dual governance is how stETH holders protect against harmful proposals (veto signalling)",
              "- 'Normal' means governance is operating normally, no concerns",
              "- 'VetoSignalling' means stakers are actively protesting a proposal — check escrow amounts",
              "- 'RageQuit' is the most extreme state — stakers are withdrawing en masse",
              "- Warning status 'Blocked' means governance actions are halted",
              "- The first seal rage-quit threshold is when veto signalling activates",
              "- The second seal threshold triggers an unstoppable rage quit",
            ].join("\n"),
          },
        },
      ];
    }

    case "participate-governance": {
      const address = args?.address;
      const addrInstruction = address
        ? `Check governance power for address ${address}.`
        : "Use the configured wallet address.";

      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to participate in Lido governance. ${addrInstruction}`,
              "",
              "Please follow this governance participation workflow:",
              "",
              "1. **Check my voting power** — Use lido_get_voting_power to see my LDO balance (Aragon/Easy Track) and stETH balance (Dual Governance)",
              "",
              "2. **Show unified timeline** — Use lido_get_governance_timeline to see all active governance items:",
              "   - Dual Governance state and any transitions",
              "   - Open Aragon DAO votes with time remaining",
              "   - Active Easy Track motions with objection windows",
              "",
              "3. **Review Snapshot proposals** — Use lido_get_snapshot_proposals with state='active' to find any active off-chain votes",
              "",
              "4. **For each active item, provide:**",
              "   - Summary of what it does",
              "   - Time remaining to act",
              "   - Whether I can participate (voting power check)",
              "   - My current vote status (if applicable)",
              "",
              "5. **Guide me through any actions I want to take:**",
              "   - For Aragon votes: dry-run with lido_vote_on_proposal first",
              "   - For Snapshot votes: dry-run with lido_vote_on_snapshot first",
              "   - For Easy Track objections: dry-run with lido_object_easytrack_motion first",
              "   - For Dual Governance veto: dry-run with lido_lock_steth_governance first",
              "",
              "Important:",
              "- Always dry-run before executing any governance action",
              "- Explain what each vote/motion does before asking for my decision",
              "- If I have zero voting power in any system, suggest how to acquire it",
            ].join("\n"),
          },
        },
      ];
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

export function registerPrompts(server: Server) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const promptDef = prompts.find((p) => p.name === name);
    if (!promptDef) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    return {
      description: promptDef.description,
      messages: getPromptMessages(name, args),
    };
  });
}
