export type VoiceState =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "processing"
  | "speaking"
  | "confirming"
  | "error";

export type VoiceIntentName =
  // Navigation / Discovery
  | "FIND_STATIONS"
  | "FIND_NEAREST"
  | "FIND_SAFEST"
  | "FIND_CHEAPEST"
  | "FILTER_DCFC"
  // Station info
  | "STATION_INFO"
  | "PORT_AVAILABILITY"
  | "STATION_STATUS"
  | "CHARGING_SPEED"
  | "STATION_ACCESS"
  // Session control
  | "START_CHARGING"
  | "STOP_CHARGING"
  | "SESSION_STATUS"
  | "SESSION_ENERGY"
  | "SESSION_COST"
  | "SESSION_TIME"
  // Navigation
  | "NAVIGATE_TO_CHARGER"
  | "NAVIGATE_BEST"
  // Account
  | "CHARGING_HISTORY"
  | "PAYMENT_METHOD"
  | "FAVORITES"
  // Confirmation
  | "CONFIRM_YES"
  | "CONFIRM_NO"
  // Fleet (future-ready stub)
  | "FLEET_STATUS"
  | "FLEET_VEHICLE"
  | "FLEET_COSTS"
  // Fallback
  | "UNKNOWN";

export interface VoiceIntent {
  name: VoiceIntentName;
  confidence: number;
  rawTranscript: string;
}

export interface ActiveSessionSnapshot {
  sessionId: string;
  stationId: string;
  stationName: string;
  displayKwh: number;
  totalCostCents: number;
  elapsedSeconds: number;
  targetKwh: number;
  chargerType?: string;
  guestToken?: string;
}

export interface CurrentStationSnapshot {
  id: string;
  name: string;
  chargerType?: string | null;
  powerKw?: number | null;
  availablePorts?: number | null;
  totalPorts?: number | null;
  status?: string | null;
  isFree?: boolean | null;
  pricePerKwh?: number | null;
  accessType?: string | null;
  lat?: number | null;
  lon?: number | null;
  accessibilityLevel?: string | null;
  rankScore?: number | null;
}

export interface CommandContext {
  activeSession: ActiveSessionSnapshot | null;
  currentStation: CurrentStationSnapshot | null;
}

export type ConfirmableIntent = "START_CHARGING" | "STOP_CHARGING";

export interface PendingConfirmation {
  intent: ConfirmableIntent;
  context: CommandContext;
  promptText: string;
}

export interface VoiceCommandResult {
  response: string;
  action?: () => void | Promise<void>;
  requiresConfirmation?: PendingConfirmation;
  error?: string;
}
