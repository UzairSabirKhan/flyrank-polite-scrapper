import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { z } from "zod";

// Configuration & Politeness Constants
const BASE_URL = "https://books.toscrape.com/";
const START_URL = "https://books.toscrape.com/catalogue/page-1.html";
const USER_AGENT =
  "FlyRankInternship-A9/1.0 (+https://github.com/flyrank-student/scraper)";
const TIMEOUT_MS = 5000;
const DELAY_MS = 500;
const MAX_CATALOGUE_PAGES = 3;

const CACHE_DIR = path.resolve("cache");
const OUTPUT_DIR = path.resolve("output");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Stage 4: Zod Validation Schema
const BookSchema = z.object({
  title: z.string().min(1),
  product_url: z.string().url().startsWith("https://"),
  price_text: z.string().min(1),
  price_gbp: z.number().positive(),
  availability_text: z.string().min(1),
  rating_text: z.string().min(1),
  description: z.string().nullable(),
  source_page: z.string().url(),
  fetched_at: z.string().datetime(),
});

// Run reporting metrics
const metrics = {
  startTime: new Date().toISOString(),
  duration_ms: 0,
  catalogue_pages: 0,
  discovered_urls: 0,
  unique_urls: 0,
  detail_pages_attempted: 0,
  cache_hits: 0,
  network_fetches: 0,
  valid_records: 0,
  invalid_records: 0,
  failed_pages: 0,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFilename(url) {
  return url.replace(/[^a-zA-Z0-9]/g, "_") + ".html";
}

// Stage 1 & 5: Polite fetch with local cache, timeout, and single retry on 5xx/timeout
async function politeFetch(url, isRetry = false) {
  const cachePath = path.join(CACHE_DIR, sanitizeFilename(url));

  if (fs.existsSync(cachePath)) {
    metrics.cache_hits++;
    const html = fs.readFileSync(cachePath, "utf-8");
    return { html, fromCache: true, status: 200 };
  }

  await delay(DELAY_MS);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    clearTimeout(timeoutId);

    // Never retry 404 or 403
    if (response.status === 404 || response.status === 403) {
      throw new Error(`Terminal HTTP status: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP Error status: ${response.status}`);
    }

    const html = await response.text();
    fs.writeFileSync(cachePath, html, "utf-8");
    metrics.network_fetches++;

    return { html, fromCache: false, status: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    if (!isRetry && (err.name === "AbortError" || err.message.includes("5"))) {
      console.warn(`[WARN] Fetch failed for ${url}. Retrying once...`);
      await delay(1000);
      return politeFetch(url, true);
    }
    throw err;
  }
}

async function run() {
  const start = Date.now();
  const discoveredBookUrls = [];
  let currentUrl = START_URL;

  // Stage 2: Discover first 3 catalogue pages
  while (currentUrl && metrics.catalogue_pages < MAX_CATALOGUE_PAGES) {
    metrics.catalogue_pages++;
    console.log(`[CATALOGUE] Page ${metrics.catalogue_pages}: ${currentUrl}`);

    const { html, fromCache } = await politeFetch(currentUrl);
    console.log(
      `  -> ${fromCache ? "CACHE HIT" : "FETCH"} (${Buffer.byteLength(html, "utf8")} bytes)`,
    );

    const $ = cheerio.load(html);

    // Collect product URLs
    $("article.product_pod h3 a").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const absoluteUrl = new URL(href, currentUrl).href;
        discoveredBookUrls.push(absoluteUrl);
      }
    });

    // Follow "next" link if available
    const nextHref = $("li.next a").attr("href");
    currentUrl = nextHref ? new URL(nextHref, currentUrl).href : null;
  }

  metrics.discovered_urls = discoveredBookUrls.length;
  const uniqueBookUrls = [...new Set(discoveredBookUrls)];
  metrics.unique_urls = uniqueBookUrls.length;

  console.log(
    `Catalogue complete: pages=${metrics.catalogue_pages}, discovered=${metrics.discovered_urls}, unique_urls=${metrics.unique_urls}`,
  );

  // Stage 5 Demonstration: Intentionally append 1 fake URL to prove fault tolerance
  const executionList = [
    ...uniqueBookUrls,
    "https://books.toscrape.com/catalogue/broken-book-sample-999/index.html",
  ];

  const validRecords = [];
  const invalidRecords = [];

  // Stage 3 & 4: Extract, Normalize, Validate
  for (const bookUrl of executionList) {
    metrics.detail_pages_attempted++;
    try {
      const { html } = await politeFetch(bookUrl);
      const $ = cheerio.load(html);

      const productMain = $("article.product_page");
      if (!productMain.length) {
        throw new Error("Not a valid product detail page");
      }

      const title = productMain.find("h1").text().trim();
      const price_text = productMain.find("p.price_color").text().trim();
      const availability_text = productMain
        .find("p.availability")
        .text()
        .trim()
        .replace(/\s+/g, " ");

      const ratingClass = productMain.find("p.star-rating").attr("class") || "";
      const rating_text =
        ratingClass.replace("star-rating", "").trim() || "None";

      const description =
        $("#product_description").next("p").text().trim() || null;

      // Stage 4: Normalize price ("£51.77" -> 51.77)
      const cleanPrice = parseFloat(price_text.replace(/[^0-9.]/g, ""));

      const rawRecord = {
        title,
        product_url: bookUrl,
        price_text,
        price_gbp: isNaN(cleanPrice) ? null : cleanPrice,
        availability_text,
        rating_text,
        description,
        source_page: bookUrl,
        fetched_at: new Date().toISOString(),
      };

      const validationResult = BookSchema.safeParse(rawRecord);

      if (validationResult.success) {
        validRecords.push(validationResult.data);
      } else {
        invalidRecords.push({
          url: bookUrl,
          errors: validationResult.error.format(),
        });
      }
    } catch (err) {
      console.warn(
        `[WARN] Page processing failed for ${bookUrl}: ${err.message}`,
      );
      metrics.failed_pages++;
    }
  }

  const uniqueRecordsMap = new Map();
  for (const item of validRecords) {
    uniqueRecordsMap.set(item.product_url, item);
  }
  const finalizedRecords = Array.from(uniqueRecordsMap.values());

  metrics.valid_records = finalizedRecords.length;
  metrics.invalid_records = invalidRecords.length;
  metrics.duration_ms = Date.now() - start;

  // Store output JSON files
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "books.json"),
    JSON.stringify(finalizedRecords, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "errors.json"),
    JSON.stringify(invalidRecords, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "run-report.json"),
    JSON.stringify(metrics, null, 2),
    "utf-8",
  );

  console.log(`Pipeline finished in ${metrics.duration_ms}ms.`);
  console.log(
    `Saved: valid=${metrics.valid_records} in books.json, failed=${metrics.failed_pages}, invalid=${metrics.invalid_records}`,
  );
}

run().catch((err) => {
  console.error("Fatal pipeline error:", err);
  process.exit(1);
});
