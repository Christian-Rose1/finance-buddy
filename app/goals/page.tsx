import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { createServerClient } from "@/lib/supabase-server";
import { getGoalsForUser } from "@/lib/goals/repository";
import {
  getLatestStrategiesForGoals,
  type SavedGoalStrategy,
} from "@/lib/goals/strategyRepository";
import { GoalForm } from "@/components/goal-form";
import { GoalStrategyPanel } from "@/components/goal-strategy-panel";
import { Target } from "lucide-react";
import { buildCustomerSafeGoalSummary } from "@/lib/goals/customerSafeGoalSummary";

async function loadGoalsData() {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/login");
  }

  try {
    const goals = await getGoalsForUser(userData.user.id);

    let savedStrategies: Record<string, SavedGoalStrategy> = {};
    let strategyWarning: string | null = null;
    try {
      savedStrategies = await getLatestStrategiesForGoals(
        goals.map((goal) => goal.id),
        userData.user.id,
        supabase
      );
    } catch (err) {
      strategyWarning =
        "Your goals loaded, but saved strategies could not be loaded.";
    }

    return { goals, savedStrategies, strategyWarning, error: null };
  } catch (err) {
    return {
      goals: [],
      savedStrategies: {} as Record<string, SavedGoalStrategy>,
      strategyWarning: null,
      error: "Unable to load your goals right now.",
    };
  }
}

export default async function GoalsPage() {
  const { goals, error, savedStrategies, strategyWarning } =
    await loadGoalsData();

  return (
    <main className="min-h-screen bg-transparent text-slate-100">
      <Nav />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Financial Goals
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
              Plan your travel goals and we&apos;ll help you find the best way to fund them with points.
            </p>
          </div>
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-400/10 text-sky-300 sm:flex">
            <Target className="h-6 w-6" />
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1 text-rose-100/80">{error}</p>
          </div>
        ) : null}

        {strategyWarning ? (
          <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">
            <p>{strategyWarning}</p>
          </div>
        ) : null}

        <section className="fb-card mb-8 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Create a new travel goal</h2>
          <p className="mt-1 text-sm text-slate-400 mb-5">
            Tell us where you want to go and your preferences.
          </p>
          <GoalForm />
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Your Goals
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm font-normal text-slate-400">
                {goals.length}
              </span>
            </h2>
          </div>

          <div className="space-y-4">
            {goals.length === 0 ? (
              <div className="fb-card p-8 text-center">
                <p className="text-slate-400">You haven&apos;t created any goals yet.</p>
              </div>
            ) : (
              goals.map((goal) => {
                const summary = buildCustomerSafeGoalSummary(goal);
                return <div key={goal.id} className="fb-card p-4 sm:p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-white">{summary.title}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400"><span>{summary.route}</span>
                        {summary.dateWindow ? <><span>•</span><span>{summary.dateWindow}{summary.dateWindowIsFlexible ? " (flexible)" : ""}</span></> : null}
                        <span>•</span>
                        <span>{summary.cabin}</span>
                        <span>•</span>
                        <span>{summary.travelerLabel}</span>
                      </div>
                    </div>
                    {/* Compact cards show essential context; nights, budget, and priority remain in the expanded planning experience. */}
                    <div className="rounded-full bg-sky-400/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                      {summary.status}
                    </div>
                  </div>

                  <GoalStrategyPanel
                    goalId={goal.id}
                    initialStrategy={savedStrategies[goal.id]?.strategy ?? null}
                    initialGeneratedAt={savedStrategies[goal.id]?.generatedAt ?? null}
                    goal={goal}
                  />
                </div>;
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
