/** One shared bound for every operation after a finalization attempt starts. */
export const STRATEGY_FINALIZATION_DEADLINE_MS = 245_000;
export const STRATEGY_FINALIZATION_CLEANUP_DEADLINE_MS = 5_000;

export class StrategyFinalizationDeadlineError extends Error {
  constructor() {
    super("Strategy finalization deadline reached.");
    this.name = "StrategyFinalizationDeadlineError";
  }
}

async function runWithAbortDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => operation(controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StrategyFinalizationDeadlineError());
    }, deadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void work.catch(() => undefined);
  }
}

export function runWithStrategyFinalizationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs = STRATEGY_FINALIZATION_DEADLINE_MS,
): Promise<T> {
  return runWithAbortDeadline(operation, deadlineMs);
}

export function runWithStrategyFinalizationCleanupDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineMs = STRATEGY_FINALIZATION_CLEANUP_DEADLINE_MS,
): Promise<T> {
  return runWithAbortDeadline(operation, deadlineMs);
}
