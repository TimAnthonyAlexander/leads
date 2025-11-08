// fetch_producthunt.mjs - Scrape newest products from Product Hunt
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const OUTPUT_FILE = 'producthunt_urls.txt';
const CACHE_FILE = '.cache/producthunt_cache.json';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Check cache first
if (fs.existsSync(CACHE_FILE)) {
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const age = Date.now() - cache.timestamp;
  
  if (age < CACHE_TTL) {
    console.error(`Using cached Product Hunt data (${Math.round(age / 1000 / 60)} minutes old)`);
    fs.writeFileSync(OUTPUT_FILE, cache.urls.join('\n'));
    console.error(`✓ Wrote ${cache.urls.length} URLs to ${OUTPUT_FILE}`);
    process.exit(0);
  }
}

const urls = new Set();
const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

async function fetchPage(page = 1) {
  const url = page === 1 
    ? 'https://www.producthunt.com/'
    : `https://www.producthunt.com/?page=${page}`;
  
  console.error(`Fetching Product Hunt page ${page}...`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Lead-Harvester/1.0 (Ventasso outreach tool)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch page ${page}: ${response.status}`);
      return false;
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let foundProducts = 0;
    
    // Try multiple selectors for Product Hunt's structure
    // They frequently change their markup, so try several patterns
    
    // Look for product links
    $('a[href^="/posts/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.match(/^\/posts\/[a-z0-9-]+$/)) {
        const productUrl = `https://www.producthunt.com${href}`;
        if (!urls.has(productUrl)) {
          urls.add(productUrl);
          foundProducts++;
        }
      }
    });
    
    // Alternative: look for direct product website links if available
    $('a[href^="http"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      
      // Skip Product Hunt internal links and social media
      if (href && 
          !href.includes('producthunt.com') &&
          !href.includes('twitter.com') &&
          !href.includes('facebook.com') &&
          !href.includes('linkedin.com') &&
          !href.includes('instagram.com') &&
          text.includes('visit')) {
        try {
          new URL(href);
          urls.add(href);
          foundProducts++;
        } catch {}
      }
    });
    
    console.error(`  Found ${foundProducts} products on page ${page}`);
    return foundProducts > 0;
    
  } catch (error) {
    console.error(`Error fetching page ${page}:`, error.message);
    return false;
  }
}

// Fetch first 3 pages (roughly 7 days of products)
for (let page = 1; page <= 3; page++) {
  const success = await fetchPage(page);
  if (!success && page > 1) break; // Stop if page fails
  
  // Politeness delay
  if (page < 3) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// If we got Product Hunt post URLs, we need to extract the actual product websites
// For now, we'll fetch the product page and look for the external link
const productUrls = new Set();

for (const url of urls) {
  if (url.includes('producthunt.com/posts/')) {
    try {
      console.error(`Resolving product page: ${url}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Lead-Harvester/1.0 (Ventasso outreach tool)'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Look for the "Visit" or "Get it" link (main product website)
        let productWebsite = null;
        
        // Try common patterns
        $('a[href^="http"]').each((_, el) => {
          const href = $(el).attr('href');
          const text = $(el).text().toLowerCase();
          
          if ((text.includes('visit') || text.includes('get it') || text.includes('website')) &&
              href &&
              !href.includes('producthunt.com') &&
              !href.includes('twitter.com') &&
              !href.includes('facebook.com')) {
            productWebsite = href;
            return false; // Break
          }
        });
        
        // Alternative: look for redirect links
        if (!productWebsite) {
          const redirectLink = $('a[href*="/l/"]').first().attr('href');
          if (redirectLink) {
            productWebsite = redirectLink.includes('http') 
              ? redirectLink 
              : `https://www.producthunt.com${redirectLink}`;
          }
        }
        
        if (productWebsite) {
          productUrls.add(productWebsite);
        }
      }
      
      // Politeness delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (error) {
      console.error(`  Error resolving ${url}: ${error.message}`);
    }
  } else {
    // Already a direct product URL
    productUrls.add(url);
  }
}

// Write to file
const urlList = Array.from(productUrls);
fs.writeFileSync(OUTPUT_FILE, urlList.join('\n'));

// Cache the results
if (!fs.existsSync('.cache')) {
  fs.mkdirSync('.cache', { recursive: true });
}
fs.writeFileSync(CACHE_FILE, JSON.stringify({
  timestamp: Date.now(),
  urls: urlList
}));

console.error(`\n✓ Wrote ${urlList.length} Product Hunt URLs to ${OUTPUT_FILE}`);
console.error(`✓ Cached results for 6 hours`);

