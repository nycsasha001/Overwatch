# Publishing Overwatch

Written against what this app actually is, not a generic Next.js guide.

Three facts drive every choice below:

1. **It stores everything in files on disk.** `data/journal.db`, `data/market.db` (230 MB) and
   `data/uploads/`. That rules out Vercel, Netlify and every other serverless host — they give you
   no persistent disk, so your journal would be empty on every request. You need a container with a
   mounted volume.
2. **Two gates, then your own account.** `APP_PASSWORD` guards every page *and* every API route
   through `src/middleware.ts`; past it you reach a sign-in screen, not the app. Accounts live in
   `/data/auth.db` with scrypt-hashed passwords, and each user's journal is a *separate file* at
   `/data/users/<id>/journal.db` — isolation is physical, not a `WHERE` clause. A production build
   with no `APP_PASSWORD` or no `AUTH_SECRET` refuses to serve rather than running open.
   `PORTFOLIO_PASSWORD` adds a third lock in front of the Portfolio page alone. All are checked
   server-side; none is ever sent to the browser.
3. **Your data does not travel with the code.** `data/` is git-ignored and `.dockerignore`d, on
   purpose. The deployed app starts with an empty journal, no market candles and no portfolio. See
   step 4.

---

## Before anything is public

**Rotate the Databento key.** It was printed in plain text during a security audit earlier, which
means it has to be treated as leaked whether or not anyone saw it. Log in to Databento, revoke the
old key, issue a new one, and put the new value in `.env.local` and in your host's variables.
Nothing else on this list matters as much, because that key can spend money.

---

## Step 1 — Push the code

Six commits are sitting locally. Double-click **Push to GitHub.command**, which re-checks that no
database, `.env` file or upload is in the commit before anything leaves the machine.

Then open the repo on GitHub and confirm it says **Private** next to the name.

## Step 2 — Deploy to Railway

Railway gives you a container with a real disk, which is the only requirement that actually
constrains the choice. Fly.io and Render work the same way if you prefer them.

1. railway.app → **New Project** → **Deploy from GitHub repo** → pick `Overwatch`.
2. It will find the `Dockerfile` in the repo root and build from that. No further build config.
3. **Add a volume** — this is the step that matters. Settings → Volumes → mount path `/data`.
   Without it every deploy wipes your journal. The Dockerfile already points `TJ_DATA_DIR` at
   `/data`, so nothing else needs changing.
4. Set the variables under Settings → Variables:

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | a long one. The shared password: layer one, in front of everything |
   | `AUTH_SECRET` | signs account sessions. **Required** — the app refuses to serve without it |
   | `PORTFOLIO_PASSWORD` | the second lock on Portfolio. Must differ from the above |
   | `FINNHUB_API_KEY` | live prices for the portfolio |
   | `DATABENTO_API_KEY` | the **new** one, after rotating |

   `TJ_DATA_DIR` is already set by the image. Do not set `NODE_ENV` — the image does that too.

5. Deploy. First build takes a few minutes.

## Step 3 — Check it before trusting it

Open the Railway URL. You should get the login screen, not the dashboard. Then, from a terminal:

```
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-URL/api/trades
```

**It must print 401.** If it prints 200, the gate is not running and nothing else in this document
matters — stop and say so.

## Step 4 — Your existing data

Nothing came with the code. You have three options, and they are not equally good:

- **Start fresh.** The portfolio takes ten minutes to re-enter and has a "Start from today" button
  built for exactly this. Backtesting will have no candles until you import some.
- **Upload the databases.** `railway run` with the volume mounted, or Railway's file browser. Moves
  everything at once, including 230 MB of candles. Do this while the app is not running, or SQLite's
  write-ahead log will disagree with the file you copied.
- **Re-import market data on the server.** Works, but it spends Databento credit for candles you
  already have on your Mac. The upload is free.

## Step 5 — Domain

Buy one anywhere (Namecheap, Cloudflare, Porkbun — all fine, roughly $10–15/yr). In Railway:
Settings → Networking → Custom Domain, then add the CNAME it gives you at your registrar. HTTPS is
issued automatically. Propagation is usually minutes.

---

## What this costs

- Railway: about $5/month for a small instance, plus a few cents for the volume.
- Domain: $10–15/year.
- Finnhub: free tier.
- Databento: only what you spend importing candles.

## The honest recommendation

**Consider not publishing this.**

It is a personal trading journal that now holds your net worth, your positions, and your P&L. Once
it is on a public URL, one password is the entire defence — and passwords get reused, phished, and
shoulder-surfed. Nothing in the app needs the public internet to work.

Two alternatives cost nothing and remove the attack surface completely:

- **Keep running it locally.** It already works this way. No hosting bill, no domain, no exposure.
- **Tailscale.** Free, five minutes to set up, and gives you the same app on your phone and laptop
  from anywhere — but reachable *only* by devices you have signed in. This is what I would do.

If you want it public anyway, everything above is correct and the password gate is real. Just go in
knowing which trade you are making.
