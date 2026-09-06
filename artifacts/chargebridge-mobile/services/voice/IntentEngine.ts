import type { VoiceIntent, VoiceIntentName } from "./types";

type PatternMap = Partial<Record<VoiceIntentName, RegExp[]>>;

const PATTERNS: PatternMap = {
  CONFIRM_YES: [
    /^(yes|yeah|yep|yup|ok|okay|sure|confirm|proceed|go ahead|do it|start|stop|absolutely|correct|affirmative)$/i,
    /^(yes please|go for it|that's right|sounds good|let's go)$/i,
  ],
  CONFIRM_NO: [
    /^(no|nope|nah|cancel|stop|abort|never mind|nevermind|don't|do not|negative)$/i,
    /^(no thanks|forget it|skip it)$/i,
  ],

  FIND_NEAREST: [
    /\b(closest|nearest)\b.*\b(charger|station|plug)\b/i,
    /\b(charger|station)\b.*\b(closest|nearest)\b/i,
    /\bclosest\b/i,
  ],
  FIND_SAFEST: [
    /\b(safest|safe|accessible|easy access)\b.*\b(charger|station)\b/i,
    /\b(charger|station)\b.*\b(safest|safe|accessible)\b/i,
    /\bfind.*safest\b/i,
  ],
  FIND_CHEAPEST: [
    /\b(cheapest|cheapest|free|lowest cost|lowest price|cheapest charger)\b/i,
    /\b(charger|station)\b.*\b(cheap|free|low cost)\b/i,
    /\bfind.*cheap\b/i,
  ],
  FILTER_DCFC: [
    /\bdc\s*fast\s*charger/i,
    /\bfast\s*charger/i,
    /\bdc\s*fast\b/i,
    /\bdcfc\b/i,
    /show.*only.*fast/i,
    /level\s*3/i,
  ],
  FIND_STATIONS: [
    /\b(find|show|locate|search|where).*(charging|chargers?|stations?|ev\b|electric)\b/i,
    /\b(ev|electric|charging)\s*(stations?|chargers?)\b/i,
    /\bcharge.*near\b/i,
    /\bstation.*near\b/i,
    /\bnearby\s*(chargers?|stations?)\b/i,
  ],

  STATION_INFO: [
    /\btell me about\b/i,
    /\binfo(rmation)? about this\b/i,
    /\bwhat('s| is) (this|the) station\b/i,
    /\bstation details\b/i,
    /\babout this charger\b/i,
  ],
  PORT_AVAILABILITY: [
    /\bhow many\b.*\b(ports?|chargers?|connectors?|plugs?)\b/i,
    /\b(ports?|chargers?|connectors?)\b.*\bavailable\b/i,
    /\bavailable\s*(ports?|chargers?|connectors?)\b/i,
    /\bports? available\b/i,
  ],
  STATION_STATUS: [
    /\b(is|are)\s*(this|the)\s*(charger|station)\s*(open|available|working|operational)\b(?!\s*to\s*(the\s*)?public)/i,
    /\bcharger (open|working|operational)\b/i,
    /\bstation (working|operational)\b/i,
    /\bis it (open|working|operational)\b/i,
  ],
  CHARGING_SPEED: [
    /\b(charging|charge)\s*speed\b/i,
    /\bhow fast\b/i,
    /\bpower output\b/i,
    /\bkilowatt\b/i,
    /\bkw\b/i,
    /\bcharge\s*rate\b/i,
    /\bwhat.*speed\b/i,
  ],
  STATION_ACCESS: [
    /\bopen to (the )?public\b/i,
    /\bpublic\s*(charger|station|access)\b/i,
    /\bpaid parking\b/i,
    /\b(require|need)\s*(a\s*)?(parking|membership|key|paid)\b/i,
    /\b(restricted|public)\s*access\b/i,
    /\bfree to (park|use|enter)\b/i,
    /\b(is|it).*(public|accessible|open to)\b/i,
  ],

  START_CHARGING: [
    /\bstart\s*(charging|charge)\b/i,
    /\bbegin\s*(charging|charge)\b/i,
    /\bcharge\s*(my\s*)?(car|vehicle|ev)\b/i,
    /\bplug\s*in\b/i,
    /\binitiate\s*(charging|charge)\b/i,
    /\bstart\s*session\b/i,
  ],
  STOP_CHARGING: [
    /\bstop\s*(charging|charge|session)\b/i,
    /\bend\s*(charging|charge|session)\b/i,
    /\bstop\s*the\s*(charger|session)\b/i,
    /\bunplug\b/i,
    /\bfinish\s*charging\b/i,
    /\bcancel\s*(charging|charge|session)\b/i,
  ],

  SESSION_STATUS: [
    /\b(show|what('s| is)?)\b.*\b(charging\s*)?status\b/i,
    /\bcharging status\b/i,
    /\bhow('s| is)\b.*\b(charge|charging|session)\b/i,
    /\bactive session\b/i,
    /\bmy session\b/i,
  ],
  SESSION_ENERGY: [
    /\bhow much\b.*\b(energy|kwh|kilowatt|power|electricity)\b/i,
    /\b(energy|kwh|kilowatt)\b.*\bused\b/i,
    /\bhow much.*charged\b/i,
    /\bkilowatt.?hours?\b/i,
  ],
  SESSION_COST: [
    /\bhow much\b.*\b(cost|charge|paid|pay|dollar|cent|money)\b/i,
    /\b(cost|charge|price)\b.*\bsession\b/i,
    /\bwhat('s| is)\b.*\bcost\b/i,
    /\bhow much.*so far\b/i,
    /\btotal cost\b/i,
  ],
  SESSION_TIME: [
    /\bhow (long|much time)\b/i,
    /\btime remaining\b/i,
    /\bhow much longer\b/i,
    /\bwhen.*done\b/i,
    /\bwhen.*finish\b/i,
    /\btime left\b/i,
    /\bestimated time\b/i,
    /\beta\b/i,
  ],

  NAVIGATE_TO_CHARGER: [
    /\bnavigate\b.*\b(to|this|the)\b.*\b(charger|station)\b/i,
    /\bdirection(s)?\b.*\b(charger|station)\b/i,
    /\btake me to\b.*\b(charger|station|this)\b/i,
    /\bgo to\b.*\b(charger|station)\b/i,
    /\bget directions?\b/i,
  ],
  NAVIGATE_BEST: [
    /\btake me to (the )?best\b/i,
    /\bnavigate.*best\b/i,
    /\bgo to (the )?best charger\b/i,
    /\bbest charger near/i,
  ],

  CHARGING_HISTORY: [
    /\bcharging history\b/i,
    /\bmy history\b/i,
    /\bpast (charges?|sessions?)\b/i,
    /\breceipts?\b/i,
    /\bprevious sessions?\b/i,
    /\bshow.*history\b/i,
  ],
  PAYMENT_METHOD: [
    /\bpayment method\b/i,
    /\bmy (card|payment|credit card)\b/i,
    /\bwhat.*paying with\b/i,
    /\bpay(ment)?\s*(info|information|method|card)\b/i,
  ],
  FAVORITES: [
    /\bfavorite\s*(station|charger)?\b/i,
    /\bsaved\s*(station|charger)?\b/i,
    /\bupdate.*favorite\b/i,
    /\bmy favorites?\b/i,
  ],

  FLEET_STATUS: [
    /\bfleet\s*(charging\s*)?(status|overview)\b/i,
    /\bshow fleet\b/i,
    /\bfleet charger(s)?\b/i,
  ],
  FLEET_VEHICLE: [
    /\bvehicle\s*\d+\b/i,
    /\blocate\s*vehicle\b/i,
    /\bfind\s*vehicle\b/i,
    /\bfleet\s*vehicle\b/i,
  ],
  FLEET_COSTS: [
    /\bfleet\s*(charging\s*)?(cost|costs?)\b/i,
    /\btoday'?s?\s*fleet\s*(charging\s*)?(cost|costs?)\b/i,
    /\bfleet\s*spending\b/i,
  ],
};

const INTENT_PRIORITY: VoiceIntentName[] = [
  // Confirmations always first (multi-turn)
  "CONFIRM_YES",
  "CONFIRM_NO",
  // Charging session control (specific actions with confirmation)
  "STOP_CHARGING",
  "START_CHARGING",
  // Fleet stubs — before session/discovery so "show fleet charging status"
  // doesn't get stolen by the broader SESSION_STATUS or FIND_STATIONS patterns
  "FLEET_STATUS",
  "FLEET_VEHICLE",
  "FLEET_COSTS",
  // Session queries — before FIND_STATIONS so "show charging status" doesn't
  // match the more general "show … charging …" discovery pattern
  "SESSION_STATUS",
  "SESSION_ENERGY",
  "SESSION_COST",
  "SESSION_TIME",
  // Account — before FIND_STATIONS so "show charging history" doesn't collide
  "CHARGING_HISTORY",
  "PAYMENT_METHOD",
  "FAVORITES",
  // Station-specific queries (narrow, station must already be open)
  "PORT_AVAILABILITY",
  "CHARGING_SPEED",
  "STATION_ACCESS",   // before STATION_STATUS — tighter patterns that include "public"
  "STATION_STATUS",
  "STATION_INFO",
  // Navigation — NAVIGATE_BEST before NAVIGATE_TO_CHARGER so "take me to the
  // best charger" matches the specific "best" pattern, not the broader "take me to"
  "NAVIGATE_BEST",
  "NAVIGATE_TO_CHARGER",
  // Discovery — general, broadest patterns last so they don't shadow the above
  "FIND_NEAREST",
  "FIND_SAFEST",
  "FIND_CHEAPEST",
  "FILTER_DCFC",
  "FIND_STATIONS",
];

export function recognizeIntent(transcript: string): VoiceIntent {
  const normalized = transcript.trim();
  if (!normalized) {
    return { name: "UNKNOWN", confidence: 0, rawTranscript: transcript };
  }

  for (const intentName of INTENT_PRIORITY) {
    const patterns = PATTERNS[intentName];
    if (!patterns) continue;
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return { name: intentName, confidence: 1, rawTranscript: transcript };
      }
    }
  }

  return { name: "UNKNOWN", confidence: 0, rawTranscript: transcript };
}

export function isConfirmationResponse(intent: VoiceIntent): boolean {
  return intent.name === "CONFIRM_YES" || intent.name === "CONFIRM_NO";
}

export function isFleetIntent(intent: VoiceIntent): boolean {
  return (
    intent.name === "FLEET_STATUS" ||
    intent.name === "FLEET_VEHICLE" ||
    intent.name === "FLEET_COSTS"
  );
}
