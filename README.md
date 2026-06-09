# Macro Monitor — CPI · Jobs · PCE

Standalone, IC-grade macro tracker. Five tabs: **Overview** (regime + Fed read-through + surprise scorecard + release calendar), **Liquidity** (the Guide to the Market mirror — 522-week net liquidity vs S&P 500, supportive/uncomfortable/stress zones, SOFR-IORB), **CPI**, **Jobs**, **PCE**. Single-file HTML, Bloomberg-dark, EN/繁 toggle, SHA-256 access gate. Data is **baked from FRED at build time** by a scheduled GitHub Action — the deployed page stays static, so there is no exposed API key and no client-side CORS.

## How it works
- `index.html` — the dashboard. All data lives in one block between `//__MM_DATA_START__` and `//__MM_DATA_END__`.
- `scripts/fetch-fred.mjs` — pulls every series from FRED and computes YoY / MoM / 3m & 6m annualized / Sahm / the sector waterfall / net liquidity / a core-PCE nowcast, then rewrites that block.
- `scripts/consensus.json` — market expectations (the only thing FRED can't supply).
- `scripts/manual.json` — regime text, release calendar, payroll revisions, World-Cup trend baseline.
- `.github/workflows/update-data.yml` — runs the script (weekdays 13:45 UTC + manual + on script edits), commits only if data changed; Vercel redeploys.

## One-time setup
1. **Push this repo to GitHub.**
2. **FRED key** — fred.stlouisfed.org → My Account → API Keys → request a key (free).
3. **Add the secret** — repo → Settings → Secrets and variables → Actions → *New repository secret* → name `FRED_API_KEY`, paste the key.
4. **Let Actions write** — Settings → Actions → General → Workflow permissions → *Read and write permissions* → Save.
5. **First bake** — Actions tab → *Update macro data* → *Run workflow*. This replaces the launch snapshot with live FRED data and backfills full chart history.
6. **Deploy** — connect the repo to Vercel (framework preset: Other; it's a static file). It's named `index.html`, so Vercel serves it at the domain root automatically.

## Squarespace embed (house pattern)
Full-page takeover via page-level **Code Injection** — paste the file contents (inject as `.txt`), not an iframe block. The SHA-256 gate uses `crypto.subtle`, which needs a secure context: it works on your Vercel/Squarespace `https://` URL, **not** on a local `file://` open.

## Keeping it current
- **Automatic:** the cron re-bakes weekday mornings; identical data = no commit.
- **Before each print (~2 min):** update `scripts/consensus.json` with the new consensus and roll the dates in `scripts/manual.json`. Payroll `revisions` come straight off the BLS release (initial vs revised).
- Force a refresh anytime: Actions → *Run workflow*.

## Access key
SHA-256 gate; plaintext is never stored. To change the key: `echo -n NEWKEY | shasum -a 256`, then replace `PW_HASH` in `index.html`.

## FRED series (verify the ★ for your vintage before the first run)
**CPI** — CPIAUCSL (headline), CPILFESL (core), CPIENGSL (energy), CPIUFDSL (food), CUSR0000SAH1 (shelter), CUSR0000SACL1E ★ (core goods), CUSR0000SASLE ★ (core services), TRMMEANCPIM159SFRBCLE (trimmed mean), MEDCPIM159SFRBCLE (median), CORESTICKM159SFRBATL (sticky), COREFLEXCPIM159SFRBATL ★ (flexible).
**PCE** — PCEPI (headline), PCEPILFE (core), PCETRIM12M159SFRBDAL (trimmed mean), DGDSRG3M086SBEA ★ (goods), DSERRG3M086SBEA ★ (services), PI / DSPI / PCE (income / DPI / spending), PSAVERT (saving rate), A191RL1Q225SBEA (real GDP SAAR).
**Jobs** — PAYEMS (NFP), UNRATE (U-3), U6RATE (U-6), CES0500000003 (AHE), CIVPART, EMRATIO, SAHMCURRENT (Sahm), JTSJOL / JTSHIL / JTSQUL / JTSTSL / JTSQUR (JOLTS). Sector levels ★: USLAH, CES9093000001, CES6562000101, CES6562400001, MANEMP, USPBS, CES1011000001, CES4300000001, USCONS, USTRADE, USINFO, USFIRE.
**Liquidity** — WALCL, WTREGEN (TGA), RRPONTSYD (RRP), SOFR, IORB, SP500. NL = WALCL/1000 − TGA/1000 − RRP, charted in $tn over 522 weeks; zones are supportive > $6.0T / uncomfortable $5.5–6.0T / stress < $5.5T. SOFR-IORB is the funding-stress spread (bps).

> **CPI methodology.** Headline/core/component **YoY** come from the *not-seasonally-adjusted* index (CPIAUCNS / CPILFENS / CUUR-prefixed), the BLS/press convention; **MoM** and 3m/6m annualized use the SA index. All lookbacks are date-based (not positional) so the October-2025 collection gap doesn't shift the 12-month base.

> Supercore CPI/PCE (services ex-housing) and the PCE nowcast are computed. The nowcast is a simple CPI/PPI blend — swap in the Cleveland Fed inflation-nowcasting feed for a sharper estimate.

For internal research use — not investment advice.
