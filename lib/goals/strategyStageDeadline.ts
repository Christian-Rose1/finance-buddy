/**
 * One customer-visible flight or hotel stage may run for at most two minutes.
 * This is deliberately longer than the provider's individual 15-second HTTP
 * bound so it covers the complete plan, query batch, interpretation, and
 * validated-payload preparation while still guaranteeing terminal progress.
 */
export const STRATEGY_RESEARCH_STAGE_DEADLINE_MS = 120_000;

/** Failure cleanup gets a separate small budget so timeout handling terminates. */
export const STRATEGY_RESEARCH_STAGE_CLEANUP_DEADLINE_MS = 5_000;

export class StrategyResearchStageDeadlineError extends Error {
  constructor() {
    super("Strategy research stage deadline reached.");
    this.name = "StrategyResearchStageDeadlineError";
  }
}

export async function runWithStrategyResearchStageDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs = STRATEGY_RESEARCH_STAGE_DEADLINE_MS,
): Promise<T> {
  return runWithAbortDeadline(operation, deadlineMs);
}

export async function runWithStrategyResearchStageCleanupDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs = STRATEGY_RESEARCH_STAGE_CLEANUP_DEADLINE_MS,
): Promise<T> {
  return runWithAbortDeadline(operation, deadlineMs);
}

async function runWithAbortDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => operation(controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new StrategyResearchStageDeadlineError());
      controller.abort();
    }, deadlineMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    // Observe a cancellation-resistant dependency's eventual rejection.
    void work.catch(() => undefined);
  }
}
