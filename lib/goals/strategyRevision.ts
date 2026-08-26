/** Returns true when a saved strategy is at least as new as a run revision. */
export function isStrategyRevisionStale(
  existingGeneratedAt: string,
  candidateRevision: string
): boolean {
  return new Date(existingGeneratedAt).getTime() >= new Date(candidateRevision).getTime();
}
