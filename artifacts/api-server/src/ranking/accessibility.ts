import type { AccessibilityLevel } from "./types.js";

const NREL_EASY = new Set([
  "SHOPPING_CTR", "GROCERY", "GAS_STATION", "CONV_STORE", "CAR_DEALER",
  "RESTAURANT", "RETAIL", "HYWAY_RETAIL", "PARK_AND_RIDE", "MUNI_GOV",
  "AIRPORT", "PARKING_PUBLIC", "SUPERMARKET", "CONVENIENCE_STORE",
]);

const NREL_RESTRICTED = new Set([
  "UNIVERSITY", "COLLEGE", "HOSPITAL", "MILITARY_BASE", "FED_GOV",
  "STATE_GOV", "PRISON", "FACTORY", "WORKPLACE",
]);

const NREL_MODERATE = new Set([
  "HOTEL_AND_LODGING", "OFFICE_BLDG", "PARKING_GARAGE", "MIXED_USE",
  "PLACE_OF_WORSHIP", "HEALTH_CARE", "BANK", "COUNTRY_CLUB", "REC_SPORTS",
]);

const RESTRICTED_PATTERNS = [
  /\buniversity\b|\bcollege\b|\bcampus\b|\bpolytechnic\b/i,
  /\bhospital\b|\bmedical\s+center\b|\bhealth\s+system\b/i,
  /\bmilitary\b|\bnaval\b|\bair\s+force\b|\bfort\s/i,
  /\bfederal\b|\bgovernment\s+building\b|\bcourthouse\b/i,
  /\bemployee\b|\bstaff\s+only\b|\bresident[s]?\s+only\b|\bpermit\b/i,
];

const MODERATE_PATTERNS = [
  /\bhotel\b|\binn\b|\bsuites?\b|\bmotel\b|\blodge\b|\bmarriott\b|\bhilton\b|\bhyatt\b|\bsheraton\b|\bwyndham\b|\bcourtyard\b|\bholiday\s+inn\b/i,
  /\bparking\s+garage\b|\bparking\s+structure\b|\bpark\s*&\s*ride\b/i,
  /\boffice\s+park\b|\bcorporate\s+park\b|\bbusiness\s+park\b/i,
];

const EASY_PATTERNS = [
  /\bwalmart\b|\btarget\b|\bcostco\b|\bkroger\b|\bsafeway\b|\bpublix\b|\bwhole\s*foods\b|\btrader\s*joe\b|\baldi\b|\bheb\b|\bmeijer\b|\bwegmans\b/i,
  /\bshopping\s+center\b|\bshopping\s+mall\b|\bplaza\b|\bmall\b|\bretail\s+center\b|\bstrip\s+mall\b/i,
  /\bgas\s+station\b|\bpilot\b|\blove['\u2019]?s\b|\bflying\s+j\b|\bkwik\s*trip\b|\bcasey\b|\bwawa\b|\bsheetz\b|\bta\s+travel\b/i,
  /\bcircle\s*k\b|\b7[- ]?eleven\b|\bcvs\b|\bwalgreens\b|\bride\s+aid\b/i,
  /\bsupercharger\b|\belectrify\s+america\b|\bevgo\b|\bchargepoint\b|\bea\s+charging\b/i,
  /\bgrocery\b|\bsupermarket\b|\bfood\s+store\b/i,
  /\bdepartment\s+store\b|\bhome\s+depot\b|\blowe['\u2019]?s\b|\bbest\s+buy\b|\bkohl\b|\bsears\b/i,
];

export function classifyFacilityType(
  facilityType: string | null,
  accessType: "public" | "restricted" | "unknown",
  name: string,
  source: "community" | "nrel" | "osm" | "ocm"
): AccessibilityLevel {
  if (accessType === "restricted") return "RESTRICTED";

  if (facilityType) {
    const ft = facilityType.toUpperCase().trim();
    if (NREL_EASY.has(ft)) return "EASY";
    if (NREL_RESTRICTED.has(ft)) return "RESTRICTED";
    if (NREL_MODERATE.has(ft)) return "MODERATE";
  }

  if (source === "community") return "EASY";

  for (const pat of RESTRICTED_PATTERNS) {
    if (pat.test(name)) return "RESTRICTED";
  }
  for (const pat of MODERATE_PATTERNS) {
    if (pat.test(name)) return "MODERATE";
  }
  for (const pat of EASY_PATTERNS) {
    if (pat.test(name)) return "EASY";
  }

  return "UNKNOWN";
}

export function nrelAccessType(
  accessCode: string | null,
  accessDetailCode: string | null
): "public" | "restricted" | "unknown" {
  if (!accessCode) return "unknown";
  if (accessCode === "private") return "restricted";
  const detail = (accessDetailCode ?? "").toUpperCase();
  if (detail.includes("KEY") || detail.includes("MEMBERSHIP") || detail.includes("RESTRICTED")) {
    return "restricted";
  }
  if (accessCode === "public") return "public";
  return "unknown";
}

export function osmAccessType(tags: Record<string, string>): "public" | "restricted" | "unknown" {
  const access = tags["access"] ?? tags["fee"] ?? "";
  if (access === "yes" || access === "public") return "public";
  if (access === "private" || access === "no" || access === "permit") return "restricted";
  return "unknown";
}
