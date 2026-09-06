import * as SecureStore from "expo-secure-store";
import {
  setGuestToken,
  getGuestToken,
  deleteGuestToken,
  GUEST_TOKEN_TTL_MS,
} from "../utils/guestToken";

jest.mock("expo-secure-store");

const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItemAsync.mockResolvedValue(undefined);
  mockDeleteItemAsync.mockResolvedValue(undefined);
});

describe("setGuestToken", () => {
  it("writes a JSON payload with the token and a future expiresAt", async () => {
    const before = Date.now();
    await setGuestToken(42, "tok_abc");
    const after = Date.now();

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    const [key, value] = mockSetItemAsync.mock.calls[0];
    expect(key).toBe("guestToken:42");

    const parsed = JSON.parse(value as string) as {
      token: string;
      expiresAt: number;
    };
    expect(parsed.token).toBe("tok_abc");
    expect(parsed.expiresAt).toBeGreaterThanOrEqual(before + GUEST_TOKEN_TTL_MS);
    expect(parsed.expiresAt).toBeLessThanOrEqual(after + GUEST_TOKEN_TTL_MS);
  });

  it("propagates a SecureStore rejection instead of swallowing it", async () => {
    mockSetItemAsync.mockRejectedValueOnce(new Error("Device storage full"));

    await expect(setGuestToken(99, "tok_fail")).rejects.toThrow(
      "Device storage full",
    );
  });

  it("cleans up both the main key and the companion first-seen key on write failure", async () => {
    mockSetItemAsync.mockRejectedValueOnce(new Error("write error"));

    await expect(setGuestToken(77, "tok_x")).rejects.toThrow();

    // Both keys must be evicted so a pre-migration companion key doesn't linger.
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:77");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestTokenFirstSeen:77");
  });
});

describe("getGuestToken", () => {
  it("returns status 'absent' when there is no stored entry", async () => {
    mockGetItemAsync.mockResolvedValue(null);
    const result = await getGuestToken(1);
    expect(result).toEqual({ token: null, status: "absent" });
  });

  it("returns status 'valid' for a structured token well within the 72-hour TTL", async () => {
    const expiresAt = Date.now() + 60_000;
    const payload = JSON.stringify({ token: "tok_valid", expiresAt });
    mockGetItemAsync.mockResolvedValue(payload);

    const result = await getGuestToken(1);
    expect(result).toEqual({ token: "tok_valid", expiresAt, status: "valid" });
  });

  it("returns status 'valid' for a structured token with 1 ms remaining (just inside the boundary)", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    const expiresAt = now + 1;
    const payload = JSON.stringify({ token: "tok_edge_valid", expiresAt });
    mockGetItemAsync.mockResolvedValue(payload);

    const result = await getGuestToken(10);
    expect(result).toEqual({ token: "tok_edge_valid", expiresAt, status: "valid" });

    jest.restoreAllMocks();
  });

  it("returns status 'expired' at the exact TTL boundary (expiresAt === Date.now())", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    const payload = JSON.stringify({ token: "tok_boundary", expiresAt: now });
    mockGetItemAsync.mockResolvedValue(payload);

    const result = await getGuestToken(11);
    expect(result).toEqual({ token: null, status: "expired" });
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:11");

    jest.restoreAllMocks();
  });

  it("returns status 'expired' and schedules deletion for a past expiresAt (1 ms over)", async () => {
    const payload = JSON.stringify({
      token: "tok_old",
      expiresAt: Date.now() - 1,
    });
    mockGetItemAsync.mockResolvedValue(payload);

    const result = await getGuestToken(1);
    expect(result).toEqual({ token: null, status: "expired" });
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:1");
  });

  it("returns status 'expired' for a structured token that is more than 72 hours old", async () => {
    const payload = JSON.stringify({
      token: "tok_very_old",
      expiresAt: Date.now() - GUEST_TOKEN_TTL_MS - 1,
    });
    mockGetItemAsync.mockResolvedValue(payload);

    const result = await getGuestToken(12);
    expect(result).toEqual({ token: null, status: "expired" });
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:12");
  });

  it("returns status 'valid' for a pre-migration plain-string token on first read", async () => {
    mockGetItemAsync.mockResolvedValueOnce("plain-token-string");
    mockGetItemAsync.mockResolvedValueOnce(null);
    const result = await getGuestToken(1);
    expect(result).toEqual({ token: "plain-token-string", status: "valid" });
  });

  it("returns status 'valid' for a pre-migration plain-string token on subsequent reads within 48 h", async () => {
    const recentTimestamp = String(Date.now() - 60_000);
    mockGetItemAsync.mockResolvedValueOnce("plain-token-still-fresh");
    mockGetItemAsync.mockResolvedValueOnce(recentTimestamp);

    const result = await getGuestToken(13);
    expect(result).toEqual({ token: "plain-token-still-fresh", status: "valid" });
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });

  it("returns status 'expired' and evicts both keys when plain-string token is stale (48 h+)", async () => {
    const staleTimestamp = String(Date.now() - 48 * 60 * 60 * 1000 - 1);
    mockGetItemAsync.mockResolvedValueOnce("old-plain-token");
    mockGetItemAsync.mockResolvedValueOnce(staleTimestamp);

    const result = await getGuestToken(7);
    expect(result).toEqual({ token: null, status: "expired" });
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:7");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestTokenFirstSeen:7");
  });

  it("returns status 'invalid' for malformed JSON (valid JSON but wrong shape)", async () => {
    mockGetItemAsync.mockResolvedValue(JSON.stringify({ wrong: "shape" }));
    const result = await getGuestToken(2);
    expect(result).toEqual({ token: null, status: "invalid" });
  });

  it("returns status 'absent' for an empty string entry (falsy guard catches it before JSON parse)", async () => {
    mockGetItemAsync.mockResolvedValue("");
    const result = await getGuestToken(3);
    expect(result).toEqual({ token: null, status: "absent" });
  });
});

describe("deleteGuestToken", () => {
  it("deletes the main key and the companion first-seen key", () => {
    deleteGuestToken(5);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:5");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestTokenFirstSeen:5");
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(2);
  });

  it("accepts a string session ID", () => {
    deleteGuestToken("sess_abc");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:sess_abc");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(
      "guestTokenFirstSeen:sess_abc",
    );
  });
});

describe("guest token cleanup on charging failure", () => {
  it("leaves no token in SecureStore after deleteGuestToken is called following a start-charging error", async () => {
    const store: Record<string, string> = {};
    mockSetItemAsync.mockImplementation(async (key, value) => { store[key] = value as string; });
    mockGetItemAsync.mockImplementation(async (key) => store[key] ?? null);
    mockDeleteItemAsync.mockImplementation(async (key) => { delete store[key]; });

    const SESSION_ID = 303;

    // Payment succeeded — token was saved to SecureStore.
    await setGuestToken(SESSION_ID, "tok_start_fail");
    expect(store[`guestToken:${SESSION_ID}`]).toBeDefined();

    // start-charging returned an error → the charging flow calls deleteGuestToken.
    deleteGuestToken(SESSION_ID);
    await Promise.resolve();

    // The token must be gone so force-quit recovery doesn't find a dead session.
    const result = await getGuestToken(SESSION_ID);
    expect(result.status).toBe("absent");
    expect(result.token).toBeNull();
  });

  it("deleteGuestToken removes both the main key and companion first-seen key after a start-charging failure", async () => {
    const SESSION_ID = 304;
    deleteGuestToken(SESSION_ID);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:304");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestTokenFirstSeen:304");
  });

  it("leaves no token in SecureStore when SecureStore is unavailable and the user cancels the warning dialog", async () => {
    // Simulate setGuestToken failing (SecureStore write error).
    // The internal catch block calls deleteItemAsync to evict any stale entry.
    mockSetItemAsync.mockRejectedValueOnce(new Error("storage unavailable"));

    // setGuestToken must throw so the caller knows to show the warning dialog.
    await expect(setGuestToken(305, "tok_no_store")).rejects.toThrow("storage unavailable");

    // The internal cleanup must have been attempted for both keys.
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestToken:305");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith("guestTokenFirstSeen:305");

    // After the user taps Cancel in the dialog, no read of the store
    // should surface a stale token (nothing was persisted).
    mockGetItemAsync.mockResolvedValueOnce(null);
    const result = await getGuestToken(305);
    expect(result.status).toBe("absent");
    expect(result.token).toBeNull();
  });

  it("does not call deleteGuestToken when start-charging succeeds (token stays for force-quit recovery)", async () => {
    const store: Record<string, string> = {};
    mockSetItemAsync.mockImplementation(async (key, value) => { store[key] = value as string; });
    mockGetItemAsync.mockImplementation(async (key) => store[key] ?? null);
    mockDeleteItemAsync.mockImplementation(async (key) => { delete store[key]; });

    const SESSION_ID = 306;

    // Token is saved and start-charging succeeds — deleteGuestToken is NOT called here.
    await setGuestToken(SESSION_ID, "tok_success");

    // Token must remain available for force-quit recovery.
    const result = await getGuestToken(SESSION_ID);
    expect(result.status).toBe("valid");
    expect(result.token).toBe("tok_success");
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });
});

describe("force-quit recovery lifecycle (integration)", () => {
  it("simulates write → cold-start read → delete lifecycle using an in-memory store", async () => {
    const store: Record<string, string> = {};

    mockSetItemAsync.mockImplementation(async (key, value) => {
      store[key] = value as string;
    });
    mockGetItemAsync.mockImplementation(async (key) => store[key] ?? null);
    mockDeleteItemAsync.mockImplementation(async (key) => {
      delete store[key];
    });

    const SESSION_ID = 101;
    const TOKEN = "guest_tok_lifecycle";

    // Step 1 — write (simulates the initial session start, before any force-quit)
    await setGuestToken(SESSION_ID, TOKEN);
    expect(store[`guestToken:${SESSION_ID}`]).toBeDefined();

    // Step 2 — cold-start read (simulates the app reopening after force-quit)
    const recovered = await getGuestToken(SESSION_ID);
    expect(recovered.status).toBe("valid");
    expect(recovered.token).toBe(TOKEN);

    // Step 3 — delete (simulates session end — stop-charging success or explicit logout)
    deleteGuestToken(SESSION_ID);
    // Give fire-and-forget deleteItemAsync promises a tick to settle
    await Promise.resolve();

    // Step 4 — confirm absent (a second cold-start would find nothing)
    const afterDelete = await getGuestToken(SESSION_ID);
    expect(afterDelete.status).toBe("absent");
    expect(afterDelete.token).toBeNull();
  });

  it("returns 'expired' on cold-start when the 72-hour TTL has elapsed", async () => {
    const store: Record<string, string> = {};

    mockSetItemAsync.mockImplementation(async (key, value) => {
      store[key] = value as string;
    });
    mockGetItemAsync.mockImplementation(async (key) => store[key] ?? null);
    mockDeleteItemAsync.mockImplementation(async (key) => {
      delete store[key];
    });

    const SESSION_ID = 202;

    // Manually write an already-expired entry (simulating a token saved >72 h ago)
    const expiredPayload = JSON.stringify({
      token: "stale_tok",
      expiresAt: Date.now() - 1,
    });
    await SecureStore.setItemAsync(`guestToken:${SESSION_ID}`, expiredPayload);

    // Cold-start read should detect expiry and trigger cleanup
    const result = await getGuestToken(SESSION_ID);
    expect(result.status).toBe("expired");
    expect(result.token).toBeNull();

    // The stale entry must have been evicted so subsequent reads see "absent"
    await Promise.resolve();
    const afterEvict = await getGuestToken(SESSION_ID);
    expect(afterEvict.status).toBe("absent");
  });
});
