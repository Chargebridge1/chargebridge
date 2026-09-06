# ChargeBridge Voice™

Hands-free voice control for the ChargeBridge mobile app. Users can navigate, query stations, manage charging sessions, and access their account — all without touching the screen.

---

## Design Philosophy

ChargeBridge Voice is **not a chatbot**. It is a direct extension of the app's existing actions, activated by pressing a microphone button. Responses are short and actionable. The voice assistant never records audio in the background, never stores audio, and never sends audio to a server.

---

## Activation

1. The mic button (floating action button, bottom-right of every screen) is visible whenever the app is open.
2. Press the button to start listening — the button turns red and a waveform indicator appears.
3. Speak your command naturally.
4. The assistant responds by voice and — for navigation commands — moves to the right screen automatically.
5. For sensitive actions (Start Charging, Stop Charging), the assistant asks for verbal confirmation before proceeding.

---

## Supported Commands

### Finding Stations

| What you say | What happens |
|---|---|
| "Find charging stations near me" | Opens the Stations tab |
| "Show the closest charger" | Opens Stations sorted by distance |
| "Find the safest charging station" | Opens Stations with smart ranking |
| "Find the cheapest charger" | Filters for free/low-cost stations |
| "Show only DC Fast Chargers" | Filters to DCFC only |

### Station Info (when a station is open)

| What you say | What happens |
|---|---|
| "Tell me about this station" | Reads name, type, and price |
| "How many chargers are available?" | Reports port availability |
| "Is this charger open?" | Reports station status |
| "What is the charging speed?" | Reports charger type and kW |
| "Is this station open to the public?" | Reports access level |

### Charging Session

| What you say | What happens |
|---|---|
| "Start charging" | Confirms → opens station screen to tap Charge Now |
| "Stop charging" | Confirms → sends remote stop command |
| "Show my charging status" | Speaks session summary + navigates to active session |
| "How much energy have I used?" | Reports kWh delivered |
| "How much has this cost?" | Reports session cost |
| "How much time remains?" | Reports estimated time remaining |

**Note:** Start Charging requires opening the Stripe payment sheet, which must be initiated from the screen. The voice command navigates to the correct station and prompts the user to tap Charge Now.

### Navigation

| What you say | What happens |
|---|---|
| "Navigate to this charger" | Opens directions to the current station |
| "Take me to the best charger" | Opens the Map tab |

### Account

| What you say | What happens |
|---|---|
| "Show my charging history" | Opens charging history |
| "What payment method am I using?" | Opens profile |
| "Show my favorite stations" | Opens favorites |

### Confirmation Responses

When the assistant asks for confirmation, say:

- **Yes:** "yes", "yeah", "ok", "confirm", "go ahead", "absolutely"
- **No:** "no", "cancel", "never mind", "don't"

---

## Confirmation Flow

Actions that affect your account or charger hardware require a verbal confirmation:

```
User: "Stop charging."
ChargeBridge: "Stop charging at Walmart Charger? Say yes to confirm, or no to cancel."
User: "Yes."
ChargeBridge: "Charging stopped. Navigating to your session summary."
```

If the user says something other than yes or no, the confirmation is cancelled.

---

## Privacy and Safety

| Guarantee | Details |
|---|---|
| **Button-only activation** | Microphone is only active when you press the button. No background or passive listening. |
| **No persistent recordings** | Audio is processed by the iOS/Android on-device speech recognizer and discarded immediately. |
| **No audio transmission** | Audio is processed on-device by native iOS/Android APIs (SFSpeechRecognizer / SpeechRecognizer). Nothing is sent to ChargeBridge servers. |
| **No wake words** | "Hey ChargeBridge" is not implemented. The app never listens passively. |
| **Foreground only** | Voice is disabled when the app is backgrounded. |

---

## Technical Architecture

### File Structure

```
services/voice/
├── types.ts              — Shared types: VoiceIntent, VoiceState, CommandContext, snapshots
├── IntentEngine.ts       — Pure regex-based intent recognition (no network, no AI)
├── ResponseManager.ts    — expo-speech TTS wrapper + response formatters
├── VoiceService.ts       — Intent → action mapping (pure function)
└── index.ts              — Public barrel exports

contexts/
└── VoiceContext.tsx      — React context: orchestrates STT, confirmation flow, API calls

components/voice/
├── VoiceButton.tsx       — Floating action button (FAB) with pulse animation
└── VoiceOverlay.tsx      — Bottom sheet: transcript, response, confirmation hints, waveform
```

### Data Flow

```
User presses mic button
        │
VoiceContext.startListening()
        │
ExpoSpeechRecognitionModule.start()   ← native iOS SFSpeechRecognizer
        │
useSpeechRecognitionEvent("result")   ← fires when user stops speaking
        │
IntentEngine.recognizeIntent(text)    ← regex pattern matching → VoiceIntent
        │
   ┌────┴──────────────────┐
   │ Confirmation needed?  │
   └────┬──────────────────┘
        │ Yes                     │ No
        │                         │
   speak() + listen again   handleIntent() → VoiceCommandResult
        │                         │
   CONFIRM_YES / CONFIRM_NO  speak(response)
        │                         │
   execute action            execute action()
        │                         │
   speak(result)           navigate / API call
```

### Intent Engine

The intent engine is a pure function with no external dependencies:

```typescript
import { recognizeIntent } from "@/services/voice";
const intent = recognizeIntent("start charging");
// → { name: "START_CHARGING", confidence: 1, rawTranscript: "start charging" }
```

Patterns are matched in priority order. Confirmation responses (`CONFIRM_YES`, `CONFIRM_NO`) are matched before all others so they take effect correctly during multi-turn flows.

### Swapping to AI

The intent engine is designed to be replaced by an AI model without changing the rest of the system. The interface contract is:

```typescript
type IntentRecognizer = (transcript: string) => VoiceIntent;
```

Replace `recognizeIntent` in `VoiceContext.tsx` with a function that calls an LLM, and the confirmation flow, action handler, and UI all continue to work without modification.

### Session and Station Context

Screens register their context with the voice system by calling `useVoice()`:

```typescript
// In active-session.tsx
const { setActiveSession } = useVoice();
useEffect(() => {
  setActiveSession({
    sessionId, stationId, stationName,
    displayKwh, totalCostCents, elapsedSeconds, targetKwh, chargerType,
  });
  return () => setActiveSession(null);
}, [sessionId, displayKwh, ...]);

// In station/[id].tsx
const { setCurrentStation } = useVoice();
useEffect(() => {
  setCurrentStation({ id, name, chargerType, powerKw, ... });
  return () => setCurrentStation(null);
}, [id]);
```

This allows the voice assistant to answer questions like "how much energy have I used?" without navigating away from the current screen.

---

## Fleet Readiness

Fleet commands (`FLEET_STATUS`, `FLEET_VEHICLE`, `FLEET_COSTS`) are recognized by the intent engine but return a "coming soon" stub. To implement fleet support:

1. Add fleet data to `CommandContext` in `types.ts` (e.g. `fleetVehicles`, `fleetSessionSummary`).
2. Add fleet response cases to `VoiceService.ts`.
3. Register fleet data in the fleet management screen via `useVoice()`.

No changes to the intent engine, confirmation flow, or UI components are required.

---

## Build Requirements

ChargeBridge Voice requires a native rebuild (EAS build) to activate:

- **iOS**: Adds `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` to `Info.plist`, and installs the `expo-speech-recognition` native module.
- **Android**: Adds `RECORD_AUDIO` permission.

The voice button is hidden on web (`Platform.OS === "web"`) so the web build is unaffected.

The next EAS build will include voice. Increment `ios.buildNumber` in `app.json` before triggering.

---

## Running Tests

```bash
pnpm --filter @workspace/chargebridge-mobile test --testPathPattern=voiceIntent
```

Tests cover:
- Intent recognition for all command categories (60+ patterns)
- Multiple phrasings resolving to the same intent
- Confirmation flow (yes/no detection)
- Fleet stubs
- Unknown/empty transcript fallback
- ResponseManager formatters (kWh, cost, elapsed time, ETA, charger type)
- VoiceService command handler with/without active session and station context
