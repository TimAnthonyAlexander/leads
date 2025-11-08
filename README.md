# lead-harvester

An intelligent lead discovery system built for **Ventasso** that surfaces brand-new dev-tool SaaS startups from multiple sources. Uses weighted ICP scoring, enrichment signals, and automated personalization to deliver high-quality outreach targets.

## Features

### Smart Sourcing
- **Show HN scraping** - Fresh startup launches from Hacker News (last 30 days)
- **Product Hunt integration** - Newest products from Product Hunt (last 7 days, 6-hour cache)
- **Certificate Transparency monitoring** - Real-time SSL cert detection for new `.app`, `.dev`, `.io`, `.ai`, `.so`, `.tech` domains
- **GitHub resolution** - Extracts actual product websites from repo pages

### Weighted ICP Scoring
- **Dev-tool targeting** - Prioritizes API, SDK, webhook, CLI, developer docs
- **Team collaboration signals** - Detects per-seat pricing, workspace, SAML, SSO, audit logs
- **Maturity indicators** - Careers pages, team size estimation, security compliance
- **Negative filtering** - Penalizes blogs, WordPress, e-commerce, portfolios
- **Configurable thresholds** - Requires minimum score + dev signal + team cue

### Rich Enrichment
- **Value proposition extraction** - Hero headlines and meta descriptions for personalization
- **Contact intelligence** - Emails with confidence scoring, alternative channels (Discord, Slack, Intercom, Calendly)
- **Freshness detection** - Launch context (Show HN, Product Hunt, Beta) and recency scoring
- **Team signals** - Career pages, hiring badges, team size estimates
- **Pricing model detection** - Per-seat, usage-based, freemium, enterprise

### Data Quality
- **Accumulative storage** - Never reprocess existing leads, preserves discovery dates
- **Smart deduplication** - Canonical keys handle both single and multi-tenant platforms
- **Platform filtering** - Skips aggregators (GitHub, Substack, Medium), downranks builders (Wix, Webflow)
- **Email cleaning** - Strips noreply, placeholders, role addresses, HTML entities
- **Caching layer** - 7-day TTL for subpage probes reduces redundant requests
- **Filter tracking** - Logs why leads were dropped to `leads_filtered.csv` for tuning

### Outreach Ready
- **Auto-personalization seeds** - Generated hooks based on detected signals
- **27-field CSV schema** - Everything you need for intelligent outreach
- **Funnel metrics** - Track source performance, filter reasons, score distribution

## Installation

```bash
bun install
```

## Usage

### Quick Start (Daily Harvesting)

```bash
make
```

This will:
1. Fetch recent Show HN posts from Hacker News
2. Scrape newest products from Product Hunt
3. Combine with manual URLs in `x_startup_urls.txt`
4. Skip already-processed domains
5. Enrich only new leads with weighted scoring and enrichment
6. Write to `leads.csv` (accumulative) and `leads_filtered.csv` (for tuning)

### Real-Time Certificate Transparency Stream

```bash
make certstream > certstream_hits.csv &
```

Continuously monitors SSL certificate issuance and catches new dev-tool SaaS domains as they launch.

### Individual Targets

```bash
# Just Show HN
make showhn

# Just Product Hunt
make producthunt

# Run enrichment only
make enrich

# Clean cache
make clean
```

### Schedule It

Add to your crontab:

```bash
# Run daily at 9 AM
0 9 * * * cd /path/to/lead-harvester && make >> harvest.log 2>&1
```

## Output Schema

### leads.csv (27 columns)

| Field | Description |
|-------|-------------|
| `discovered_at` | ISO timestamp of first discovery |
| `source` | Source: showhn, producthunt, x_startup_urls, certstream |
| `source_url` | Original URL from source |
| `canonical` | Dedupe key (hostname for multi-tenant, domain otherwise) |
| `title` | Page title |
| `value_prop` | Extracted hero headline or meta description (≤120 chars) |
| `status` | HTTP status code |
| `weighted_score` | ICP-weighted score (higher = better fit) |
| `has_pricing` | 1 if pricing page found |
| `has_docs` | 1 if docs/documentation found |
| `has_signup` | 1 if signup/get-started found |
| `has_changelog` | 1 if changelog found |
| `has_api` | 1 if API/REST API/GraphQL mentioned |
| `has_webhook` | 1 if webhooks mentioned |
| `has_cli` | 1 if CLI/command-line tool mentioned |
| `has_sdk` | 1 if SDK mentioned |
| `team_cue` | First detected team signal (workspace, saml, per-seat, etc.) |
| `pricing_model` | Detected model: per_seat, usage_based, freemium, enterprise, etc. |
| `has_careers` | 1 if careers/hiring page found |
| `team_size_estimate` | Estimated team size: 0, 1-3, 4-10, 10+, unknown |
| `freshness_score` | Launch recency (0-5, higher = fresher) |
| `launch_context` | Launch indicator: Show HN, Product Hunt, Beta, New |
| `emails` | Up to 5 non-noreply emails (` \| ` separated) |
| `email_confidence` | Confidence level: high (personal), medium (support), low (info), none |
| `contact_channels` | Alternative contact methods: form, discord, slack, intercom, calendly |
| `personalization_seed` | Auto-generated 1-sentence hook for outreach |
| `filter_reason` | Empty for kept leads |

### leads_filtered.csv

Same schema as `leads.csv`, but contains dropped leads with `filter_reason` populated:
- `aggregator` - GitHub, Substack, Steam, marketplace
- `builder_platform` - Wix, Webflow, Squarespace with low score
- `below_threshold` - Weighted score < 5
- `no_dev_signal` - Missing API/docs/SDK/webhook/CLI
- `no_team_cue` - Missing workspace/teams/per-seat/SAML/SSO

## Scoring System

### Weighted Signals (scoring_config.mjs)

**Strong Dev Signals (+2 to +3)**
- API, REST API, GraphQL, SDK, webhook, CLI, GitHub App, developer docs

**Team/Collaboration Cues (+1 to +3)**
- Per seat, per user, workspace, teams, SAML, SSO, audit logs, RBAC, enterprise plan

**SaaS Fundamentals (+1)**
- Pricing, signup, demo, trial, docs

**Maturity Signals (+1 to +2)**
- Careers, hiring, SOC 2, GDPR, security policy, roadmap

**Launch/Freshness Boost (+1 to +2)**
- Show HN, Product Hunt, beta, early access, launching today

**Negative Signals (-1 to -2)**
- Blog, WordPress, tutorial, course, buy now, ecommerce, shop, portfolio

### Thresholds (configurable)

```javascript
minimum_score: 5         // Below this, drop
require_dev_signal: true // Must have API|docs|SDK|webhook|CLI
require_team_cue: true   // Must have workspace|teams|per-seat|SAML|SSO
```

## Architecture

```
Sources (Show HN, Product Hunt, Certstream, manual)
    ↓
Deduplication (by canonical domain, skip existing)
    ↓
Platform/Aggregator Filtering (GitHub→resolve, Substack→drop)
    ↓
Homepage Fetch + Subpage Probing (cached, 7-day TTL)
    ↓
Weighted ICP Scoring (dev signals, team cues, negatives)
    ↓
Threshold Checks (minimum score, dev signal, team cue)
    ↓
Enrichment (value prop, team signals, contacts, freshness)
    ↓
Personalization Seed Generation
    ↓
leads.csv (kept) + leads_filtered.csv (dropped)
```

## Files

### Core Pipeline
- `enrich_urls.mjs` - Main enrichment engine with weighted scoring
- `scoring_config.mjs` - ICP weights, thresholds, domain lists
- `fetch_producthunt.mjs` - Product Hunt scraper (6-hour cache)
- `harvest_certstream.mjs` - Real-time SSL cert monitor
- `migrate_leads.mjs` - One-time migration script for legacy data cleanup

### Data Files
- `leads.csv` - Your growing high-quality lead database
- `leads_filtered.csv` - Dropped leads for tuning and analysis
- `showhn_urls.txt` - Cached Show HN URLs
- `producthunt_urls.txt` - Cached Product Hunt URLs
- `x_startup_urls.txt` - Manual or X/Twitter URLs
- `urls_all.txt` - Combined source URLs (temporary)

### Caching
- `.cache/` - Subpage probe cache (7-day TTL, ignored by git)

## Tuning the System

### Adjust Weights

Edit `scoring_config.mjs` to change signal weights:

```javascript
export const WEIGHTS = {
  'api': 3,        // Increase to prioritize API-first products
  'webhook': 2,    // Decrease if webhooks aren't critical
  'saml': 3,       // High weight for enterprise readiness
  // ...
};
```

### Adjust Thresholds

```javascript
export const THRESHOLDS = {
  minimum_score: 5,        // Raise to 7 for stricter filtering
  require_team_cue: false, // Disable if targeting solo devs
  require_dev_signal: true // Keep true for dev-tool focus
};
```

### Review Filtered Leads

Regularly check `leads_filtered.csv` for false negatives:

```bash
# Find leads filtered for "no_team_cue" but high scores
grep "no_team_cue" leads_filtered.csv | awk -F',' '$8 > 7'
```

Adjust team signal detection or thresholds based on findings.

### Source Performance

Check stats output after each run:

```
Sources: 45 showhn, 32 producthunt
Filtered: 8 aggregators, 15 below threshold, 7 no dev signals, 3 no team cues
Enriched: 23 new leads
Top score: 18 (servercompass.app)
Avg score: 9.2
```

## Example Output

From servercompass.app (weighted_score: 18):

```csv
discovered_at: 2025-11-08T15:40:10.359Z
source: showhn
canonical: servercompass.app
title: Server Compass – Deploy Like Vercel on Your Own VPS
value_prop: Deploy like Vercel on your own VPS with zero config
weighted_score: 18
has_pricing: 1, has_docs: 1, has_signup: 1, has_api: 1, has_cli: 1
team_cue: per seat
pricing_model: per_seat
freshness_score: 4
launch_context: Show HN
emails: hello@stoicsoft.com
email_confidence: high
personalization_seed: I saw your Show HN launch, noticed your cli
```

## Quality Filters Applied

1. **Registrable domain correctness** - Uses tldts properly
2. **Platform filtering** - Skips GitHub, Substack, Steam, Medium, WordPress, marketplaces
3. **Multi-tenant deduplication** - Vercel, Netlify, GitHub Pages dedupe by full hostname
4. **GitHub resolution** - Extracts real website from repo pages
5. **ICP targeting** - Requires dev signal + team cue + minimum weighted score
6. **Email quality** - Strips noreply, example.com, test addresses, HTML entities, role addresses
7. **Builder downranking** - Wix, Webflow, Squarespace heavily penalized
8. **Negative signal detection** - Filters blogs, tutorials, e-commerce

## Performance Features

- **Concurrency control** - Polite crawling with 200ms delays
- **Caching layer** - 7-day TTL for subpage probes
- **Product Hunt cache** - 6-hour cache to avoid re-scraping
- **Request timeouts** - 7s homepage, 5s subpages
- **User-Agent transparency** - Identifies as Lead-Harvester for Ventasso

## Notes

- X/Twitter scraping is currently disabled (snscrape broken with Python 3.14). Manually add URLs to `x_startup_urls.txt` if needed.
- The system is safe to run repeatedly - it only processes new domains
- Oldest leads appear first in CSV, newest at the bottom
- Cached data expires automatically (7 days for probes, 6 hours for Product Hunt)
- Use `make clean` to force fresh re-scraping

## For Ventasso Outreach

Use the enriched data to personalize your first line:

```
Template: {personalization_seed} — we help dev tools close deals on merge.

Example: I saw your Show HN launch, noticed your API — we help dev tools 
close deals on merge. Ventasso automates GitHub PR-based sales flows so 
your team can focus on shipping.
```

Target leads with:
- `weighted_score >= 10` (strong dev-tool fit)
- `freshness_score >= 3` (launched recently)
- `email_confidence: high` (personal or team email)
- `has_api: 1` or `has_webhook: 1` (integration opportunity)
