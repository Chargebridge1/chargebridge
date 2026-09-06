import * as Speech from "expo-speech";

export interface SpeakOptions {
  onDone?: () => void;
}

export function speak(text: string, options?: SpeakOptions): void {
  Speech.stop();
  Speech.speak(text, {
    language: "en-US",
    rate: 1.05,
    pitch: 1.0,
    onDone: options?.onDone,
    onError: options?.onDone,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}

export function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

export function formatKwh(kwh: number): string {
  return `${kwh.toFixed(1)} kilowatt-hours`;
}

export function formatCostCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return "no charge";
  return `$${dollars.toFixed(2)}`;
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hour${h !== 1 ? "s" : ""} and ${m} minute${m !== 1 ? "s" : ""}`;
  if (m > 0) return `${m} minute${m !== 1 ? "s" : ""}`;
  return "less than a minute";
}

export function formatEta(
  targetKwh: number,
  deliveredKwh: number,
  chargerType?: string,
): string {
  if (deliveredKwh >= targetKwh && targetKwh > 0) return "charging is complete";
  const rateKw = chargerType === "DCFC" ? 50 : chargerType === "Level2" ? 7.2 : 1.4;
  const remaining = Math.max(0, targetKwh - deliveredKwh);
  const remainingSecs = Math.round((remaining / rateKw) * 3600);
  const h = Math.floor(remainingSecs / 3600);
  const m = Math.floor((remainingSecs % 3600) / 60);
  if (h > 0) return `about ${h} hour${h !== 1 ? "s" : ""} and ${m} minute${m !== 1 ? "s" : ""}`;
  if (m > 0) return `about ${m} minute${m !== 1 ? "s" : ""}`;
  return "less than a minute";
}

export function formatChargerType(type?: string | null): string {
  if (!type) return "unknown charger type";
  if (type === "DCFC") return "DC Fast Charger";
  if (type === "Level2") return "Level 2 charger";
  if (type === "Level1") return "Level 1 charger";
  return type;
}
