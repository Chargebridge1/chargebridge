jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
}));

import { recognizeIntent, isConfirmationResponse, isFleetIntent } from "../services/voice/IntentEngine";
import {
  formatKwh,
  formatCostCents,
  formatElapsed,
  formatEta,
  formatChargerType,
} from "../services/voice/ResponseManager";
import { handleIntent } from "../services/voice/VoiceService";
import type { CommandContext } from "../services/voice/types";

// ── Test helpers ──────────────────────────────────────────────────────────────

function intent(transcript: string) {
  return recognizeIntent(transcript);
}

function blankContext(): CommandContext {
  return { activeSession: null, currentStation: null };
}

const noopNavigate = jest.fn();
const noopStop = jest.fn().mockResolvedValue({ ok: true });

// ── Intent recognition ────────────────────────────────────────────────────────

describe("recognizeIntent — discovery", () => {
  test("find charging stations near me → FIND_STATIONS", () => {
    expect(intent("find charging stations near me").name).toBe("FIND_STATIONS");
  });
  test("locate ev charger → FIND_STATIONS", () => {
    expect(intent("locate ev charger").name).toBe("FIND_STATIONS");
  });
  test("show me nearby chargers → FIND_STATIONS", () => {
    expect(intent("show me nearby chargers").name).toBe("FIND_STATIONS");
  });
  test("closest charger → FIND_NEAREST", () => {
    expect(intent("show the closest charger").name).toBe("FIND_NEAREST");
  });
  test("nearest station → FIND_NEAREST", () => {
    expect(intent("nearest charging station").name).toBe("FIND_NEAREST");
  });
  test("find the safest station → FIND_SAFEST", () => {
    expect(intent("find the safest charging station").name).toBe("FIND_SAFEST");
  });
  test("easiest access → FIND_SAFEST", () => {
    expect(intent("find accessible charger").name).toBe("FIND_SAFEST");
  });
  test("cheapest charger → FIND_CHEAPEST", () => {
    expect(intent("find cheapest charger").name).toBe("FIND_CHEAPEST");
  });
  test("free charger → FIND_CHEAPEST", () => {
    expect(intent("find a free charger").name).toBe("FIND_CHEAPEST");
  });
  test("DC fast charger → FILTER_DCFC", () => {
    expect(intent("show only DC fast chargers").name).toBe("FILTER_DCFC");
  });
  test("fast charger variant → FILTER_DCFC", () => {
    expect(intent("find a fast charger").name).toBe("FILTER_DCFC");
  });
  test("DCFC → FILTER_DCFC", () => {
    expect(intent("DCFC only").name).toBe("FILTER_DCFC");
  });
});

describe("recognizeIntent — station info", () => {
  test("tell me about this station → STATION_INFO", () => {
    expect(intent("tell me about this station").name).toBe("STATION_INFO");
  });
  test("station details → STATION_INFO", () => {
    expect(intent("station details").name).toBe("STATION_INFO");
  });
  test("how many ports available → PORT_AVAILABILITY", () => {
    expect(intent("how many chargers are available").name).toBe("PORT_AVAILABILITY");
  });
  test("is this charger open → STATION_STATUS", () => {
    expect(intent("is this charger open").name).toBe("STATION_STATUS");
  });
  test("is it open → STATION_STATUS", () => {
    expect(intent("is it open").name).toBe("STATION_STATUS");
  });
  test("charging speed → CHARGING_SPEED", () => {
    expect(intent("what is the charging speed").name).toBe("CHARGING_SPEED");
  });
  test("how fast → CHARGING_SPEED", () => {
    expect(intent("how fast does it charge").name).toBe("CHARGING_SPEED");
  });
  test("is it public → STATION_ACCESS", () => {
    expect(intent("is this station open to the public").name).toBe("STATION_ACCESS");
  });
  test("paid parking → STATION_ACCESS", () => {
    expect(intent("does this location require paid parking").name).toBe("STATION_ACCESS");
  });
});

describe("recognizeIntent — session control", () => {
  test("start charging → START_CHARGING", () => {
    expect(intent("start charging").name).toBe("START_CHARGING");
  });
  test("begin charging → START_CHARGING", () => {
    expect(intent("begin charging").name).toBe("START_CHARGING");
  });
  test("charge my car → START_CHARGING", () => {
    expect(intent("charge my car").name).toBe("START_CHARGING");
  });
  test("plug in → START_CHARGING", () => {
    expect(intent("plug in").name).toBe("START_CHARGING");
  });
  test("stop charging → STOP_CHARGING", () => {
    expect(intent("stop charging").name).toBe("STOP_CHARGING");
  });
  test("end session → STOP_CHARGING", () => {
    expect(intent("end charging session").name).toBe("STOP_CHARGING");
  });
  test("finish charging → STOP_CHARGING", () => {
    expect(intent("finish charging").name).toBe("STOP_CHARGING");
  });
  test("show charging status → SESSION_STATUS", () => {
    expect(intent("show my charging status").name).toBe("SESSION_STATUS");
  });
  test("how much energy → SESSION_ENERGY", () => {
    expect(intent("how much energy have I used").name).toBe("SESSION_ENERGY");
  });
  test("session cost → SESSION_COST", () => {
    expect(intent("how much has this session cost").name).toBe("SESSION_COST");
  });
  test("total cost → SESSION_COST", () => {
    expect(intent("what's the total cost").name).toBe("SESSION_COST");
  });
  test("time remaining → SESSION_TIME", () => {
    expect(intent("how much time remains").name).toBe("SESSION_TIME");
  });
  test("how much longer → SESSION_TIME", () => {
    expect(intent("how much longer will it take").name).toBe("SESSION_TIME");
  });
  test("when done → SESSION_TIME", () => {
    expect(intent("when will charging be done").name).toBe("SESSION_TIME");
  });
});

describe("recognizeIntent — navigation & account", () => {
  test("navigate to charger → NAVIGATE_TO_CHARGER", () => {
    expect(intent("navigate to this charger").name).toBe("NAVIGATE_TO_CHARGER");
  });
  test("take me to best → NAVIGATE_BEST", () => {
    expect(intent("take me to the best charger").name).toBe("NAVIGATE_BEST");
  });
  test("charging history → CHARGING_HISTORY", () => {
    expect(intent("show my charging history").name).toBe("CHARGING_HISTORY");
  });
  test("receipts → CHARGING_HISTORY", () => {
    expect(intent("show my receipts").name).toBe("CHARGING_HISTORY");
  });
  test("payment method → PAYMENT_METHOD", () => {
    expect(intent("what payment method am I using").name).toBe("PAYMENT_METHOD");
  });
  test("favorite station → FAVORITES", () => {
    expect(intent("update my favorite station").name).toBe("FAVORITES");
  });
});

describe("recognizeIntent — confirmations", () => {
  test("yes → CONFIRM_YES", () => {
    expect(intent("yes").name).toBe("CONFIRM_YES");
  });
  test("yeah → CONFIRM_YES", () => {
    expect(intent("yeah").name).toBe("CONFIRM_YES");
  });
  test("ok → CONFIRM_YES", () => {
    expect(intent("ok").name).toBe("CONFIRM_YES");
  });
  test("go ahead → CONFIRM_YES", () => {
    expect(intent("go ahead").name).toBe("CONFIRM_YES");
  });
  test("no → CONFIRM_NO", () => {
    expect(intent("no").name).toBe("CONFIRM_NO");
  });
  test("cancel → CONFIRM_NO", () => {
    expect(intent("cancel").name).toBe("CONFIRM_NO");
  });
  test("never mind → CONFIRM_NO", () => {
    expect(intent("never mind").name).toBe("CONFIRM_NO");
  });
});

describe("recognizeIntent — fleet stubs", () => {
  test("fleet status → FLEET_STATUS", () => {
    expect(intent("show fleet charging status").name).toBe("FLEET_STATUS");
  });
  test("locate vehicle → FLEET_VEHICLE", () => {
    expect(intent("locate vehicle 12").name).toBe("FLEET_VEHICLE");
  });
  test("fleet costs → FLEET_COSTS", () => {
    expect(intent("show today's fleet charging costs").name).toBe("FLEET_COSTS");
  });
});

describe("recognizeIntent — unknown / fallback", () => {
  test("empty string → UNKNOWN", () => {
    expect(intent("").name).toBe("UNKNOWN");
  });
  test("random speech → UNKNOWN", () => {
    expect(intent("hello how are you").name).toBe("UNKNOWN");
  });
  test("play music → UNKNOWN", () => {
    expect(intent("play my favourite music").name).toBe("UNKNOWN");
  });
});

describe("isConfirmationResponse", () => {
  test("CONFIRM_YES → true", () => {
    expect(isConfirmationResponse(intent("yes"))).toBe(true);
  });
  test("CONFIRM_NO → true", () => {
    expect(isConfirmationResponse(intent("no"))).toBe(true);
  });
  test("other intent → false", () => {
    expect(isConfirmationResponse(intent("start charging"))).toBe(false);
  });
});

describe("isFleetIntent", () => {
  test("FLEET_STATUS → true", () => {
    expect(isFleetIntent(intent("show fleet charging status"))).toBe(true);
  });
  test("FIND_STATIONS → false", () => {
    expect(isFleetIntent(intent("find charging station"))).toBe(false);
  });
});

// ── ResponseManager formatters ────────────────────────────────────────────────

describe("formatKwh", () => {
  test("formats correctly", () => {
    expect(formatKwh(18.3)).toBe("18.3 kilowatt-hours");
  });
  test("rounds to 1 decimal", () => {
    expect(formatKwh(0)).toBe("0.0 kilowatt-hours");
  });
});

describe("formatCostCents", () => {
  test("zero cost → no charge", () => {
    expect(formatCostCents(0)).toBe("no charge");
  });
  test("formats dollars", () => {
    expect(formatCostCents(350)).toBe("$3.50");
  });
});

describe("formatElapsed", () => {
  test("hours and minutes", () => {
    expect(formatElapsed(3720)).toBe("1 hour and 2 minutes");
  });
  test("minutes only", () => {
    expect(formatElapsed(420)).toBe("7 minutes");
  });
  test("less than a minute", () => {
    expect(formatElapsed(30)).toBe("less than a minute");
  });
});

describe("formatEta", () => {
  test("complete", () => {
    expect(formatEta(20, 20, "Level2")).toBe("charging is complete");
  });
  test("DCFC estimate", () => {
    const result = formatEta(50, 25, "DCFC");
    expect(result).toContain("minute");
  });
  test("Level2 estimate", () => {
    const result = formatEta(20, 10, "Level2");
    expect(result).toContain("hour");
  });
});

describe("formatChargerType", () => {
  test("DCFC", () => {
    expect(formatChargerType("DCFC")).toBe("DC Fast Charger");
  });
  test("Level2", () => {
    expect(formatChargerType("Level2")).toBe("Level 2 charger");
  });
  test("Level1", () => {
    expect(formatChargerType("Level1")).toBe("Level 1 charger");
  });
  test("null", () => {
    expect(formatChargerType(null)).toBe("unknown charger type");
  });
});

// ── VoiceService.handleIntent ────────────────────────────────────────────────

describe("handleIntent — no session, no station", () => {
  const ctx = blankContext();

  test("FIND_STATIONS → navigates", () => {
    const result = handleIntent(intent("find a charger"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/station|charger/i);
    expect(typeof result.action).toBe("function");
  });

  test("SESSION_STATUS with no session → polite response", () => {
    const result = handleIntent(intent("show my charging status"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/no active session/i);
  });

  test("STOP_CHARGING with no session → polite response", () => {
    const result = handleIntent(intent("stop charging"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/no active/i);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("STATION_INFO with no station → polite response", () => {
    const result = handleIntent(intent("tell me about this station"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/no station|don't have/i);
  });

  test("UNKNOWN → fallback message", () => {
    const result = handleIntent(intent(""), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/didn't understand/i);
  });

  test("FLEET_STATUS → coming soon stub", () => {
    const result = handleIntent(intent("show fleet charging status"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/coming soon/i);
  });
});

describe("handleIntent — with active session", () => {
  const ctx: CommandContext = {
    activeSession: {
      sessionId: "sess-1",
      stationId: "stn-1",
      stationName: "Walmart Charger",
      displayKwh: 12.5,
      totalCostCents: 475,
      elapsedSeconds: 6300,
      targetKwh: 40,
      chargerType: "Level2",
    },
    currentStation: null,
  };

  test("SESSION_STATUS → reports name and energy", () => {
    const result = handleIntent(intent("show my charging status"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("Walmart Charger");
    expect(result.response).toContain("12.5");
  });

  test("SESSION_ENERGY → reports kwh", () => {
    const result = handleIntent(intent("how much energy have I used"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("12.5 kilowatt-hours");
  });

  test("SESSION_COST → reports cost", () => {
    const result = handleIntent(intent("how much has this cost"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("$4.75");
  });

  test("SESSION_TIME → returns eta string", () => {
    const result = handleIntent(intent("how much time remains"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/hour|minute|complete/i);
  });

  test("STOP_CHARGING → requires confirmation", () => {
    const result = handleIntent(intent("stop charging"), ctx, noopNavigate, noopStop);
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.requiresConfirmation!.intent).toBe("STOP_CHARGING");
    expect(result.response).toMatch(/yes.*confirm|confirm.*yes/i);
  });

  test("START_CHARGING when already charging → polite refusal", () => {
    const result = handleIntent(intent("start charging"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/already.*active/i);
    expect(result.requiresConfirmation).toBeUndefined();
  });
});

describe("handleIntent — with current station", () => {
  const ctx: CommandContext = {
    activeSession: null,
    currentStation: {
      id: "stn-2",
      name: "Target EV Station",
      chargerType: "DCFC",
      powerKw: 150,
      availablePorts: 2,
      totalPorts: 4,
      status: "available",
      isFree: false,
      pricePerKwh: 0.28,
      accessType: "public",
      accessibilityLevel: "EASY",
    },
  };

  test("STATION_INFO → includes name and type", () => {
    const result = handleIntent(intent("tell me about this station"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("Target EV Station");
    expect(result.response).toContain("DC Fast Charger");
  });

  test("PORT_AVAILABILITY → reports ports", () => {
    const result = handleIntent(intent("how many chargers are available"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("2 of 4");
  });

  test("STATION_STATUS → available", () => {
    const result = handleIntent(intent("is this charger open"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("available");
  });

  test("CHARGING_SPEED → DCFC at 150 kW", () => {
    const result = handleIntent(intent("what is the charging speed"), ctx, noopNavigate, noopStop);
    expect(result.response).toContain("DC Fast Charger");
    expect(result.response).toContain("150");
  });

  test("STATION_ACCESS (EASY) → open to public", () => {
    const result = handleIntent(intent("is this station open to the public"), ctx, noopNavigate, noopStop);
    expect(result.response).toMatch(/open to the public|easy access/i);
  });

  test("START_CHARGING → requires confirmation", () => {
    const result = handleIntent(intent("start charging"), ctx, noopNavigate, noopStop);
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.requiresConfirmation!.intent).toBe("START_CHARGING");
    expect(result.response).toMatch(/yes.*confirm|confirm.*yes/i);
  });
});
