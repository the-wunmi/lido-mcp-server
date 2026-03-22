import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSnapshotProposals,
  getSnapshotProposal,
  getSnapshotVotes,
  getSnapshotVotingPower,
  submitSnapshotVote,
  LIDO_SNAPSHOT_SPACE,
  SNAPSHOT_EIP712_DOMAIN,
  SNAPSHOT_VOTE_TYPES,
} from "../../src/utils/snapshot-client.js";

function mockFetchResponse(data: unknown, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

describe("snapshot-client", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constants", () => {
    it("LIDO_SNAPSHOT_SPACE is 'lido-snapshot.eth'", () => {
      expect(LIDO_SNAPSHOT_SPACE).toBe("lido-snapshot.eth");
    });

    it("SNAPSHOT_EIP712_DOMAIN has correct name and version", () => {
      expect(SNAPSHOT_EIP712_DOMAIN.name).toBe("snapshot");
      expect(SNAPSHOT_EIP712_DOMAIN.version).toBe("0.1.4");
    });

    it("SNAPSHOT_VOTE_TYPES has a Vote type array", () => {
      expect(SNAPSHOT_VOTE_TYPES.Vote).toBeDefined();
      expect(Array.isArray(SNAPSHOT_VOTE_TYPES.Vote)).toBe(true);
      expect(SNAPSHOT_VOTE_TYPES.Vote.length).toBeGreaterThan(0);

      const fieldNames = SNAPSHOT_VOTE_TYPES.Vote.map((f) => f.name);
      expect(fieldNames).toContain("from");
      expect(fieldNames).toContain("space");
      expect(fieldNames).toContain("proposal");
      expect(fieldNames).toContain("choice");
      expect(fieldNames).toContain("reason");
    });
  });

  describe("getSnapshotProposals", () => {
    it("fetches proposals with default options", async () => {
      const proposals = [
        { id: "0x123", title: "Test Proposal", state: "closed" },
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposals } }),
      );

      const result = await getSnapshotProposals({});

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe("https://hub.snapshot.org/graphql");
      expect(callArgs[1].method).toBe("POST");

      const body = JSON.parse(callArgs[1].body);
      expect(body.variables.space).toBe("lido-snapshot.eth");
      expect(body.variables.first).toBe(10);
      expect(body.variables.skip).toBe(0);
      expect(body.variables.state).toBeUndefined();
      expect(body.variables.search).toBeUndefined();

      expect(result).toEqual(proposals);
    });

    it("passes state filter when not 'all'", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposals: [] } }),
      );

      await getSnapshotProposals({ state: "active" });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.state).toBe("active");
    });

    it("omits state when set to 'all'", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposals: [] } }),
      );

      await getSnapshotProposals({ state: "all" });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.state).toBeUndefined();
    });

    it("passes search, first, skip parameters", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposals: [] } }),
      );

      await getSnapshotProposals({
        state: "closed",
        first: 5,
        skip: 10,
        search: "staking",
      });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.first).toBe(5);
      expect(body.variables.skip).toBe(10);
      expect(body.variables.search).toBe("staking");
      expect(body.variables.state).toBe("closed");
    });

    it("omits search when empty string", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposals: [] } }),
      );

      await getSnapshotProposals({ search: "" });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.search).toBeUndefined();
    });

    it("throws on HTTP error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({}, false, 500, "Internal Server Error"),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Snapshot API error: 500 Internal Server Error",
      );
    });

    it("throws on GraphQL errors", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          data: null,
          errors: [{ message: "Query failed" }],
        }),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Snapshot GraphQL error: Query failed",
      );
    });

    it("throws when data is missing from response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({}),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Snapshot API returned no data",
      );
    });
  });

  describe("getSnapshotProposal", () => {
    it("fetches a single proposal by id", async () => {
      const proposal = { id: "0xabc", title: "My Proposal" };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposal } }),
      );

      const result = await getSnapshotProposal("0xabc");

      expect(result).toEqual(proposal);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.id).toBe("0xabc");
    });

    it("returns null when proposal is not found", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { proposal: null } }),
      );

      const result = await getSnapshotProposal("0xnonexistent");
      expect(result).toBeNull();
    });

    it("throws on API error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({}, false, 429, "Too Many Requests"),
      );

      await expect(getSnapshotProposal("0xabc")).rejects.toThrow(
        "Snapshot API error: 429 Too Many Requests",
      );
    });
  });

  describe("getSnapshotVotes", () => {
    it("fetches votes for a proposal", async () => {
      const votes = [
        { id: "v1", voter: "0xaaa", choice: 1, vp: 100, reason: "", created: 1700000000 },
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { votes } }),
      );

      const result = await getSnapshotVotes("0xproposal");

      expect(result).toEqual(votes);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.proposalId).toBe("0xproposal");
      expect(body.variables.voter).toBeUndefined();
    });

    it("passes voter filter when provided", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { votes: [] } }),
      );

      await getSnapshotVotes("0xproposal", "0xvoter");

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.voter).toBe("0xvoter");
    });

    it("omits voter when empty string", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { votes: [] } }),
      );

      await getSnapshotVotes("0xproposal", "");

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.voter).toBeUndefined();
    });

    it("returns empty array when no votes", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { votes: [] } }),
      );

      const result = await getSnapshotVotes("0xproposal");
      expect(result).toEqual([]);
    });
  });

  describe("getSnapshotVotingPower", () => {
    it("fetches voting power for a voter and proposal", async () => {
      const vp = { vp: 500, vp_by_strategy: [300, 200], vp_state: "final" };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ data: { vp } }),
      );

      const result = await getSnapshotVotingPower("0xvoter", "0xproposal");

      expect(result).toEqual(vp);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.variables.voter).toBe("0xvoter");
      expect(body.variables.space).toBe("lido-snapshot.eth");
      expect(body.variables.proposal).toBe("0xproposal");
    });

    it("throws on GraphQL error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          errors: [{ message: "Invalid voter address" }],
        }),
      );

      await expect(
        getSnapshotVotingPower("bad", "0xproposal"),
      ).rejects.toThrow("Snapshot GraphQL error: Invalid voter address");
    });
  });

  describe("submitSnapshotVote", () => {
    const envelope = {
      address: "0xvoter",
      sig: "0xsignature",
      data: {
        domain: SNAPSHOT_EIP712_DOMAIN,
        types: SNAPSHOT_VOTE_TYPES,
        message: { from: "0xvoter", space: "lido-snapshot.eth" },
      },
    };

    it("submits a vote to the sequencer and returns the id", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ id: "vote-123" }),
      );

      const result = await submitSnapshotVote(envelope);

      expect(result).toEqual({ id: "vote-123" });

      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe("https://seq.snapshot.org/");
      expect(callArgs[1].method).toBe("POST");

      const body = JSON.parse(callArgs[1].body);
      expect(body.address).toBe("0xvoter");
      expect(body.sig).toBe("0xsignature");
      expect(typeof body.data).toBe("string");
      const parsedData = JSON.parse(body.data);
      expect(parsedData.domain.name).toBe("snapshot");
    });

    it("throws on sequencer HTTP error with response text", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi.fn().mockResolvedValue("Invalid signature"),
        json: vi.fn(),
      });

      await expect(submitSnapshotVote(envelope)).rejects.toThrow(
        "Snapshot Sequencer error: 400 — Invalid signature",
      );
    });

    it("throws on sequencer 500 error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockResolvedValue("server down"),
        json: vi.fn(),
      });

      await expect(submitSnapshotVote(envelope)).rejects.toThrow(
        "Snapshot Sequencer error: 500 — server down",
      );
    });

    it("handles network fetch failure", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network unreachable"),
      );

      await expect(submitSnapshotVote(envelope)).rejects.toThrow(
        "Network unreachable",
      );
    });
  });

  describe("gqlRequest error handling (via public functions)", () => {
    it("throws when response has errors array with multiple items (uses first)", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({
          errors: [
            { message: "First error" },
            { message: "Second error" },
          ],
        }),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Snapshot GraphQL error: First error",
      );
    });

    it("throws when response JSON has neither data nor errors", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockFetchResponse({ something: "unexpected" }),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Snapshot API returned no data",
      );
    });

    it("propagates network-level fetch errors", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TypeError("Failed to fetch"),
      );

      await expect(getSnapshotProposals({})).rejects.toThrow(
        "Failed to fetch",
      );
    });
  });
});
