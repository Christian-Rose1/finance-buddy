import "server-only";

import { createClient } from "@supabase/supabase-js";

export type StrategyStageFenceRpcName =
  | "prepare_goal_strategy_run_research_stage_start"
  | "start_goal_strategy_run_research_stage"
  | "save_goal_strategy_run_research_stage"
  | "recover_goal_strategy_run_research_stage_start"
  | "fail_goal_strategy_run_research_stage"
  | "prepare_goal_strategy_run_finalization_start"
  | "start_goal_strategy_run_finalization"
  | "commit_goal_strategy_run_finalization"
  | "fail_goal_strategy_run_finalization"
  | "recover_goal_strategy_run_finalization_start"
  | "delete_owned_goal_strategy";

export interface StrategyStageFenceRpcExecutor {
  execute(
    name: StrategyStageFenceRpcName,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ data: unknown; error: unknown }>;
}

const ALLOWED_STAGE_FENCE_RPCS = new Set<StrategyStageFenceRpcName>([
  "prepare_goal_strategy_run_research_stage_start",
  "start_goal_strategy_run_research_stage",
  "save_goal_strategy_run_research_stage",
  "recover_goal_strategy_run_research_stage_start",
  "fail_goal_strategy_run_research_stage",
  "prepare_goal_strategy_run_finalization_start",
  "start_goal_strategy_run_finalization",
  "commit_goal_strategy_run_finalization",
  "fail_goal_strategy_run_finalization",
  "recover_goal_strategy_run_finalization_start",
  "delete_owned_goal_strategy",
]);

/**
 * Creates the privileged client used only for the allowlisted strategy-stage
 * finalization-fence, and strategy-deletion RPCs. Authentication and ordinary table access remain
 * on the existing cookie-aware client.
 */
export async function createStrategyStageFenceRpcExecutor(): Promise<StrategyStageFenceRpcExecutor> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Strategy stage persistence is unavailable.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return Object.freeze({
    async execute(
      name: StrategyStageFenceRpcName,
      parameters: Record<string, unknown>,
      signal?: AbortSignal,
    ) {
      if (!ALLOWED_STAGE_FENCE_RPCS.has(name)) {
        throw new Error("Strategy stage persistence is unavailable.");
      }
      const rpc = client.rpc(name, parameters);
      const query = signal && typeof (rpc as { abortSignal?: unknown }).abortSignal === "function"
        ? (rpc as unknown as { abortSignal(signal: AbortSignal): Promise<{ data: unknown; error: unknown }> }).abortSignal(signal)
        : rpc;
      const { data, error } = await query;
      return { data, error };
    },
  });
}
