/** The legacy schema ensure operations are retained for non-staging startup only. */
export async function runLegacyStartupDdlUnlessStaging(
  environment: string | undefined,
  operations: Array<() => Promise<unknown>>,
): Promise<void> {
  if (environment === "staging") return;
  for (const operation of operations) await operation();
}