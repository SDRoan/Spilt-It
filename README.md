# Split It

Split It is a production-ready MVP for manual expense sharing.

No OCR, no scanning.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (Auth + Postgres + Row Level Security)
- Vercel-ready deployment
- Vitest unit tests for split and settle-up logic

## Features

- Email magic-link auth (Supabase)
- Profile display name
- Groups with single-currency setting
- Invite links (token-based) to join groups
- Expenses with split modes:
  - Equal
  - Exact amounts
  - Percent
  - Shares/weights
  - Itemized line-items
- Edit/delete expenses
- Per-member expense breakdown
- Real-time balance computation from expenses + payments
- Suggested settle-up transfers (greedy minimization)
- Record settlement payments

## 1) Create Supabase project

1. Go to Supabase and create a free project.
2. Open the SQL Editor.
3. Paste and run [`supabase/schema.sql`](supabase/schema.sql).
4. (Optional) Use [`supabase/seed.sql`](supabase/seed.sql) as a helper template.
5. In Supabase Project Settings -> API, copy:
   - `Project URL`
   - `anon public key`

## 2) Environment variables

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (for local: `http://localhost:3000`)

## 3) Install and run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## 4) Tests and quality checks

```bash
npm run test
npm run lint
npm run build
```

## 5) Deploy to Vercel (free tier)

1. Push repo to GitHub.
2. Import project in Vercel.
3. Add the same env vars from `.env.local` in Vercel Project Settings.
4. Deploy.
5. Set `NEXT_PUBLIC_SITE_URL` to your Vercel production URL.

## Notes

- Money is stored as integer cents (`*_cents`) to avoid floating point errors.
- Group data is protected with Supabase Row Level Security (RLS).
- Invite token flow allows joining without exposing protected group data before membership.
- This project intentionally uses manual data entry only.

No OCR, no scanning.
