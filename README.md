# PGA Tracker

Personal PGA betting tracker. Deployed to Vercel, backed by Supabase.

## Setup

### 1. Supabase

1. In your Supabase dashboard, click **New Project**.
2. Name it (e.g. `pga-tracker`), pick the closest region, set a database password (save it somewhere — you won't need it for this project but Supabase requires one).
3. Wait ~2 minutes for it to provision.
4. Open **SQL Editor** (left sidebar) → **New query**.
5. Paste the contents of `supabase-setup.sql` from this repo, click **Run**.
6. Open **Project Settings** → **API**.
7. Copy two values, you'll need them in step 3:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (long string under "Project API keys")

### 2. GitHub

1. Go to https://github.com/new
2. Name the repo `pga-tracker` (or anything you like)
3. Set to **Private** (recommended — anyone with your Supabase URL has read/write access)
4. Don't initialize with README
5. Create repo
6. Upload all files in this folder using GitHub's drag-and-drop uploader on the repo page (the "uploading an existing file" link)

### 3. Vercel

1. Go to https://vercel.com → sign in with GitHub
2. Click **Add New** → **Project**
3. Import your `pga-tracker` repo
4. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. Click **Deploy**
6. Wait ~60 seconds. Vercel gives you a URL like `pga-tracker-aj-bets.vercel.app`

### 4. Install on your phone (PWA)

1. Open the URL in Safari (iPhone) or Chrome (Android)
2. iPhone: tap Share → Add to Home Screen
3. Android: tap menu → Install app
4. The app will install with a teal icon and open like a native app

## Sharing partner ledgers

On the Partners tab, click **Copy Share Link** for any partner. Sends them a URL like `your-app.vercel.app/share/Bird` — read-only view of just their ledger.

## Refresh

Top-right Refresh button fetches the live ESPN PGA leaderboard via the Vercel serverless function in `/api/leaderboard.js` and updates positions on all open Truist (or whatever's active) bets.

## Updating the app later

If I send you new code in chat, the workflow is:
1. Open the file on GitHub (web editor)
2. Click pencil → paste new content → commit
3. Vercel auto-rebuilds in ~60 sec
4. Refresh the URL — new version is live
