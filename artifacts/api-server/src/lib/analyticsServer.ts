import { PostHog } from "posthog-node";
import { createHash } from "crypto";
import { logger } from "./logger";

const KEY = process.env.POSTHOG_API_KEY;

let _client: PostHog | null = null;

if (KEY) {
  _client = new PostHog(KEY, {
    host: "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
  logger.info("PostHog analytics initialised (server)");
} else {
  logger.warn("POSTHOG_API_KEY not set — analytics no-op");
}

/** SHA-256 hex of any raw identifier. Returns "server" for null/undefined. */
export function hashId(raw: string | number | null | undefined): string {
  if (raw == null) return "server";
  return createHash("sha256").update(String(raw)).digest("hex");
}

/**
 * Fire-and-forget event capture. Never throws, never blocks.
 * No-op when POSTHOG_API_KEY is absent.
 */
export function track(
  event: string,
  distinctId: string | number | null | undefined,
  properties?: Record<string, unknown>,
): void {
  if (!_client) return;
  try {
    _client.capture({
      distinctId: hashId(distinctId),
      event,
      properties,
    });
  } catch {
    // defensive: posthog-node capture is sync-queue, but guard anyway
  }
}

/** Graceful shutdown — flushes queued events before process exit. */
export async function shutdownAnalytics(): Promise<void> {
  if (_client) await _client.shutdown();
}

export { _client as posthogServerClient };
