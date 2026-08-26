import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { createServerClient } from "@/lib/supabase-server";
import { getWalletCardsForUser } from "@/lib/wallet/repository";
import {
  getCardProducts,
  getRewardPrograms,
} from "@/lib/rewards/catalogRepository";
import { getWalletBenefitOptionsForCard } from "@/lib/wallet/benefitsRepository";
import { getRewardAccountsForUser } from "@/lib/goals/rewardAccountsRepository";
import { WalletCardList } from "@/components/wallet-card-list";
import { WalletCardForm } from "@/components/wallet-card-form";
import { RewardAccountManager } from "@/components/reward-account-manager";
import type { WalletBenefitOption } from "@/lib/wallet/benefitsRepository";
import { Wallet } from "lucide-react";

async function loadWalletData() {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect("/login");
  }

  try {
    const [cards, products, rewardAccounts, rewardPrograms] = await Promise.all([
      getWalletCardsForUser(userData.user.id),
      getCardProducts({ activeOnly: true }),
      getRewardAccountsForUser(userData.user.id, supabase),
      getRewardPrograms(supabase),
    ]);

    // Load each linked product's definitions with optional user-owned state.
    const benefitOptionsByCard: Record<string, WalletBenefitOption[]> = {};
    const benefitResults = await Promise.all(
      cards.map(async (card) => ({
        cardId: card.id,
        benefits: await getWalletBenefitOptionsForCard(
          card.id,
          userData.user.id,
          supabase
        ),
      }))
    );
    for (const result of benefitResults) {
      benefitOptionsByCard[result.cardId] = result.benefits;
    }

    return {
      cards,
      products,
      benefitOptionsByCard,
      rewardAccounts,
      rewardPrograms,
      error: null,
    };
  } catch {
    return {
      cards: [],
      products: [],
      benefitOptionsByCard: {},
      rewardAccounts: [],
      rewardPrograms: [],
      error: "Unable to load your wallet right now.",
    };
  }
}

export default async function WalletPage() {
  const {
    cards,
    products,
    benefitOptionsByCard,
    rewardAccounts,
    rewardPrograms,
    error,
  } = await loadWalletData();

  return (
    <main className="min-h-screen bg-transparent text-slate-100">
      <Nav />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              My Wallet
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
              Manage the cards you own. Only basic card metadata is stored —
              never your full card number, CVV, or PIN.
            </p>
          </div>
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-400/10 text-sky-300 sm:flex">
            <Wallet aria-hidden="true" className="h-6 w-6" />
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1 text-rose-100/80">{error}</p>
          </div>
        ) : null}

        <section className="fb-card mb-6 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Add a card</h2>
          <p className="mt-1 text-sm text-slate-400">
            Enter the card name, issuer, network, and reward type.
          </p>
          <div className="mt-5">
            <WalletCardForm mode="create" />
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Points & miles balances
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm font-normal text-slate-400">
                {rewardAccounts.length}
              </span>
            </h2>
          </div>
          <RewardAccountManager
            accounts={rewardAccounts}
            programs={rewardPrograms}
          />
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Your cards
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm font-normal text-slate-400">
                {cards.length}
              </span>
            </h2>
          </div>
          <WalletCardList
            cards={cards}
            products={products}
            benefitOptionsByCard={benefitOptionsByCard}
          />
        </section>
      </div>
    </main>
  );
}
