# Putting Overwatch on a domain

Written against what this app actually is, not a generic Next.js guide. Two facts drive every
choice below:

1. **It stores everything in files on disk.** `data/journal.db`, `data/market.db` (241 MB) and
   `data/uploads/`. That rules out Vercel, Netlify and every other serverless host — they give you
   no persistent disk, so your journal would be empty on every request. You need a container with a
   mounted volume.
2. **There is no login.** None. Anyone who knows the URL can read your journal, edit it, delete
   accounts, and — worse — trigger market-data imports that charge your Databento account. This is
   the blocker, not the hosting.

Do step 1 before anything is publicly reachable.

---

## Step 1 — Add a password (do not skip)

You need at minimum a single-password gate in front of the whole app: a `middleware.ts` that checks
a signed cookie and redirects to a login page, plus one route that sets the cookie when the password
matches a `APP_PASSWORD` environment variable.

That is roughly 80 lines and I can write it. Ask before you deploy.

If you would rather not add auth at all, stop here and use **Tailscale** instead (step 7b) — the app
stays private to your own devices and needs no login, no domain, and no hosting bill.

---

## Step 2 — Get the code into a private GitHub repo

`.gitignore` is already correct: it excludes `data/`, `.env.local` and `node_modules`. Your
databases and your API key will not be uploaded.

```bash
cd "/Users/alexaminov/Desktop/Trading UI"
git init
git add -A
git commit -m "Overwatch"
```

Then on github.com: **New repository → name it `overwatch` → Private → Create**, and run the two
commands GitHub shows you under "push an existing repository".

**Check before pushing:** run `git status --short` and confirm no `.db` file and no `.env.local`
appear. If one does, do not push — tell me and I will fix the ignore rules.

---

## Step 3 — Deploy to Railway

Railway is the least fiddly host that offers a persistent volume.

1. Sign in at railway.app with GitHub.
2. **New Project → Deploy from GitHub repo →** pick `overwatch`.
3. It detects Next.js and builds. The first build takes 2–4 minutes.

### Add the volume — this is the part that matters

4. In the service, **Settings → Volumes → New Volume**.
   - Mount path: `/data`
   - Size: **2 GB** (your market data is 241 MB today and grows with every import)
5. **Variables → New Variable**, add both:

   | Name | Value |
   |---|---|
   | `TJ_DATA_DIR` | `/data` |
   | `DATABENTO_API_KEY` | *(copy from your local `.env.local`)* |

   `TJ_DATA_DIR` is what points the app at the volume instead of a temporary folder. Without it,
   every deploy wipes your journal.

6. Redeploy. Railway gives you a URL like `overwatch-production.up.railway.app`. Open it — you
   should get an empty journal, because the volume is new.

---

## Step 4 — Move your existing data up

Your journal is 76 KB and your screenshots are 3.4 MB, so those are easy. The 241 MB of market data
is the awkward one.

```bash
# Install Railway's CLI once
npm i -g @railway/cli
railway login
cd "/Users/alexaminov/Desktop/Trading UI"
railway link          # pick the project you just made

# Stop the app first so nothing is writing to the database mid-copy
railway run bash -c 'ls -la /data'   # confirms the volume is mounted and empty
```

Then copy the files up. Railway has no direct file upload, so the reliable route is to zip and pull
them through a temporary shell:

```bash
# On your Mac: make one archive of everything that matters
cd "/Users/alexaminov/Desktop/Trading UI/data"
tar czf ~/overwatch-data.tgz journal.db uploads
```

Upload `overwatch-data.tgz` somewhere you can fetch it from (a private Dropbox or Google Drive
direct link), then in a Railway shell:

```bash
railway run bash
cd /data && curl -L "<your link>" -o d.tgz && tar xzf d.tgz && rm d.tgz && ls -la
```

**On `market.db`:** do not upload it. It is 241 MB of candles you can re-import, and Databento
charges per request, not per byte you store — but you already own the data, so a re-import costs
nothing new only if you use the batch endpoint. Simplest: deploy without it and re-import the range
you actually backtest, using the cost preview the app already shows you before it fetches.

---

## Step 5 — Buy a domain

Cloudflare Registrar sells at cost, around **$10/year** for a `.com`, with no first-year discount
that triples on renewal. Namecheap and Porkbun are fine too.

Buy the name. Do not buy hosting, email, SSL or "privacy protection" upsells — you need none of
them, and Cloudflare includes WHOIS privacy free.

---

## Step 6 — Point the domain at Railway

1. Railway service → **Settings → Networking → Custom Domain →** enter `overwatch.yourdomain.com`
   (a subdomain is easier than the root, and works identically).
2. Railway shows you a `CNAME` target.
3. In your registrar's DNS panel, add:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `overwatch` | *(the target Railway gave you)* |

4. Wait. DNS usually takes 5–30 minutes. Railway issues the HTTPS certificate automatically once it
   sees the record — you do not buy or install an SSL certificate.

---

## Step 7 — Two things to do once it is live

**a. Back the journal up.** It is one file. A weekly job that copies `/data/journal.db` somewhere
else is worth more than everything above — a volume is not a backup, and losing the journal loses
the only thing here that cannot be regenerated.

**b. The cheaper alternative, if you never actually needed a public URL.** If the point is "use my
journal from my phone and laptop" rather than "other people can see it", install
[Tailscale](https://tailscale.com) on your Mac and your phone. Your Mac keeps running the app
exactly as it does now, and it becomes reachable at a private address from any of your devices.
No hosting bill, no domain, no auth to write, and nothing exposed to the internet. This is the right
answer for most personal tools and it takes about ten minutes.

---

## What this costs

| | |
|---|---|
| Railway (service + 2 GB volume) | ~$5–10/month |
| Domain | ~$10/year |
| Tailscale instead | free |

---

## What I would do

Tailscale first, today, because it is ten minutes and solves the actual problem. Then Railway later
if you decide you want other people to see it — at which point the password gate stops being
optional and I will write it properly.
