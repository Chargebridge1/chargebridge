import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import {
  recognizeIntent,
  speak,
  stopSpeaking,
  handleIntent,
  executeConfirmedStart,
  executeConfirmedStop,
} from "@/services/voice";
import type {
  VoiceState,
  ActiveSessionSnapshot,
  CurrentStationSnapshot,
  CommandContext,
  PendingConfirmation,
} from "@/services/voice";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoiceContextValue {
  state: VoiceState;
  transcript: string;
  response: string;
  pendingConfirmation: PendingConfirmation | null;
  isSupported: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  cancelVoice: () => void;
  setActiveSession: (data: ActiveSessionSnapshot | null) => void;
  setCurrentStation: (station: CurrentStationSnapshot | null) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const IS_NATIVE = Platform.OS === "ios" || Platform.OS === "android";

// ── Provider ──────────────────────────────────────────────────────────────────

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { getToken } = useAuth();

  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);

  const activeSessionRef = useRef<ActiveSessionSnapshot | null>(null);
  const currentStationRef = useRef<CurrentStationSnapshot | null>(null);
  const pendingConfirmRef = useRef<PendingConfirmation | null>(null);
  const stateRef = useRef<VoiceState>("idle");

  function updateState(s: VoiceState) {
    stateRef.current = s;
    setState(s);
  }

  // ── Navigation helper (wraps expo-router) ───────────────────────────────────
  const navigate = useCallback(
    (path: string, params?: Record<string, string>) => {
      try {
        router.push({ pathname: path as any, params });
      } catch {
        // Ignore nav errors (e.g. same route)
      }
    },
    [router],
  );

  // ── Stop-charging API call ─────────────────────────────────────────────────
  const stopChargingApi = useCallback(
    async (session: ActiveSessionSnapshot) => {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const baseUrl = domain ? `https://${domain}` : "";
      const headers: Record<string, string> = {};
      const token = await getToken().catch(() => null);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else if (session.guestToken) {
        headers["X-Guest-Token"] = session.guestToken;
      }
      const res = await fetch(`${baseUrl}/api/sessions/${session.sessionId}/stop-charging`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: false, message: (body.error as string | undefined) ?? "Stop failed." };
      }
      return { ok: true };
    },
    [getToken],
  );

  // ── Core: process a spoken transcript ─────────────────────────────────────
  const processTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        updateState("idle");
        return;
      }

      updateState("processing");
      const intent = recognizeIntent(text);
      const currentPending = pendingConfirmRef.current;

      // ── Confirmation branch ───────────────────────────────────────────────
      if (currentPending) {
        if (intent.name === "CONFIRM_YES") {
          setPendingConfirmation(null);
          pendingConfirmRef.current = null;
          updateState("speaking");

          let responseText: string;
          if (currentPending.intent === "STOP_CHARGING") {
            const session = currentPending.context.activeSession!;
            responseText = await executeConfirmedStop(
              session,
              stopChargingApi,
              navigate,
            );
          } else {
            responseText = await executeConfirmedStart(
              currentPending.context,
              navigate,
            );
          }
          setResponse(responseText);
          speak(responseText, { onDone: () => updateState("idle") });
          return;
        }

        if (intent.name === "CONFIRM_NO") {
          setPendingConfirmation(null);
          pendingConfirmRef.current = null;
          const msg = "Cancelled.";
          setResponse(msg);
          updateState("speaking");
          speak(msg, { onDone: () => updateState("idle") });
          return;
        }

        // User said something else — treat as cancel
        setPendingConfirmation(null);
        pendingConfirmRef.current = null;
      }

      // ── Standard intent branch ────────────────────────────────────────────
      const context: CommandContext = {
        activeSession: activeSessionRef.current,
        currentStation: currentStationRef.current,
      };

      const result = handleIntent(intent, context, navigate, stopChargingApi);

      if (result.requiresConfirmation) {
        setPendingConfirmation(result.requiresConfirmation);
        pendingConfirmRef.current = result.requiresConfirmation;
        setResponse(result.response);
        updateState("confirming");
        speak(result.response, {
          onDone: () => {
            // Listen again for the confirmation answer
            if (IS_NATIVE && stateRef.current === "confirming") {
              void startListeningNative();
            }
          },
        });
        return;
      }

      // Standard response — speak then execute action
      setResponse(result.response);
      updateState("speaking");
      speak(result.response, {
        onDone: () => {
          updateState("idle");
          if (result.action) {
            void Promise.resolve(result.action());
          }
        },
      });
    },
    [navigate, stopChargingApi],
  );

  // ── Speech recognition events (hooks — always called) ─────────────────────
  useSpeechRecognitionEvent("start", () => {
    updateState("listening");
    setTranscript("");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript ?? "";
    setTranscript(text);
    if (event.isFinal && text) {
      void processTranscript(text);
    }
  });

  useSpeechRecognitionEvent("end", () => {
    if (stateRef.current === "listening") {
      updateState("idle");
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    const code = (event as any).code ?? "";
    if (code === "no-speech") {
      const msg = "I didn't hear anything. Try again.";
      setResponse(msg);
      updateState("speaking");
      speak(msg, { onDone: () => updateState("idle") });
    } else if (code === "not-allowed") {
      updateState("error");
      setResponse("Microphone permission denied.");
    } else {
      updateState("idle");
    }
  });

  // ── Start listening (native) ──────────────────────────────────────────────
  const startListeningNative = useCallback(async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Microphone Access Needed",
          "Allow microphone access in Settings to use ChargeBridge Voice.",
        );
        return;
      }
      stopSpeaking();
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
      });
    } catch {
      updateState("error");
    }
  }, []);

  const startListening = useCallback(async () => {
    if (!IS_NATIVE) {
      Alert.alert("Voice", "Voice commands are only available on iOS and Android.");
      return;
    }
    if (stateRef.current === "listening") {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (stateRef.current === "speaking") {
      stopSpeaking();
    }
    await startListeningNative();
  }, [startListeningNative]);

  const stopListening = useCallback(() => {
    if (IS_NATIVE) {
      ExpoSpeechRecognitionModule.stop();
    }
    if (stateRef.current === "listening") {
      updateState("idle");
    }
  }, []);

  const cancelVoice = useCallback(() => {
    if (IS_NATIVE) {
      ExpoSpeechRecognitionModule.abort();
    }
    stopSpeaking();
    setPendingConfirmation(null);
    pendingConfirmRef.current = null;
    updateState("idle");
    setTranscript("");
    setResponse("");
  }, []);

  // ── Session/station registration ───────────────────────────────────────────
  const setActiveSession = useCallback((data: ActiveSessionSnapshot | null) => {
    activeSessionRef.current = data;
  }, []);

  const setCurrentStation = useCallback((station: CurrentStationSnapshot | null) => {
    currentStationRef.current = station;
  }, []);

  const isSupported = IS_NATIVE;

  return (
    <VoiceContext.Provider
      value={{
        state,
        transcript,
        response,
        pendingConfirmation,
        isSupported,
        startListening,
        stopListening,
        cancelVoice,
        setActiveSession,
        setCurrentStation,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used inside <VoiceProvider>");
  return ctx;
}
