/**
 * Snapshot Hub GraphQL client — native fetch, no extra dependencies.
 * Covers proposal queries, vote queries, voting power, and vote submission.
 */

const SNAPSHOT_HUB = "https://hub.snapshot.org/graphql";
const SNAPSHOT_SEQUENCER = "https://seq.snapshot.org/";
export const LIDO_SNAPSHOT_SPACE = "lido-snapshot.eth";

// EIP-712 domain for Snapshot vote signing
export const SNAPSHOT_EIP712_DOMAIN = {
  name: "snapshot",
  version: "0.1.4",
} as const;

// EIP-712 types for vote message
export const SNAPSHOT_VOTE_TYPES = {
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
} as const;

// ---- Types ----

export interface SnapshotProposal {
  id: string;
  title: string;
  body: string;
  state: string;
  type: string;
  author: string;
  created: number;
  start: number;
  end: number;
  choices: string[];
  scores: number[];
  scores_total: number;
  quorum: number;
  votes: number;
  snapshot: string;
  space: { id: string };
  strategies: Array<{ name: string; network: string; params: Record<string, unknown> }>;
}

export interface SnapshotVote {
  id: string;
  voter: string;
  choice: number;
  vp: number;
  reason: string;
  created: number;
}

export interface SnapshotVotingPower {
  vp: number;
  vp_by_strategy: number[];
  vp_state: string;
}

// ---- GraphQL Queries ----

const PROPOSALS_QUERY = `
  query Proposals($space: String!, $state: String, $first: Int!, $skip: Int!, $search: String) {
    proposals(
      where: { space: $space, state: $state, title_contains: $search }
      first: $first
      skip: $skip
      orderBy: "created"
      orderDirection: desc
    ) {
      id
      title
      body
      state
      type
      author
      created
      start
      end
      choices
      scores
      scores_total
      quorum
      votes
      snapshot
      space { id }
    }
  }
`;

const PROPOSAL_QUERY = `
  query Proposal($id: String!) {
    proposal(id: $id) {
      id
      title
      body
      state
      type
      author
      created
      start
      end
      choices
      scores
      scores_total
      quorum
      votes
      snapshot
      space { id }
      strategies {
        name
        network
        params
      }
    }
  }
`;

const VOTES_QUERY = `
  query Votes($proposalId: String!, $voter: String) {
    votes(
      where: { proposal: $proposalId, voter: $voter }
      first: 1000
      orderBy: "vp"
      orderDirection: desc
    ) {
      id
      voter
      choice
      vp
      reason
      created
    }
  }
`;

const VP_QUERY = `
  query Vp($voter: String!, $space: String!, $proposal: String!) {
    vp(voter: $voter, space: $space, proposal: $proposal) {
      vp
      vp_by_strategy
      vp_state
    }
  }
`;

// ---- Client Functions ----

async function gqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(SNAPSHOT_HUB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Snapshot API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`Snapshot GraphQL error: ${json.errors[0].message}`);
  }

  if (!json.data) {
    throw new Error("Snapshot API returned no data");
  }

  return json.data;
}

export async function getSnapshotProposals(opts: {
  state?: string;
  first?: number;
  skip?: number;
  search?: string;
}): Promise<SnapshotProposal[]> {
  const { state, first = 10, skip = 0, search } = opts;
  const variables: Record<string, unknown> = {
    space: LIDO_SNAPSHOT_SPACE,
    first,
    skip,
    state: state && state !== "all" ? state : undefined,
    search: search || undefined,
  };

  const data = await gqlRequest<{ proposals: SnapshotProposal[] }>(PROPOSALS_QUERY, variables);
  return data.proposals;
}

export async function getSnapshotProposal(id: string): Promise<SnapshotProposal | null> {
  const data = await gqlRequest<{ proposal: SnapshotProposal | null }>(PROPOSAL_QUERY, { id });
  return data.proposal;
}

export async function getSnapshotVotes(proposalId: string, voter?: string): Promise<SnapshotVote[]> {
  const data = await gqlRequest<{ votes: SnapshotVote[] }>(VOTES_QUERY, {
    proposalId,
    voter: voter || undefined,
  });
  return data.votes;
}

export async function getSnapshotVotingPower(
  voter: string,
  proposalId: string,
): Promise<SnapshotVotingPower> {
  const data = await gqlRequest<{ vp: SnapshotVotingPower }>(VP_QUERY, {
    voter,
    space: LIDO_SNAPSHOT_SPACE,
    proposal: proposalId,
  });
  return data.vp;
}

/**
 * Submit a vote to the Snapshot Sequencer.
 * The vote is signed off-chain via EIP-712 and posted as a JSON envelope.
 */
export async function submitSnapshotVote(envelope: {
  address: string;
  sig: string;
  data: {
    domain: typeof SNAPSHOT_EIP712_DOMAIN;
    types: typeof SNAPSHOT_VOTE_TYPES;
    message: Record<string, unknown>;
  };
}): Promise<{ id: string }> {
  const response = await fetch(SNAPSHOT_SEQUENCER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: envelope.address,
      sig: envelope.sig,
      data: JSON.stringify(envelope.data),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Snapshot Sequencer error: ${response.status} — ${text}`);
  }

  return (await response.json()) as { id: string };
}
