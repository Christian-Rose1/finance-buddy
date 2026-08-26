# Finance Buddy

Finance Buddy is a personal-finance assistant: upload Chase statements and
receipts, track reward-account balances, and get AI-planned strategies for
funding travel goals with points and cash.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill it in (see "Environment" below)
cp .env.example .env.local

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Prerequisites

- **Node.js ≥ 22** (tests use `node --test` glob support). A `.nvmrc`
  pinning Node 24 LTS is included — run `nvm use` if you use nvm.
- **npm** (comes with Node).

## Environment

All environment variables are documented in [`.env.example`](.env.example).
Copy it to `.env.local` and fill in the values:

| Variable | Required? | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Your team's shared Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Supabase anon key (safe in the browser; RLS protects data) |
| `OPENROUTER_API_KEY` | Optional | Set to use OpenRouter for the strategy engine instead of local Ollama |
| `OPENROUTER_RESEARCH_MODEL` | Optional | OpenRouter model for research planning; defaults to `openrouter/free` |
| `OPENROUTER_STRATEGY_MODEL` | Optional | OpenRouter model for strategy generation |
| `STRATEGY_RESEARCH_PROVIDER` | Optional | `ollama` (default) or `openrouter` |
| `TAVILY_API_KEY` | Optional | Web-search API used by research queries |
| `OLLAMA_BASE_URL` | Optional | Defaults to `http://localhost:11434` |
| `OLLAMA_STRATEGY_MODEL` | Optional | Local Ollama model for strategy generation |
| `OLLAMA_RECEIPT_MODEL` | Optional | Local Ollama model for receipt extraction |
| `STRATEGY_RUN_SIGNING_SECRET` | Required for persisted goal strategies | Server secret (≥ 32 chars) that signs strategy runs. Generate with `openssl rand -hex 32` |
| `STRATEGY_DEBUG` | Optional | Set to `1` for verbose strategy-engine debug logging |

Never commit `.env.local` or send its values in chat, email, or issues. Share
server secrets and third-party API keys through the team's approved secret
manager. The anon key is intentionally public, but API keys and the signing
secret are not.

### Supabase

The app uses a **shared hosted Supabase project**. Ask the maintainer for the
project URL and anon key (or, if you have project access, get them from
Supabase Dashboard → Project Settings → API), then put them in `.env.local`.
Those two values are enough to run the app. Request Supabase-project access
only if you need to manage schema, storage, auth, or deployment settings.

The database schema lives in `supabase/migrations/` and is applied to the
shared project. New migrations must be reviewed, committed, and applied by a
designated project maintainer; do not edit an applied migration.

For a new migration, a maintainer can use the Supabase CLI against the shared
project after code review:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <shared-project-ref>
npx supabase@latest db push
```

`db push` changes the remote database, so run it only after confirming the
pending migrations and coordinating with the team.

Google OAuth is configured in the Supabase dashboard. Before teammates sign
in locally, a project maintainer must add
`http://localhost:3000/auth/callback` to **Authentication → URL Configuration
→ Redirect URLs**. Add each deployed app URL with `/auth/callback` there as
well.

## Running the test suite

Tests use Node's built-in test runner (`node:test`) with `tsx` as the loader:

```bash
npm test
```

Run a single file:

```bash
node --import tsx --test lib/goals/strategyRunSigning.test.ts
```

## Linting and building

```bash
npm run lint    # ESLint (flat config in eslint.config.mjs)
npm run build   # production build (runs type checks + lint)
npm run dev     # dev server
```

## Project structure

- `app/` — Next.js App Router pages and API routes
- `components/` — React components
- `lib/goals/` — reward-goal strategy engine (planners, providers, validation)
- `lib/rewards/` — card-product catalog types and repository
- `lib/wallet/` — wallet cards and benefit tracking
- `lib/receipts/` — receipt upload and extraction
- `lib/purchases/` — purchase history and optimization
- `supabase/migrations/` — SQL migrations for the shared Supabase project
- `scripts/` — one-off utility scripts
