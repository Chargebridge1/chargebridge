export interface OcpiResponse<T = null> {
  data: T;
  status_code: number;
  status_message?: string;
  timestamp: string;
}

export interface DisplayText { language: string; text: string; }
export interface GeoLocation { latitude: string; longitude: string; }
export interface Price { excl_vat: number; incl_vat?: number; }

export interface BusinessDetails {
  name: string;
  website?: string;
  logo?: Image;
}

export interface Image {
  url: string;
  thumbnail?: string;
  category: "CHARGER" | "ENTRANCE" | "LOCATION" | "NETWORK" | "OPERATOR" | "OTHER" | "OWNER";
  type: string;
  width?: number;
  height?: number;
}

export type Role = "CPO" | "EMSP" | "HUB" | "NSP" | "NAP" | "SCSP";

export interface CredentialRole {
  role: Role;
  business_details: BusinessDetails;
  party_id: string;
  country_code: string;
}

export interface Credentials {
  token: string;
  url: string;
  roles: CredentialRole[];
}

export interface Version { version: string; url: string; }

export interface VersionDetails {
  version: string;
  endpoints: Endpoint[];
}

export type ModuleID = "cdrs" | "chargingprofiles" | "commands" | "credentials" | "hubclientinfo" | "locations" | "sessions" | "tariffs" | "tokens";
export type InterfaceRole = "SENDER" | "RECEIVER";

export interface Endpoint {
  identifier: ModuleID;
  role: InterfaceRole;
  url: string;
}

export type ConnectorStatus = "AVAILABLE" | "BLOCKED" | "CHARGING" | "INOPERATIVE" | "OUTOFORDER" | "PLANNED" | "REMOVED" | "RESERVED" | "UNKNOWN";

export type ConnectorType =
  | "CHADEMO" | "CHAOJI"
  | "IEC_62196_T1" | "IEC_62196_T1_COMBO"
  | "IEC_62196_T2" | "IEC_62196_T2_COMBO"
  | "IEC_62196_T3A" | "IEC_62196_T3C"
  | "NEMA_5_20" | "NEMA_6_30" | "NEMA_6_50" | "NEMA_14_30" | "NEMA_14_50"
  | "TESLA_R" | "TESLA_S"
  | "DOMESTIC_A" | "DOMESTIC_B" | "DOMESTIC_C" | "DOMESTIC_D" | "DOMESTIC_E" | "DOMESTIC_F"
  | "DOMESTIC_G" | "DOMESTIC_H" | "DOMESTIC_I" | "DOMESTIC_J" | "DOMESTIC_K" | "DOMESTIC_L"
  | "IEC_60309_2_single_16" | "IEC_60309_2_three_16" | "IEC_60309_2_three_32" | "IEC_60309_2_three_64"
  | "PANTOGRAPH_BOTTOM_UP" | "PANTOGRAPH_TOP_DOWN"
  | "UNKNOWN";

export type ConnectorFormat = "SOCKET" | "CABLE";
export type PowerType = "AC_1_PHASE" | "AC_2_PHASE" | "AC_2_PHASE_SPLIT" | "AC_3_PHASE" | "DC";

export interface Connector {
  id: string;
  standard: ConnectorType;
  format: ConnectorFormat;
  power_type: PowerType;
  max_voltage: number;
  max_amperage: number;
  max_electric_power?: number;
  tariff_ids?: string[];
  terms_and_conditions?: string;
  last_updated: string;
}

export type Capability =
  | "CHARGING_PROFILE_CAPABLE" | "CHARGING_PREFERENCES_CAPABLE"
  | "CHIP_CARD_SUPPORT" | "CONTACTLESS_CARD_SUPPORT"
  | "CREDIT_CARD_PAYABLE" | "DEBIT_CARD_PAYABLE"
  | "PED_TERMINAL" | "REMOTE_START_STOP_CAPABLE"
  | "RESERVABLE" | "RFID_READER"
  | "START_SESSION_CONNECTOR_REQUIRED" | "TOKEN_GROUP_CAPABLE" | "UNLOCK_CAPABLE";

export type ParkingRestriction = "EV_ONLY" | "PLUGGED" | "DISABLED" | "CUSTOMERS" | "MOTORCYCLES";

export interface EVSE {
  uid: string;
  evse_id?: string;
  status: ConnectorStatus;
  capabilities?: Capability[];
  connectors: Connector[];
  floor_level?: string;
  coordinates?: GeoLocation;
  physical_reference?: string;
  directions?: DisplayText[];
  parking_restrictions?: ParkingRestriction[];
  images?: Image[];
  last_updated: string;
}

export type ParkingType = "ALONG_MOTORWAY" | "PARKING_GARAGE" | "PARKING_LOT" | "ON_DRIVEWAY" | "ON_STREET" | "UNDERGROUND_GARAGE";

export interface Hours {
  twentyfourseven: boolean;
  regular_hours?: Array<{ weekday: number; period_begin: string; period_end: string }>;
  exceptional_openings?: Array<{ period_begin: string; period_end: string }>;
  exceptional_closings?: Array<{ period_begin: string; period_end: string }>;
}

export interface Location {
  country_code: string;
  party_id: string;
  id: string;
  publish: boolean;
  name?: string;
  address: string;
  city: string;
  postal_code?: string;
  state?: string;
  country: string;
  coordinates: GeoLocation;
  parking_type?: ParkingType;
  evses?: EVSE[];
  operator?: BusinessDetails;
  facilities?: string[];
  time_zone: string;
  opening_times?: Hours;
  charging_when_closed?: boolean;
  energy_mix?: unknown;
  last_updated: string;
}

export type TokenType = "AD_HOC_USER" | "APP_USER" | "OTHER" | "RFID";
export type WhitelistType = "ALWAYS" | "ALLOWED" | "ALLOWED_OFFLINE" | "NEVER";
export type AllowedType = "ALLOWED" | "BLOCKED" | "EXPIRED" | "NO_CREDIT" | "NOT_ALLOWED";

export interface Token {
  country_code: string;
  party_id: string;
  uid: string;
  type: TokenType;
  contract_id: string;
  visual_number?: string;
  issuer: string;
  group_id?: string;
  valid: boolean;
  whitelist: WhitelistType;
  language?: string;
  last_updated: string;
}

export interface AuthorizationInfo {
  allowed: AllowedType;
  token: Token;
  location?: { location_id: string; evse_uids?: string[]; connector_ids?: string[] };
  authorization_reference?: string;
  info?: DisplayText;
}

export interface CdrToken {
  country_code: string;
  party_id: string;
  uid: string;
  type: TokenType;
  contract_id: string;
}

export type AuthMethod = "AUTH_REQUEST" | "COMMAND" | "WHITELIST";
export type SessionStatus = "ACTIVE" | "COMPLETED" | "INVALID" | "PENDING" | "RESERVATION";

export interface ChargingPeriod {
  start_date_time: string;
  dimensions: Array<{ type: string; volume: number }>;
  tariff_id?: string;
}

export interface Session {
  country_code: string;
  party_id: string;
  id: string;
  start_date_time: string;
  end_date_time?: string;
  kwh: number;
  cdr_token: CdrToken;
  auth_method: AuthMethod;
  location_id: string;
  evse_uid: string;
  connector_id: string;
  currency: string;
  charging_periods?: ChargingPeriod[];
  total_cost?: Price;
  status: SessionStatus;
  last_updated: string;
}

export interface CdrLocation {
  id: string;
  name?: string;
  address: string;
  city: string;
  state?: string;
  country: string;
  coordinates: GeoLocation;
  evse_uid: string;
  evse_id?: string;
  connector_id: string;
  connector_standard: ConnectorType;
  connector_format: ConnectorFormat;
  connector_power_type: PowerType;
}

export interface CDR {
  country_code: string;
  party_id: string;
  id: string;
  start_date_time: string;
  end_date_time: string;
  session_id?: string;
  cdr_token: CdrToken;
  auth_method: AuthMethod;
  cdr_location: CdrLocation;
  currency: string;
  charging_periods: ChargingPeriod[];
  total_cost: Price;
  total_energy: number;
  total_time: number;
  total_parking_time?: number;
  remark?: string;
  last_updated: string;
}

export type TariffDimensionType = "ENERGY" | "FLAT" | "PARKING_TIME" | "TIME";
export type TariffType = "AD_HOC_PAYMENT" | "PROFILE_CHEAP" | "PROFILE_FAST" | "PROFILE_GREEN" | "REGULAR";

export interface PriceComponent {
  type: TariffDimensionType;
  price: number;
  vat?: number;
  step_size: number;
}

export interface TariffElement {
  price_components: PriceComponent[];
  restrictions?: Record<string, unknown>;
}

export interface Tariff {
  country_code: string;
  party_id: string;
  id: string;
  currency: string;
  type?: TariffType;
  tariff_alt_text?: DisplayText[];
  elements: TariffElement[];
  last_updated: string;
}

export type CommandResultType =
  | "ACCEPTED" | "CANCELED_RESERVATION" | "EVSE_OCCUPIED" | "EVSE_INOPERATIVE"
  | "FAILED" | "NOT_SUPPORTED" | "REJECTED" | "TIMEOUT" | "UNKNOWN_RESERVATION";

export interface CommandResponse {
  result: CommandResultType;
  timeout: number;
  message?: DisplayText[];
}

export interface StartSession {
  response_url: string;
  token: CdrToken;
  location_id: string;
  evse_uid?: string;
  connector_id?: string;
  authorization_reference?: string;
}

export interface StopSession {
  response_url: string;
  session_id: string;
}

export interface ReserveNow {
  response_url: string;
  token: CdrToken;
  expiry_date: string;
  reservation_id: string;
  location_id: string;
  evse_uid?: string;
}

export interface CancelReservation {
  response_url: string;
  reservation_id: string;
}

export interface UnlockConnector {
  response_url: string;
  location_id: string;
  evse_uid: string;
  connector_id: string;
}
