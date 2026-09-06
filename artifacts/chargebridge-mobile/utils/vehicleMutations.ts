/**
 * Core mutation logic for add/edit vehicle, extracted from ProfileTab so it
 * can be unit-tested without a React rendering environment.
 *
 * All external dependencies are injected as callbacks so tests can mock them
 * without touching module-level mocks.
 */

// ── SessionExpiredError ───────────────────────────────────────────────────────

/**
 * Thrown (or passed to onError) when getToken() returns null in any vehicle
 * mutation.  Callers — e.g. useMutation's onError handler — can check
 * `instanceof SessionExpiredError` to suppress the generic error alert when a
 * dedicated "Session Expired" alert with a "Sign In Again" button has already
 * been shown by the onSessionExpired callback.
 */
export class SessionExpiredError extends Error {
  readonly isSessionExpired = true as const;
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

// ── Shared types ─────────────────────────────────────────────────────────────

export interface VehicleData {
  make?: string | null;
  model?: string | null;
  year?: string | null;
  connectorType?: string | null;
  batteryKwh?: number | null;
  rangePerCharge?: number | null;
  nickname?: string | null;
  fuelType?: string | null;
  isPrimary?: boolean;
}

// ── AddVehicle ────────────────────────────────────────────────────────────────

export interface AddVehicleDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Performs the POST /api/me/vehicles request. Receives the bearer token and
   * vehicle data; throws on non-OK responses with an Error whose message is
   * the API's `error` field.
   */
  postVehicle: (token: string, data: VehicleData) => Promise<unknown>;
  /** Called with the new vehicle returned by the API on success. */
  onSuccess: (vehicle: unknown) => void;
  /**
   * Called with the thrown Error on failure. This is where the caller shows
   * Alert.alert — kept outside the utility so tests don't need to mock RN.
   */
  onError: (err: Error) => void;
  /**
   * Called when getToken() returns null (session expired). The parent UI
   * should replace the primary CTA with a "Sign In Again" action so the
   * button is never permanently broken.  Called before onError.
   */
  onSessionExpired?: () => void;
  /** Optional analytics tracker. */
  track?: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Runs the add-vehicle mutation.
 *
 * - If `getToken()` returns null, throws a session-expired error and routes it
 *   through `onError` without touching the network.
 * - If the POST succeeds, calls `onSuccess` with the created vehicle.
 * - Any other error (network, API 4xx/5xx) is routed through `onError`.
 * - The form-open state is intentionally NOT managed here; callers must only
 *   close the form inside `onSuccess` so the user can retry after a failure.
 */
export async function runAddVehicle(
  data: VehicleData,
  deps: AddVehicleDeps,
): Promise<void> {
  const { getToken, postVehicle, onSuccess, onError, track } = deps;

  track?.("profile_addvehicle_started", {});

  let token: string | null = null;
  try {
    token = await getToken();
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    track?.("profile_addvehicle_token_error", { error: msg });
    onError(tokenErr instanceof Error ? tokenErr : new Error(msg));
    return;
  }

  track?.("profile_addvehicle_token_result", { token_present: !!token });

  if (!token) {
    track?.("profile_addvehicle_no_token", {});
    deps.onSessionExpired?.();
    // Use SessionExpiredError so the useMutation onError handler can
    // distinguish this from a generic failure and skip showing a second alert.
    onError(
      new SessionExpiredError(
        "Your session has expired. Please sign in again to add a vehicle.",
      ),
    );
    return;
  }

  let vehicle: unknown;
  try {
    vehicle = await postVehicle(token, data);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    track?.("profile_addvehicle_failed", { error: e.message });
    onError(e);
    return;
  }

  track?.("profile_addvehicle_complete", {});
  onSuccess(vehicle);
}

// ── EditVehicle ───────────────────────────────────────────────────────────────

export interface EditVehicleDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Performs the PATCH /api/me/vehicles/:id request. Receives the bearer token,
   * vehicle id, and update data; throws on non-OK responses.
   */
  patchVehicle: (
    token: string,
    id: number,
    data: VehicleData,
  ) => Promise<unknown>;
  /** Called with the updated vehicle returned by the API on success. */
  onSuccess: (vehicle: unknown) => void;
  /**
   * Called with the thrown Error on failure. The caller shows Alert.alert here
   * so this utility stays framework-free.
   */
  onError: (err: Error) => void;
  /**
   * Called when getToken() returns null (session expired). The parent UI
   * should replace the primary CTA with a "Sign In Again" action so the
   * button is never permanently broken.  Called before onError.
   */
  onSessionExpired?: () => void;
  /** Optional analytics tracker. */
  track?: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Runs the edit-vehicle mutation.
 *
 * - If `getToken()` returns null, throws a session-expired error and routes it
 *   through `onError` without touching the network.
 * - If the PATCH succeeds, calls `onSuccess` with the updated vehicle.
 * - Any other error (network, API 4xx/5xx) is routed through `onError`.
 * - The edit-form state is intentionally NOT managed here; callers must only
 *   close the form inside `onSuccess` so the user can retry after a failure.
 */
export async function runEditVehicle(
  id: number,
  data: VehicleData,
  deps: EditVehicleDeps,
): Promise<void> {
  const { getToken, patchVehicle, onSuccess, onError, track } = deps;

  track?.("profile_editvehicle_started", { vehicle_id: id });

  let token: string | null = null;
  try {
    token = await getToken();
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    track?.("profile_editvehicle_token_error", { error: msg });
    onError(tokenErr instanceof Error ? tokenErr : new Error(msg));
    return;
  }

  track?.("profile_editvehicle_token_result", { token_present: !!token });

  if (!token) {
    track?.("profile_editvehicle_no_token", {});
    deps.onSessionExpired?.();
    // Use SessionExpiredError so the useMutation onError handler can
    // distinguish this from a generic failure and skip showing a second alert.
    onError(
      new SessionExpiredError(
        "Your session has expired. Please sign in again to save changes.",
      ),
    );
    return;
  }

  let vehicle: unknown;
  try {
    vehicle = await patchVehicle(token, id, data);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    track?.("profile_editvehicle_failed", { error: e.message });
    onError(e);
    return;
  }

  track?.("profile_editvehicle_complete", { vehicle_id: id });
  onSuccess(vehicle);
}

// ── DeleteVehicle ─────────────────────────────────────────────────────────────

export interface DeleteVehicleDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Performs the DELETE /api/me/vehicles/:id request. Receives the bearer token
   * and vehicle id; throws on non-OK responses with an Error whose message is
   * the API's `error` field.
   */
  deleteVehicle: (token: string, id: number) => Promise<void>;
  /** Called when the vehicle has been successfully deleted. */
  onSuccess: () => void;
  /**
   * Called with the thrown Error on failure. This is where the caller shows
   * Alert.alert — kept outside the utility so tests don't need to mock RN.
   */
  onError: (err: Error) => void;
  /**
   * Called when getToken() returns null (session expired). The parent UI
   * should offer a "Sign In Again" action so the user is not left with a
   * permanently broken delete button.  Called before onError.
   */
  onSessionExpired?: () => void;
  /** Optional analytics tracker. */
  track?: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Runs the delete-vehicle mutation.
 *
 * - If `getToken()` returns null, calls `onError` with a session-expired
 *   message and returns without touching the network.
 * - If `getToken()` throws, routes the error through `onError`.
 * - If the DELETE succeeds, calls `onSuccess`.
 * - Any other error (network, API 4xx/5xx) is routed through `onError`.
 */
export async function runDeleteVehicle(
  id: number,
  deps: DeleteVehicleDeps,
): Promise<void> {
  const { getToken, deleteVehicle, onSuccess, onError, track } = deps;

  track?.("profile_deletevehicle_started", { vehicle_id: id });

  let token: string | null = null;
  try {
    token = await getToken();
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    track?.("profile_deletevehicle_token_error", { error: msg });
    onError(tokenErr instanceof Error ? tokenErr : new Error(msg));
    return;
  }

  track?.("profile_deletevehicle_token_result", { token_present: !!token });

  if (!token) {
    track?.("profile_deletevehicle_no_token", {});
    deps.onSessionExpired?.();
    // Use SessionExpiredError so the useMutation onError handler can
    // distinguish this from a generic failure and skip showing a second alert.
    onError(
      new SessionExpiredError(
        "Your session has expired. Please sign in again to delete this vehicle.",
      ),
    );
    return;
  }

  try {
    await deleteVehicle(token, id);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    track?.("profile_deletevehicle_failed", { error: e.message });
    onError(e);
    return;
  }

  track?.("profile_deletevehicle_complete", { vehicle_id: id });
  onSuccess();
}

// ── SetPrimaryVehicle ─────────────────────────────────────────────────────────

export interface SetPrimaryVehicleDeps {
  /** Returns the current Clerk session token, or null if the session has expired. */
  getToken: () => Promise<string | null>;
  /**
   * Performs the POST /api/me/vehicles/:id/primary request. Receives the bearer
   * token and vehicle id; throws on non-OK responses with an Error whose message
   * is the API's `error` field.
   */
  setPrimaryVehicle: (token: string, id: number) => Promise<unknown>;
  /** Called with the API response when the vehicle has been successfully set as primary. */
  onSuccess: (result: unknown) => void;
  /**
   * Called with the thrown Error on failure. This is where the caller shows
   * Alert.alert — kept outside the utility so tests don't need to mock RN.
   */
  onError: (err: Error) => void;
  /**
   * Called when getToken() returns null (session expired). The parent UI
   * should offer a "Sign In Again" action so the user is not left with a
   * permanently broken button.  Called before onError.
   */
  onSessionExpired?: () => void;
  /** Optional analytics tracker. */
  track?: (event: string, props: Record<string, unknown>) => void;
}

/**
 * Runs the set-primary-vehicle mutation.
 *
 * - If `getToken()` returns null, calls `onSessionExpired` and then `onError`
 *   with a SessionExpiredError without touching the network.
 * - If `getToken()` throws, routes the error through `onError`.
 * - If the POST succeeds, calls `onSuccess` with the API response.
 * - Any other error (network, API 4xx/5xx) is routed through `onError`.
 */
export async function runSetPrimaryVehicle(
  id: number,
  deps: SetPrimaryVehicleDeps,
): Promise<void> {
  const { getToken, setPrimaryVehicle, onSuccess, onError, track } = deps;

  track?.("profile_setprimary_started", { vehicle_id: id });

  let token: string | null = null;
  try {
    token = await getToken();
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    track?.("profile_setprimary_token_error", { error: msg });
    onError(tokenErr instanceof Error ? tokenErr : new Error(msg));
    return;
  }

  track?.("profile_setprimary_token_result", { token_present: !!token });

  if (!token) {
    track?.("profile_setprimary_no_token", {});
    deps.onSessionExpired?.();
    // Use SessionExpiredError so the useMutation onError handler can
    // distinguish this from a generic failure and skip showing a second alert.
    onError(
      new SessionExpiredError(
        "Your session has expired. Please sign in again to update your primary vehicle.",
      ),
    );
    return;
  }

  let result: unknown;
  try {
    result = await setPrimaryVehicle(token, id);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    track?.("profile_setprimary_failed", { error: e.message });
    onError(e);
    return;
  }

  track?.("profile_setprimary_complete", { vehicle_id: id });
  onSuccess(result);
}

// ── editVehicleMutation onError handler ──────────────────────────────────────

/**
 * The body of the `onError` handler used by `editVehicleMutation` in
 * `profile.tsx`, exported so it can be unit-tested directly.
 *
 * Rule: when `err` is a `SessionExpiredError` the function returns immediately
 * without calling `alertFn` — the dedicated "Session Expired" alert with a
 * "Sign In Again" button was already shown by `onSessionExpired`, so a second
 * generic dialog must be suppressed.  Any other error reaches `alertFn`.
 *
 * Exporting this function means a future refactor that removes or weakens the
 * `instanceof SessionExpiredError` guard will immediately break the unit tests
 * in `vehicleMutations.test.ts`.
 *
 * @param err      The error received by the `useMutation` `onError` callback.
 * @param alertFn  Pass `Alert.alert` in production; pass a `jest.fn()` in tests.
 */
export function editVehicleOnError(
  err: Error,
  alertFn: (title: string, message: string) => void,
): void {
  // The onSessionExpired callback already showed a dedicated "Session Expired"
  // alert with a "Sign In Again" button — suppress the generic alert so the
  // user never sees two consecutive dialogs.
  if (err instanceof SessionExpiredError) return;
  alertFn("Couldn't Save Vehicle", err.message || "Something went wrong. Please try again.");
}

// ── addVehicleMutation onError handler ───────────────────────────────────────

/**
 * The body of the `onError` handler used by `addVehicleMutation` in
 * `profile.tsx`, exported so it can be unit-tested directly.
 *
 * Rule: when `err` is a `SessionExpiredError` the function returns immediately
 * without calling `alertFn` — the dedicated "Session Expired" alert with a
 * "Sign In Again" button was already shown by `onSessionExpired`, so a second
 * generic dialog must be suppressed.  Any other error reaches `alertFn`.
 *
 * Exporting this function means a future refactor that removes or weakens the
 * `instanceof SessionExpiredError` guard will immediately break the unit tests
 * in `vehicleMutations.test.ts`.
 *
 * @param err      The error received by the `useMutation` `onError` callback.
 * @param alertFn  Pass `Alert.alert` in production; pass a `jest.fn()` in tests.
 */
export function addVehicleOnError(
  err: Error,
  alertFn: (title: string, message: string) => void,
): void {
  // The onSessionExpired callback already showed a dedicated "Session Expired"
  // alert with a "Sign In Again" button — suppress the generic alert so the
  // user never sees two consecutive dialogs.
  if (err instanceof SessionExpiredError) return;
  alertFn("Couldn't Add Vehicle", err.message || "Something went wrong. Please try again.");
}

// ── deleteVehicleMutation onError handler ─────────────────────────────────────

/**
 * The body of the `onError` handler used by `deleteVehicleMutation` in
 * `profile.tsx`, exported so it can be unit-tested directly.
 *
 * Rule: when `err` is a `SessionExpiredError` the function returns immediately
 * without calling `alertFn` — the dedicated "Session Expired" alert with a
 * "Sign In Again" button was already shown by `onSessionExpired`, so a second
 * generic dialog must be suppressed.  Any other error reaches `alertFn`.
 *
 * Exporting this function means a future refactor that removes or weakens the
 * `instanceof SessionExpiredError` guard will immediately break the unit tests
 * in `vehicleMutations.test.ts`.
 *
 * @param err      The error received by the `useMutation` `onError` callback.
 * @param alertFn  Pass `Alert.alert` in production; pass a `jest.fn()` in tests.
 */
export function deleteVehicleOnError(
  err: Error,
  alertFn: (title: string, message: string) => void,
): void {
  // The onSessionExpired callback already showed a dedicated "Session Expired"
  // alert with a "Sign In Again" button — suppress the generic alert so the
  // user never sees two consecutive dialogs.
  if (err instanceof SessionExpiredError) return;
  alertFn("Couldn't Remove Vehicle", err.message || "Something went wrong. Please try again.");
}

// ── setPrimaryMutation onError handler ────────────────────────────────────────

/**
 * The body of the `onError` handler used by `setPrimaryMutation` in
 * `profile.tsx`, exported so it can be unit-tested directly.
 *
 * Rule: when `err` is a `SessionExpiredError` the function returns immediately
 * without calling `alertFn` — the dedicated "Session Expired" alert with a
 * "Sign In Again" button was already shown by `onSessionExpired`, so a second
 * generic dialog must be suppressed.  Any other error reaches `alertFn`.
 *
 * Exporting this function means a future refactor that removes or weakens the
 * `instanceof SessionExpiredError` guard will immediately break the unit tests
 * in `vehicleMutations.test.ts`.
 *
 * @param err      The error received by the `useMutation` `onError` callback.
 * @param alertFn  Pass `Alert.alert` in production; pass a `jest.fn()` in tests.
 */
export function setPrimaryVehicleOnError(
  err: Error,
  alertFn: (title: string, message: string) => void,
): void {
  // The onSessionExpired callback already showed a dedicated "Session Expired"
  // alert with a "Sign In Again" button — suppress the generic alert so the
  // user never sees two consecutive dialogs.
  if (err instanceof SessionExpiredError) return;
  alertFn("Couldn't Set Primary Vehicle", err.message || "Something went wrong. Please try again.");
}
