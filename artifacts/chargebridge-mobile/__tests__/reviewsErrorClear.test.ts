/**
 * Tests confirming the My Reviews error state clears correctly when
 * connectivity is restored and the user taps Retry.
 *
 * Design: pure-JS state-machine simulation — no React renderer needed.
 *
 * We model two things extracted from profile.tsx:
 *   1. The render-branch decision (which UI state does a given query state
 *      produce?).
 *   2. The query state transitions that TanStack Query produces when
 *      refetch() resolves successfully after an error.
 *
 * The core contract:
 *   - Error state  → reviewsError=true  (renders error banner + Retry)
 *   - After retry succeeds with data    → reviewsError=false, myReviews filled
 *     (renders review list, not error)
 *   - After retry succeeds with []      → reviewsError=false, myReviews empty
 *     (renders "No reviews yet" empty state, not error)
 *   - While retry is in-flight          → reviewsLoading=true
 *     (renders loading spinner, not error)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReviewItem {
  id: number;
  stationId: number;
  rating: number;
  comment: string;
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  myReviews: ReviewItem[];
}

// ── Render branch logic ────────────────────────────────────────────────────────
// Mirrors the conditional chain in profile.tsx My Reviews section (≈ line 2714).

type RenderBranch = "loading" | "error" | "empty" | "list";

function resolveRenderBranch(state: QueryState): RenderBranch {
  if (state.isLoading) return "loading";
  if (state.isError) return "error";
  if (state.myReviews.length === 0) return "empty";
  return "list";
}

// ── Simulated query ────────────────────────────────────────────────────────────
// Models the useGetMyReviews() hook state + refetch().
// TanStack Query transitions on refetch:
//   error state  → isLoading=true, isError=false, data=[]  (fetching)
//              → isLoading=false, isError=false, data=<result>  (resolved)

function makeQuerySim(fetchImpl: () => Promise<ReviewItem[]>) {
  let state: QueryState = { isLoading: false, isError: false, myReviews: [] };
  const listeners: Array<() => void> = [];

  function notify() {
    listeners.forEach((fn) => fn());
  }

  function getState(): QueryState {
    return { ...state };
  }

  function subscribe(fn: () => void) {
    listeners.push(fn);
  }

  async function refetch(): Promise<void> {
    // Transition 1: in-flight
    state = { isLoading: true, isError: false, myReviews: [] };
    notify();
    try {
      const data = await fetchImpl();
      // Transition 2: resolved successfully
      state = { isLoading: false, isError: false, myReviews: data };
    } catch {
      // Transition 3: still failing
      state = { isLoading: false, isError: true, myReviews: [] };
    }
    notify();
  }

  // Put sim into error state (simulates initial failed load).
  function simulateInitialError() {
    state = { isLoading: false, isError: true, myReviews: [] };
    notify();
  }

  return { getState, subscribe, refetch, simulateInitialError };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const REVIEW_1: ReviewItem = { id: 1, stationId: 10, rating: 5, comment: "Great charger" };
const REVIEW_2: ReviewItem = { id: 2, stationId: 20, rating: 3, comment: "Slow but reliable" };

// ═══════════════════════════════════════════════════════════════════════════════
// Render-branch logic — static snapshot tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveRenderBranch — error state", () => {
  it("returns 'error' when isError=true and myReviews is empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: true, myReviews: [] }),
    ).toBe("error");
  });

  it("returns 'error' when isError=true even if myReviews has stale data", () => {
    // Stale data from a previous successful fetch should not suppress the error.
    expect(
      resolveRenderBranch({ isLoading: false, isError: true, myReviews: [REVIEW_1] }),
    ).toBe("error");
  });
});

describe("resolveRenderBranch — loading takes priority over error", () => {
  it("returns 'loading' when isLoading=true even if isError is somehow also true", () => {
    expect(
      resolveRenderBranch({ isLoading: true, isError: true, myReviews: [] }),
    ).toBe("loading");
  });
});

describe("resolveRenderBranch — after successful refetch", () => {
  it("returns 'list' when isError=false and myReviews is non-empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, myReviews: [REVIEW_1, REVIEW_2] }),
    ).toBe("list");
  });

  it("returns 'empty' when isError=false and myReviews is empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, myReviews: [] }),
    ).toBe("empty");
  });

  it("never returns 'error' after a successful refetch with data", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, myReviews: [REVIEW_1] }),
    ).not.toBe("error");
  });

  it("never returns 'error' after a successful refetch with an empty list", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, myReviews: [] }),
    ).not.toBe("error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Query simulation — Retry clears the error state (reviews returned)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry — clears error and shows review list when fetch succeeds", () => {
  it("renders 'error' before retry is tapped", () => {
    const sim = makeQuerySim(jest.fn());
    sim.simulateInitialError();

    expect(resolveRenderBranch(sim.getState())).toBe("error");
  });

  it("renders 'loading' while retry fetch is in-flight", async () => {
    let resolveHang!: (v: ReviewItem[]) => void;
    const hanging = new Promise<ReviewItem[]>((res) => { resolveHang = res; });
    const sim = makeQuerySim(() => hanging);
    sim.simulateInitialError();

    const snapshots: RenderBranch[] = [];
    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    const pending = sim.refetch();
    // First snapshot captured on the in-flight transition.
    expect(snapshots[0]).toBe("loading");

    resolveHang([REVIEW_1]);
    await pending;
  });

  it("renders 'list' (not 'error') after retry resolves with reviews", async () => {
    const fetchMock = jest.fn().mockResolvedValue([REVIEW_1, REVIEW_2]);
    const sim = makeQuerySim(fetchMock);
    sim.simulateInitialError();

    await sim.refetch();

    expect(resolveRenderBranch(sim.getState())).toBe("list");
  });

  it("isError is false after a successful retry", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([REVIEW_1]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().isError).toBe(false);
  });

  it("myReviews contains the fetched items after a successful retry", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([REVIEW_1, REVIEW_2]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().myReviews).toEqual([REVIEW_1, REVIEW_2]);
  });

  it("calls the fetch function exactly once when retry is tapped once", async () => {
    const fetchMock = jest.fn().mockResolvedValue([REVIEW_1]);
    const sim = makeQuerySim(fetchMock);
    sim.simulateInitialError();

    await sim.refetch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retry — clears error and shows empty state when fetch returns []
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry — clears error and shows empty state when fetch returns []", () => {
  it("renders 'empty' (not 'error') after retry resolves with an empty list", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(resolveRenderBranch(sim.getState())).toBe("empty");
  });

  it("isError is false after retry returns []", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().isError).toBe(false);
  });

  it("myReviews is empty after retry returns []", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().myReviews).toHaveLength(0);
  });

  it("never renders 'error' when the empty list is the successful result", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(resolveRenderBranch(sim.getState())).not.toBe("error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retry — stays in error state when the second fetch also fails
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry — stays in error state when the server is still unreachable", () => {
  it("renders 'error' again when retry also fails", async () => {
    const sim = makeQuerySim(jest.fn().mockRejectedValue(new Error("Network error")));
    sim.simulateInitialError();

    await sim.refetch();

    expect(resolveRenderBranch(sim.getState())).toBe("error");
  });

  it("isError remains true after a failed retry", async () => {
    const sim = makeQuerySim(jest.fn().mockRejectedValue(new Error("Network error")));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().isError).toBe(true);
  });

  it("myReviews stays empty after a failed retry", async () => {
    const sim = makeQuerySim(jest.fn().mockRejectedValue(new Error("Network error")));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().myReviews).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// State transition sequence — full lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("Full lifecycle — error → retry → success", () => {
  it("transitions through error → loading → list in order", async () => {
    const snapshots: RenderBranch[] = [];
    const sim = makeQuerySim(jest.fn().mockResolvedValue([REVIEW_1]));

    sim.simulateInitialError();
    snapshots.push(resolveRenderBranch(sim.getState())); // error

    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    await sim.refetch(); // loading → list

    expect(snapshots).toEqual(["error", "loading", "list"]);
  });

  it("transitions through error → loading → empty in order when no reviews exist", async () => {
    const snapshots: RenderBranch[] = [];
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));

    sim.simulateInitialError();
    snapshots.push(resolveRenderBranch(sim.getState())); // error

    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    await sim.refetch(); // loading → empty

    expect(snapshots).toEqual(["error", "loading", "empty"]);
  });

  it("transitions through error → loading → error again when retry also fails", async () => {
    const snapshots: RenderBranch[] = [];
    const sim = makeQuerySim(jest.fn().mockRejectedValue(new Error("still down")));

    sim.simulateInitialError();
    snapshots.push(resolveRenderBranch(sim.getState())); // error

    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    await sim.refetch(); // loading → error

    expect(snapshots).toEqual(["error", "loading", "error"]);
  });
});
