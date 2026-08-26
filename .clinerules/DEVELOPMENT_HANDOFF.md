Finance Buddy — Development Handoff
Updated: 2026-08-25
Product North Star
Finance Buddy is a personalized credit-card points strategist.
Its purpose is to help users accomplish goals—especially travel goals—using credit-card points at the lowest practical cash cost.
Example:
“My wife and I want to visit Europe next summer. How can we pay for as much of the trip as possible with points?”
Finance Buddy should combine:
User goals and preferences
Owned cards
Points and miles balances
Transfer partners and redemption options
Historical receipts, statements, and spending habits
Earning rules
Card benefits and credits
Expected future spending
It should produce realistic earning and redemption strategies, identify points gaps, explain tradeoffs, and track progress.
Finance Buddy is not Rocket Money, a general budgeting app, or a conventional financial advisor.
Purchases and transaction optimization are supporting infrastructure. Goal planning is the product.
Core Architecture
Financial evidence
→ canonical Purchase
→ spending profile
→ earning strategy
→ goal plan
→ redemption strategy
→ tracked outcome
Purchase remains the canonical downstream financial object.
Sources include receipts and statements, with email, screenshots, and manual evidence planned later.
Do not create competing transaction models unnecessarily.
Chat is the interface, not the calculation engine. Financial calculations should be deterministic whenever possible.
Trust Rules
Always distinguish:
evidence
inferred
calculated
manual
Evidence-backed does not automatically mean verified.
verified means explicitly confirmed by a user or another authoritative mechanism.
Never invent financial facts, points balances, award availability, transfer ratios, or benefit dates.
Never silently assign generic dollar values to points or miles.
Value Semantics
Keep these separate:
Money Found: confirmed additional dollar value
Available Benefits: unused balances
Potential Opportunities: possible value needing evidence
Already Saved: discounts already applied
Rewards: points, miles, or cashback in native units
Do not count likely eligibility, unknown eligibility, unused benefit balances, or unvalued points as confirmed Money Found.
Verified Foundation
Implemented:
Next.js application
Supabase authentication and user-owned RLS
Receipt ingestion
Chase statement ingestion (statement PDF) plus generic bank activity CSV ingestion (single auto-detecting parser in lib/parser/statementCsvParser.ts; column detection by header, per-row years, verified against real Chase and Apple Card exports)
Canonical Purchase persistence
Normalized purchase items and evidence
Purchase provenance and metadata
Dashboard, Purchase History, and Purchase Detail
Persisted WalletCards
RewardProgram and CardProduct catalog
Earning rules and category normalization
Personalized best-card recommendations
ProductBenefits and WalletBenefits
Benefits Discovery
Per-Purchase benefit evaluation
Per-Purchase Money Found
F1 manual Card Used confirmation
F2 manual Booking Channel confirmation
F1 and F2 are browser-verified.
F3 benefit-applied confirmation is not implemented.
Benefit Period Milestone
Completed and deployed on 2026-08-19.
ProductBenefit:
periodType
allowed values:
none
calendar_year
cardmember_year
quarter
month
WalletBenefit:
periodStart: string | null
periodEnd: string | null
Database:
product_benefits.period_type text not null default 'none'
approved check constraint deployed
wallet_benefits.period_start timestamptz null
wallet_benefits.period_end timestamptz null
The $100 Annual Chase Travel Hotel Credit is verified as:
type: statement_credit
eligible category: travel:hotels
requires activation: false
period type: cardmember_year
No period dates were invented.
Automatic reset calculation is not implemented.
Migration:
20260819120000_add_benefit_periods.sql
Production build passed before deployment.
Current Product Direction
Do not automatically continue to F3 or deeper infrastructure.
The next major milestone is Goal Planning Alpha.
Hero journey:
Two travelers want to visit Europe next summer and minimize cash cost using credit-card points.
Goal Planning Alpha should eventually support:
Conversational goal intake
Manual cards and reward-balance confirmation
Spending-profile analysis from Purchases
Deterministic earning forecasts
Points-gap calculation
Two or three strategy comparisons
Explicit assumptions, risks, points, and cash costs
Action plan and progress tracking
Start with a constrained rewards ecosystem rather than attempting universal card, loyalty-program, and live-award coverage.
ChatGPT must define the product behavior, Goal model, MVP boundary, and acceptance criteria before assigning implementation to Cline.
Current Next Step
Review this handoff diff.
Commit and push the verified Benefit Period milestone.
Define the Goal Planning Alpha product specification and architecture.
Only then create bounded Cline implementation tasks.
Known Build State (2026-08-25)
npm run build fails on pre-existing type errors in two test fixtures that were not updated for later schema changes: lib/goals/ollamaStrategyProvider.test.ts (PersonalizedStrategy fixture missing pointsInventory and allocationScenarios) and lib/wallet/benefitOpportunity.test.ts (ProductBenefit.periodType and WalletBenefit.periodStart fixtures). These errors exist at HEAD 800319f independent of the CSV work; the CSV ingestion change itself type-checks cleanly and its tests pass.
Known Storage State (2026-08-25, RESOLVED)
The app's Supabase project onotvwyrewkszxukhkrd (per .env.local) was a completely fresh project: NO migrations had ever been applied and no migration history existed, which caused "Bucket not found" and would have broken every DB-backed feature. On 2026-08-25 all 17 migrations in supabase/migrations were applied via supabase db push (CLI installed via npm, v2.115.0) and history is now recorded. Verified: all 12 tables, persist_purchase RPC, benefit-period columns, all 8 storage RLS policies, and catalog seeds present; an authenticated end-to-end upload to the statements bucket succeeded. The stale supabase/.temp link previously pointed at degqtzguwbyoxfmdalro, which is NOT accessible from the current Supabase account — ignore it. The CLI is now linked to onotvwyrewkszxukhkrd.
Working Rules
ChatGPT handles architecture, product semantics, tradeoffs, sequencing, and task decomposition.
Cline performs bounded implementation work.
Cline tasks should:
Use exact small file allowlists
Avoid repository-wide exploration
Include DO, DO NOT, VERIFY, and STOP
Stop before opening an unapproved file
Avoid unrelated edits
Never run remote supabase db push
Never edit applied migrations
Optimize for correctness, user value, development throughput, maintainability, and cost—in that order.
Constructive disagreement is expected. Do not preserve roadmap items merely because they were previously planned.