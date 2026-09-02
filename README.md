# Overwatch — Trading Journal & Analytics

A local-first trading journal, calendar and performance analytics application. Everything runs on your
machine: a Next.js app talking to a SQLite database file. No account, no cloud, no telemetry.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

For a production build:

```bash
npm run build
npm start
```

On first launch you are asked to create an account (name, type, starting balance, currency,
default risk %). Nothing is pre-populated — every number in the app comes from trades you record.

### Optional: see the UI with sample data

```bash
npm run dev          # leave running in one terminal
npm run demo:seed    # in another
```

This creates a clearly-labelled **“Demo (sample data)”** account with ~60 generated trades so you can
evaluate the interface. Delete that account in *Settings → Accounts* to remove all of it. The
generator lives in `scripts/seed-demo.mts` and is never run by the app itself.

## Tests

```bash
npm test             # statistics engine unit tests (no server needed)
npm start &          # then, against a running instance:
BASE=http://localhost:3000 npm run test:api
```

`test:api` writes to the live database, creating a temporary account and deleting it at the end.

## Where things live

```
src/lib/db.ts            SQLite schema, migrations and every query
src/lib/types.ts         Domain types, result classifications, default settings
src/lib/stats.ts         All performance maths (metrics, equity, drawdown, buckets, MAE/MFE)
src/lib/validate.ts      Server-side normalisation and validation of trade payloads
src/lib/csv.ts           CSV parser/serialiser and date/time normalisation
src/lib/client.ts        Typed fetch wrapper used by the UI
src/lib/format.ts        Money / R / percent / date formatting

src/app/api/*            REST routes (trades, accounts, settings, screenshots, backtests, import, export)
src/app/page.tsx         Dashboard
src/app/calendar         Monthly calendar with per-day drill-down
src/app/journal          Trade list and full journal entry pages
src/app/analytics        Deep statistics and breakdowns
src/app/backtesting      Run configuration, results storage and comparison
src/app/settings         Accounts, defaults, statistic rules, strategies, CSV import/export

src/components/app-context.tsx     Data store (accounts, settings, trades) + account switching
src/components/filter-context.tsx  Global filter state and the filtering logic
src/components/trade-editor.tsx    Add/edit trade modal (progressive disclosure)
src/components/charts.tsx          Hand-built SVG charts — no charting dependency
src/components/ui.tsx              Design-system primitives
```

Data files (created on first run, git-ignored):

```
data/journal.db          SQLite database
data/uploads/            Screenshot files
```

Move or back up the `data/` folder to move or back up your journal. Set `TJ_DATA_DIR` to store it
somewhere else.

## Statistics rules

Each result classification (Win, Loss, Break-even, Early Profit, Early Loss, Partial Profit,
Partial Loss) is stored raw. *Settings → Statistics* controls whether each one counts as a win, a
loss, a break-even, or is excluded from statistics entirely. Win rate excludes break-evens by
default; that is configurable too.

R multiples are derived from entry/stop/exit when you do not type one, and P&L is derived from
R × risk when left blank. Nothing is invented: if the inputs are missing, the field stays empty and
statistics that depend on it say so.

## Backtesting integration

The app does **not** simulate strategies, and it never displays fabricated results. It stores run
configurations and accepts results from an external engine:

```
GET  /api/backtests                     list runs (id, strategy, instrument, dates, params)
POST /api/backtests/{id}/result         { trades, netR, netPnl, winRate, profitFactor,
                                          maxDrawdownR, equityR?, raw?, note? }
POST /api/backtests/{id}/result         { "status": "failed", "error": "..." }
```

A Python runner can poll the first endpoint, execute the run, and post back. Completed runs then
appear in the Backtesting page and can be compared side by side.

To feed backtested trades into the journal itself, post them to `POST /api/trades/import`
(`{ accountId, trades: [...] }`) — the same endpoint the CSV importer uses.

## Database driver

Storage is SQLite. The app prefers `better-sqlite3` (installed as an *optional* dependency, so a
failed native build never breaks `npm install`) and automatically falls back to Node's built-in
`node:sqlite` when it is not available. Both paths are covered by the API test suite. Force one with
`TJ_DRIVER=better-sqlite3` or `TJ_DRIVER=node`. Node 22.5 or newer is required for the fallback.


## Connecting your Python engine

`engine/overwatch.py` is a zero-dependency client (standard library only) that lets a backtesting
engine read the app's candles and write its results back.

```python
from overwatch import Overwatch, Trade

ow = Overwatch()                                   # http://localhost:3000
bars = ow.candles("MNQ", "1m", "2026-03-01", "2026-04-01")

# ... your logic produces trades ...

ow.log_trades(trades, account="Engine")            # into the journal
ow.save_run("MNQ sweep model — 2026", trades,      # into the Backtesting journal
            instrument="MNQ", start="2026-03-01", end="2026-04-01")
```

- **`candles(symbol, tf, start, end)`** — the same bars the charts and replay use, with daily,
  weekly and 4H anchored to the 18:00 ET session open. Timestamps are epoch milliseconds UTC.
- **`log_trades(trades, account="Engine")`** — writes into the journal. The account is created if
  it does not exist, as a *paper* account: simulated fills must not blend into a live account's
  statistics. Invalid rows are skipped and reported rather than dropped silently.
- **`save_run(name, trades, ...)`** — computes net R, win rate, profit factor and max drawdown,
  and stores every individual test alongside them so the write-ups sit with the numbers.
- **`backfill_excursions()`** — fills MAE and MFE from stored candles for any trade that did not
  supply them, using exactly the same bars the engine read.

`Trade` requires only `date`, `instrument`, `direction` and `result`; everything else — prices,
size, risk, session, setup flags, journal notes — is optional and feeds the analytics when present.
Trades are tagged `engine` by default so they filter apart from replay and manual entries.

`engine/example_run.py` is a runnable demonstration of the whole loop, not a strategy. It defaults
to `--dry-run`, which prints what it would post without writing anything.

```bash
python3 engine/example_run.py --dry-run
```


### Running the engine from the app

Set **Settings → Backtesting engine → Script** to the absolute path of the file you would press
play on in your editor, then use the **Run** button on any row in the Backtesting journal.

The app starts it with your interpreter, waits, and captures its output. Parameters arrive as
command line arguments (`--symbol --start --end --strategy`) and environment variables
(`OVERWATCH_URL`, `OVERWATCH_RUN_ID`, `OVERWATCH_SYMBOL`, `OVERWATCH_START`, `OVERWATCH_END`,
`OVERWATCH_PARAMS`). A script that ignores them still runs.

**Run** waits for the script and is meant for quick backtests. **Run overnight** starts it detached:
it survives closing the tab, has no time limit, and streams output to `data/engine-runs/<id>.log`.
Results appear on the run as soon as the engine posts them.

Results reach the app either way: post them with `engine/overwatch.py`, or print a JSON object
with a `trades` count as the last thing on stdout and it will be stored automatically. Failures,
non-zero exits and anything running past fifteen minutes are recorded against the run with the
output attached.

The script path is held in settings, never taken from a request, so the endpoint cannot be asked
to execute something else.

## Known limitations

- Screenshots are stored as files on disk; there is no image resizing or thumbnailing.
- Backtesting has no bundled engine (by design — see above).
- Multi-currency accounts are stored per-account, but the “All accounts” view sums raw numbers
  without FX conversion.
- Light theme is not implemented.
