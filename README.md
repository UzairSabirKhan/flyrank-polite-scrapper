# Books to Scrape - Polite Scraper Pipeline

A deterministic, schema-checked web scraper built with Node.js, Cheerio, and Zod that extracts the first 3 catalogue pages (60 books) from the Books to Scrape sandbox.

## Target Classification & Ethics
- **Target**: `https://books.toscrape.com` (public scraping sandbox)
- **Robots.txt Check**: HTTP 404 (No robots file found).
- **Ethics Policy**: Only target declared sandboxes; use official APIs when available; never bypass logins or paywalls; collect only required fields; check rules before scraping any new target.
- **Browser-free Justification**: The static HTML contains all required data directly from the server response; running a headless browser would only add unnecessary compute overhead and bandwidth.

## How to Install & Run

```bash
pnpm install
pnpm start
```

## Politeness Policies
1. **Honest User-Agent**: Identifies the bot with a contact link.
2. **Request Delays**: Waits at least 500ms between live network requests.
3. **Local Cache**: HTML pages are cached in `cache/` during development to prevent redundant hits.
4. **Timeout**: 5000ms max request timeout with a single retry on server (5xx) or timeout errors.

## Data Schema (Zod)
Every record contains:
- `title` (string)
- `product_url` (canonical HTTPS URL)
- `price_text` (raw string, e.g. "£51.77")
- `price_gbp` (numeric float, e.g. 51.77)
- `availability_text` (string)
- `rating_text` (string)
- `description` (string or null)
- `source_page` (provenance URL)
- `fetched_at` (ISO timestamp)

## Run Report Evidence

```json
{
  "startTime": "2026-09-28T21:14:39.314Z",
  "duration_ms": 50186,
  "catalogue_pages": 3,
  "discovered_urls": 60,
  "unique_urls": 60,
  "detail_pages_attempted": 61,
  "cache_hits": 0,
  "network_fetches": 63,
  "valid_records": 60,
  "invalid_records": 0,
  "failed_pages": 1
}
```