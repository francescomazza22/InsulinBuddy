# Adding cloud sync (Supabase) — step by step

This turns on optional sign-in and cross-device sync, on top of the free GitHub
Pages hosting you already have. Nothing about your hosting changes — the app
is still static files; it just talks to Supabase's API directly from the
browser once you're signed in. If you skip all of this, the app keeps working
exactly as before, stored only in this browser.

**Cost: $0.** Supabase's free tier covers this easily (500MB database, 50,000
monthly active users). The one real limitation: a free-tier project pauses
itself after 7 days with no API activity, and needs a manual "restore" click
in the dashboard to wake back up. Fine for personal use; worth knowing.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login is
   fastest).
2. Click **New Project**. Pick any name and a database password (save that
   password somewhere — you won't need it for this app, but Supabase asks for
   it as the Postgres superuser password).
3. Wait about a minute for the project to finish provisioning.

## 2. Create the table

1. In your new project, open **SQL Editor** in the left sidebar.
2. Click **New query**, paste in the contents of `supabase-setup.sql` (in this
   folder), and click **Run**.
3. That's it — this creates one table (`app_state`) and three security
   policies that make sure a signed-in user can only ever see their own row,
   enforced by the database itself, not just by the app's code.

## 3. Turn off email confirmation (optional, for simplicity)

By default, Supabase emails a confirmation link after sign-up, and login
won't work until it's clicked. For a personal app this is often more friction
than it's worth:

1. Go to **Authentication → Providers → Email**.
2. Turn off **Confirm email**.
3. Save.

(You can leave this on if you'd rather have that extra step — the app's sign-up
flow already tells people to check their email either way.)

## 4. Get your API keys

1. Go to **Project Settings → API**.
2. Copy the **Project URL** (looks like `https://xxxxxxxx.supabase.co`).
3. Copy the **anon / public** key (a long string starting with `eyJ...`).

These are meant to be public — they're safe to commit to your repo. Access
control happens through the Row Level Security policies from step 2, not by
keeping this key secret.

## 5. Paste them into the app

Open `app.js`, find these two lines near the top:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Replace the placeholder strings with your actual Project URL and anon key
from step 4. Save the file.

## 6. Push to GitHub

Push the updated `app.js` (and the rest of the files, if you haven't already)
to your repo like normal. Once GitHub Pages redeploys, open your site —
Settings → General → **Account & Sync** will now show a sign-up/sign-in form
instead of "Cloud sync isn't set up yet."

## 7. Try it

1. **If you already have data in this browser** (foods, recipes, history from using the app locally) — go to Settings → Data → **Export full backup** first and save that file somewhere. Signing in starts you off with a fresh, empty cloud account; it doesn't automatically bring your existing local data with it.
2. Create an account (email + password).
3. If you left email confirmation on, check your inbox and click the link, then come back and sign in.
4. Once signed in, if you exported a backup in step 1, use Settings → Data → **Import full backup** to bring your existing library, recipes, and history into the new account (it merges — nothing gets wiped).
5. From here, anything you add gets saved to your Supabase project instead of just this browser — open the same URL on another device and sign in with the same account to see it sync across.

## What this does and doesn't give you

- **Does**: real accounts, cross-device sync, data survives clearing your
  browser or losing your phone.
- **Doesn't**: offline support beyond a local cache (if you lose connection
  mid-edit, that specific change may not reach the server until you're back
  online — there's no conflict resolution for editing the same account from
  two offline devices at once), real-time collaboration between multiple
  people, or automatic backups beyond what Supabase itself provides.
- The **passphrase lock** feature (Settings → Privacy) is only for local-only
  use without an account — once you're signed in, it's hidden, since your
  Supabase account and its Row Level Security policy are already doing that
  job at the database level.
