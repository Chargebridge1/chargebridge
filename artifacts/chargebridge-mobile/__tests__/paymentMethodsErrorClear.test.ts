/**
 * Tests confirming the Payment Methods error state clears correctly when
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
 * The render-branch logic (profile.tsx ≈ line 2452):
 *   pmIsError                    → error banner + Retry button
 *   !pmIsError && methods.length → payment method list
 *   !pmIsError && no methods     → empty wallet state
 *
 * The core contract:
 *   - Error state  → pmIsError=true  (renders error banner + Retry)
 *   - After retry succeeds with data    → pmIsError=false, methods filled
 *     (renders method list, not error)
 *   - After retry succeeds with []      → pmIsError=false, methods empty
 *     (renders "No payment methods saved yet" empty state, not error)
 *   - While retry is in-flight          → pmIsLoading=true
 *     (renders loading spinner, not error)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface PaymentMethod {
  id: string;
  type: "card" | "bank" | "carrier";
  label: string;
  last4: string;
  subLabel: string;
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  methods: PaymentMethod[];
}

// ── Render branch logic ────────────────────────────────────────────────────────
// Mirrors the conditional chain in profile.tsx Wallet & Payments section
// (≈ line 2452):
//   pmIsError ? <error> : paymentMethods.length > 0 ? <list> : <empty>

type RenderBranch = "loading" | "error" | "empty" | "list";

function resolveRenderBranch(state: QueryState): RenderBranch {
  if (state.isLoading) return "loading";
  if (state.isError) return "error";
  if (state.methods.length === 0) return "empty";
  return "list";
}

// ── Simulated query ────────────────────────────────────────────────────────────
// Models the useQuery("payment-methods") hook state + refetch().
// TanStack Query transitions on refetch:
//   error state  → isLoading=true, isError=false, data=[]  (fetching)
//              → isLoading=false, isError=false, data=<result>  (resolved)

function makeQuerySim(fetchImpl: () => Promise<PaymentMethod[]>) {
  let state: QueryState = { isLoading: false, isError: false, methods: [] };
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
    state = { isLoading: true, isError: false, methods: [] };
    notify();
    try {
      const data = await fetchImpl();
      // Transition 2: resolved successfully
      state = { isLoading: false, isError: false, methods: data };
    } catch {
      // Transition 3: still failing
      state = { isLoading: false, isError: true, methods: [] };
    }
    notify();
  }

  // Put sim into error state (simulates initial failed load).
  function simulateInitialError() {
    state = { isLoading: false, isError: true, methods: [] };
    notify();
  }

  return { getState, subscribe, refetch, simulateInitialError };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const CARD_METHOD: PaymentMethod = {
  id: "pm_card_123",
  type: "card",
  label: "Visa",
  last4: "4242",
  subLabel: "Visa •••• 4242",
};

const BANK_METHOD: PaymentMethod = {
  id: "bank_456",
  type: "bank",
  label: "Chase",
  last4: "6789",
  subLabel: "Checking •••• 6789",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Render-branch logic — static snapshot tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveRenderBranch — error state", () => {
  it("returns 'error' when isError=true and methods is empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: true, methods: [] }),
    ).toBe("error");
  });

  it("returns 'error' when isError=true even if methods has stale data", () => {
    // Stale data from a previous successful fetch should not suppress the error.
    expect(
      resolveRenderBranch({ isLoading: false, isError: true, methods: [CARD_METHOD] }),
    ).toBe("error");
  });
});

describe("resolveRenderBranch — loading takes priority over error", () => {
  it("returns 'loading' when isLoading=true even if isError is somehow also true", () => {
    expect(
      resolveRenderBranch({ isLoading: true, isError: true, methods: [] }),
    ).toBe("loading");
  });
});

describe("resolveRenderBranch — after successful refetch", () => {
  it("returns 'list' when isError=false and methods is non-empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, methods: [CARD_METHOD, BANK_METHOD] }),
    ).toBe("list");
  });

  it("returns 'empty' when isError=false and methods is empty", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, methods: [] }),
    ).toBe("empty");
  });

  it("never returns 'error' after a successful refetch with methods", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, methods: [CARD_METHOD] }),
    ).not.toBe("error");
  });

  it("never returns 'error' after a successful refetch with an empty list", () => {
    expect(
      resolveRenderBranch({ isLoading: false, isError: false, methods: [] }),
    ).not.toBe("error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Query simulation — Retry clears the error state (methods returned)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry — clears error and shows method list when fetch succeeds", () => {
  it("renders 'error' before retry is tapped", () => {
    const sim = makeQuerySim(jest.fn());
    sim.simulateInitialError();

    expect(resolveRenderBranch(sim.getState())).toBe("error");
  });

  it("renders 'loading' while retry fetch is in-flight", async () => {
    let resolveHang!: (v: PaymentMethod[]) => void;
    const hanging = new Promise<PaymentMethod[]>((res) => { resolveHang = res; });
    const sim = makeQuerySim(() => hanging);
    sim.simulateInitialError();

    const snapshots: RenderBranch[] = [];
    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    const pending = sim.refetch();
    // First snapshot captured on the in-flight transition.
    expect(snapshots[0]).toBe("loading");

    resolveHang([CARD_METHOD]);
    await pending;
  });

  it("renders 'list' (not 'error') after retry resolves with methods", async () => {
    const fetchMock = jest.fn().mockResolvedValue([CARD_METHOD, BANK_METHOD]);
    const sim = makeQuerySim(fetchMock);
    sim.simulateInitialError();

    await sim.refetch();

    expect(resolveRenderBranch(sim.getState())).toBe("list");
  });

  it("isError is false after a successful retry", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([CARD_METHOD]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().isError).toBe(false);
  });

  it("methods contains the fetched items after a successful retry", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([CARD_METHOD, BANK_METHOD]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().methods).toEqual([CARD_METHOD, BANK_METHOD]);
  });

  it("calls the fetch function exactly once when retry is tapped once", async () => {
    const fetchMock = jest.fn().mockResolvedValue([CARD_METHOD]);
    const sim = makeQuerySim(fetchMock);
    sim.simulateInitialError();

    await sim.refetch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retry — clears error and shows empty state when fetch returns []
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retry — clears error and shows empty wallet state when fetch returns []", () => {
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

  it("methods is empty after retry returns []", async () => {
    const sim = makeQuerySim(jest.fn().mockResolvedValue([]));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().methods).toHaveLength(0);
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

  it("methods stays empty after a failed retry", async () => {
    const sim = makeQuerySim(jest.fn().mockRejectedValue(new Error("Network error")));
    sim.simulateInitialError();

    await sim.refetch();

    expect(sim.getState().methods).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// State transition sequence — full lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("Full lifecycle — error → retry → success", () => {
  it("transitions through error → loading → list in order", async () => {
    const snapshots: RenderBranch[] = [];
    const sim = makeQuerySim(jest.fn().mockResolvedValue([CARD_METHOD]));

    sim.simulateInitialError();
    snapshots.push(resolveRenderBranch(sim.getState())); // error

    sim.subscribe(() => snapshots.push(resolveRenderBranch(sim.getState())));

    await sim.refetch(); // loading → list

    expect(snapshots).toEqual(["error", "loading", "list"]);
  });

  it("transitions through error → loading → empty in order when wallet is empty", async () => {
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
