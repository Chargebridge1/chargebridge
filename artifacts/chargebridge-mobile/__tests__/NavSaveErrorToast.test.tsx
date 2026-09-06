/**
 * Tests for NavSaveErrorToast timer behaviour.
 *
 * The component shows a brief error banner above the tab bar when a nav-pill
 * layout save fails.  It MUST auto-dismiss after its configured display
 * duration so the toast never becomes a permanent blocker.
 *
 * Constants (from the component):
 *   DISPLAY_MS_DEFAULT   = 3 000 ms  (no Retry button)
 *   DISPLAY_MS_WITH_RETRY = 6 000 ms  (Retry button present)
 *   FADE_MS              =   220 ms  (fade-out animation)
 *
 * onHide is invoked inside the Animated start() callback.  We mock Animated
 * so that start() calls its callback synchronously, then use Jest fake timers
 * to control setTimeout precisely.
 */

// ── React Native mocks (must be registered before any import) ─────────────────

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Feather: "Feather",
}));

jest.mock("@workspace/design-tokens", () => ({
  tokens: {
    colors: {
      dark: {
        tabBar: { activeTint: "#7B7FE8" },
      },
    },
  },
}));

/**
 * Mock react-native so:
 *  – Animated.Value is a simple class with a setValue stub.
 *  – Animated.timing returns a no-op animation object.
 *  – Animated.parallel returns an animation whose start() immediately invokes
 *    its callback (simulates an instantaneous animation in tests).
 *  – Animated.View renders as a plain string tag so react-test-renderer
 *    doesn't need native bridges.
 */
jest.mock("react-native", () => {
  class MockAnimatedValue {
    _value: number;
    constructor(initial: number) {
      this._value = initial;
    }
    setValue = jest.fn((v: number) => {
      this._value = v;
    });
  }

  return {
    Animated: {
      Value: MockAnimatedValue,
      timing: jest.fn(() => ({ start: jest.fn() })),
      // parallel(...).start(cb) calls cb immediately so onHide fires as
      // soon as the setTimeout callback runs.
      parallel: jest.fn(() => ({
        start: jest.fn((cb?: () => void) => {
          if (cb) cb();
        }),
      })),
      View: "Animated.View",
    },
    StyleSheet: {
      create: (s: Record<string, object>) => s,
      hairlineWidth: 1,
    },
    Text: "Text",
    TouchableOpacity: "TouchableOpacity",
    Pressable: "Pressable",
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React from "react";
import { create, act } from "react-test-renderer";
import { NavSaveErrorToast } from "../components/navigation/NavSaveErrorToast";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Render the toast and return helpers. */
function renderToast(
  props: Partial<React.ComponentProps<typeof NavSaveErrorToast>> = {}
) {
  const onHide = jest.fn();
  let renderer: ReturnType<typeof create>;

  act(() => {
    renderer = create(
      <NavSaveErrorToast visible={false} onHide={onHide} {...props} />
    );
  });

  function setVisible(visible: boolean) {
    act(() => {
      renderer.update(
        <NavSaveErrorToast visible={visible} onHide={onHide} {...props} />
      );
    });
  }

  return { onHide, setVisible };
}

// ── Timer constants ────────────────────────────────────────────────────────────

const DISPLAY_MS_DEFAULT = 3000;
const DISPLAY_MS_WITH_RETRY = 6000;

// ── Suite: default duration (no Retry button) ─────────────────────────────────

describe("NavSaveErrorToast — default duration (no Retry button)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("does NOT call onHide before the display duration has elapsed", () => {
    const { onHide, setVisible } = renderToast();

    act(() => {
      setVisible(true);
    });

    // Advance to just before the auto-dismiss fires
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT - 1);
    });

    expect(onHide).not.toHaveBeenCalled();
  });

  it("calls onHide after the display duration has elapsed", () => {
    const { onHide, setVisible } = renderToast();

    act(() => {
      setVisible(true);
    });

    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT);
    });

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("calls onHide exactly once — not multiple times", () => {
    const { onHide, setVisible } = renderToast();

    act(() => {
      setVisible(true);
    });

    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT * 2);
    });

    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

// ── Suite: extended duration (with Retry button) ──────────────────────────────

describe("NavSaveErrorToast — extended duration (with Retry button)", () => {
  const onRetry = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("does NOT call onHide before the extended display duration has elapsed", () => {
    const { onHide, setVisible } = renderToast({ onRetry });

    act(() => {
      setVisible(true);
    });

    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY - 1);
    });

    expect(onHide).not.toHaveBeenCalled();
  });

  it("calls onHide after the extended display duration has elapsed", () => {
    const { onHide, setVisible } = renderToast({ onRetry });

    act(() => {
      setVisible(true);
    });

    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY);
    });

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("does NOT dismiss early at the default (3 s) duration when Retry is present", () => {
    const { onHide, setVisible } = renderToast({ onRetry });

    act(() => {
      setVisible(true);
    });

    // Default duration should NOT trigger dismiss when Retry button is present
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT);
    });

    expect(onHide).not.toHaveBeenCalled();
  });
});

// ── Suite: Retry button interaction ───────────────────────────────────────────
//
// When the user taps Retry:
//   1. onHide() is called first (dismisses the toast immediately).
//   2. onRetry() is called second (re-fires the save attempt).
//
// The order matters: the toast must close before the async PATCH starts so
// it doesn't flicker if the retry also fails quickly.

describe("NavSaveErrorToast — Retry button interaction", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("calls onHide when the Retry button is pressed", () => {
    const onRetry = jest.fn();
    const { onHide, setVisible } = renderToast({ onRetry });

    act(() => {
      setVisible(true);
    });

    // Find the Retry TouchableOpacity and invoke its onPress handler
    const { create: _create } = jest.requireActual("react-test-renderer");
    // Re-render to get a renderer reference with Retry
    const onHideFn = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <NavSaveErrorToast visible={true} onHide={onHideFn} onRetry={onRetry} />
      );
    });

    const retryButton = renderer!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    )[0];

    act(() => {
      retryButton.props.onPress();
    });

    expect(onHideFn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry when the Retry button is pressed", () => {
    const onRetry = jest.fn();
    const onHideFn = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <NavSaveErrorToast visible={true} onHide={onHideFn} onRetry={onRetry} />
      );
    });

    const retryButton = renderer!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    )[0];

    act(() => {
      retryButton.props.onPress();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onHide before onRetry — toast closes before the retry PATCH starts", () => {
    const callOrder: string[] = [];
    const onHideFn = jest.fn(() => callOrder.push("onHide"));
    const onRetry = jest.fn(() => callOrder.push("onRetry"));
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <NavSaveErrorToast visible={true} onHide={onHideFn} onRetry={onRetry} />
      );
    });

    const retryButton = renderer!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    )[0];

    act(() => {
      retryButton.props.onPress();
    });

    expect(callOrder).toEqual(["onHide", "onRetry"]);
  });

  it("calls onHide exactly once when Retry is tapped before the auto-dismiss timer fires", () => {
    const onRetry = jest.fn();
    const onHideFn = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <NavSaveErrorToast visible={true} onHide={onHideFn} onRetry={onRetry} />
      );
    });

    const retryButton = renderer!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    )[0];

    // Tap Retry well before the 6 s auto-dismiss timer fires
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY / 2);
    });
    act(() => {
      retryButton.props.onPress();
    });

    // Advance past what would have been the original auto-dismiss fire time
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY);
    });

    // The timer must have been cancelled by the tap — onHide fires exactly once
    expect(onHideFn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry exactly once when Retry is tapped before the auto-dismiss timer fires", () => {
    const onRetry = jest.fn();
    const onHideFn = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <NavSaveErrorToast visible={true} onHide={onHideFn} onRetry={onRetry} />
      );
    });

    const retryButton = renderer!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    )[0];

    // Tap Retry well before the 6 s auto-dismiss timer fires
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY / 2);
    });
    act(() => {
      retryButton.props.onPress();
    });

    // Advance past what would have been the original auto-dismiss fire time
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_WITH_RETRY);
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the Retry button only when onRetry is provided", () => {
    // Without onRetry — no TouchableOpacity expected
    let rendererNoRetry: ReturnType<typeof create>;
    act(() => {
      rendererNoRetry = create(
        <NavSaveErrorToast visible={true} onHide={jest.fn()} />
      );
    });
    const buttonsWithoutRetry = rendererNoRetry!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    );
    expect(buttonsWithoutRetry).toHaveLength(0);

    // With onRetry — exactly one TouchableOpacity (the Retry button)
    let rendererWithRetry: ReturnType<typeof create>;
    act(() => {
      rendererWithRetry = create(
        <NavSaveErrorToast visible={true} onHide={jest.fn()} onRetry={jest.fn()} />
      );
    });
    const buttonsWithRetry = rendererWithRetry!.root.findAll(
      (node) => node.type === "TouchableOpacity"
    );
    expect(buttonsWithRetry).toHaveLength(1);
  });
});

// ── Suite: re-arm after auto-dismiss ──────────────────────────────────────────
//
// After the toast auto-dismisses the parent flips visible back to false.
// The useEffect cleanup resets the Animated values so the next show cycle
// starts from a clean hidden state.  These tests verify the second appearance
// works correctly and that no stale timer or state from the first cycle leaks.

describe("NavSaveErrorToast — re-arm after auto-dismiss", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("calls onHide a second time after being shown again following auto-dismiss", () => {
    const { onHide, setVisible } = renderToast();

    // Cycle 1: show → wait full duration → auto-dismiss fires
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });
    expect(onHide).toHaveBeenCalledTimes(1);

    // Parent hides the toast in response to onHide
    act(() => { setVisible(false); });

    // Cycle 2: show again → wait full duration → auto-dismiss fires again
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });

    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it("calls onHide exactly once per cycle — no stale calls from the first cycle bleed into the second", () => {
    const { onHide, setVisible } = renderToast();

    // Cycle 1
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });
    // Exactly 1 call at end of cycle 1
    expect(onHide).toHaveBeenCalledTimes(1);

    act(() => { setVisible(false); });

    // Clear the mock so cycle 2 is measured independently
    onHide.mockClear();

    // Cycle 2
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });
    // Exactly 1 call at end of cycle 2 — no extra calls from the first cycle
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

// ── Suite: no timer fires when visible is false ────────────────────────────────

describe("NavSaveErrorToast — stays hidden when visible=false", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("never calls onHide when the toast is never made visible", () => {
    const { onHide } = renderToast({ visible: false });

    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT * 3);
    });

    expect(onHide).not.toHaveBeenCalled();
  });

  it("cancels the pending timer when visible flips back to false before it fires", () => {
    const { onHide, setVisible } = renderToast();

    act(() => {
      setVisible(true);
    });

    // Let half the duration pass, then hide externally
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT / 2);
    });

    act(() => {
      setVisible(false);
    });

    // Advance past what would have been the original fire time
    act(() => {
      jest.advanceTimersByTime(DISPLAY_MS_DEFAULT);
    });

    expect(onHide).not.toHaveBeenCalled();
  });
});

// ── Suite: rapid back-to-back visibility (two save failures) ──────────────────
//
// When two save failures fire in rapid succession the parent sets
// visible=true → false → true in quick succession.  The first timer must be
// cancelled by the cleanup and the second timer must fire once — and only once
// — after its own full 3 s window.

describe("NavSaveErrorToast — rapid back-to-back visibility", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("calls onHide exactly once after the second show window when the first timer was cancelled mid-flight", () => {
    const { onHide, setVisible } = renderToast();

    // First failure: show the toast
    act(() => { setVisible(true); });

    // Let part of the first timer run, then hide before it fires
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT / 2); });

    // Hide before the first timer fires — cleanup cancels the first timer
    act(() => { setVisible(false); });

    // Second failure: show the toast again immediately (back-to-back)
    act(() => { setVisible(true); });

    // onHide must NOT have been called yet (first timer was cancelled,
    // second timer hasn't elapsed yet)
    expect(onHide).not.toHaveBeenCalled();

    // Advance through the second full window
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });

    // Exactly one call — from the second timer only
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onHide for the cancelled first timer after the second show cycle", () => {
    const { onHide, setVisible } = renderToast();

    // First show → hide early → second show
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT / 2); });
    act(() => { setVisible(false); });
    act(() => { setVisible(true); });

    // Advance well past what the original first-timer expiry would have been,
    // but not yet past the second timer's expiry
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT / 2 + 1); });

    // The first timer's would-be fire time has now passed — onHide must still
    // not have been called (only the second timer counts)
    expect(onHide).not.toHaveBeenCalled();
  });

  it("calls onHide exactly once even when three rapid cycles fire", () => {
    const { onHide, setVisible } = renderToast();

    // Three rapid show→hide cycles before any timer fires
    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(100); });
    act(() => { setVisible(false); });

    act(() => { setVisible(true); });
    act(() => { jest.advanceTimersByTime(100); });
    act(() => { setVisible(false); });

    // Third (final) show
    act(() => { setVisible(true); });

    // Advance through the full third-window duration
    act(() => { jest.advanceTimersByTime(DISPLAY_MS_DEFAULT); });

    // Only the third timer should have fired — exactly one call
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
