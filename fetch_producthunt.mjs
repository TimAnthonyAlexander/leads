// fetch_producthunt.mjs - Scrape newest products from Product Hunt using headless browser
import { chromium } from 'playwright';
import * as fs from 'fs';

const OUTPUT_FILE = 'producthunt_urls.txt';
const CACHE_FILE = '.cache/producthunt_cache.json';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Check cache first
if (fs.existsSync(CACHE_FILE)) {
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const age = Date.now() - cache.timestamp;
  
  if (age < CACHE_TTL) {
    console.error(`✓ Using cached Product Hunt data (${Math.round(age / 1000 / 60)} minutes old)`);
    fs.writeFileSync(OUTPUT_FILE, cache.urls.join('\n'));
    console.error(`✓ Wrote ${cache.urls.length} URLs to ${OUTPUT_FILE}`);
    process.exit(0);
  }
}

console.error('🌐 Launching headless browser to scrape Product Hunt...');

const productUrls = new Set();

let browser;
try {
  // Launch headless Chromium
  browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  // Navigate to Product Hunt
  console.error('📄 Loading Product Hunt homepage...');
  await page.goto('https://www.producthunt.com/', { 
    waitUntil: 'domcontentloaded',
    timeout: 30000 
  });
  
  // Wait for content to load
  await page.waitForTimeout(5000);
  
  // Scroll to load more products
  console.error('📜 Scrolling to load more products...');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(2000);
  }
  
  // Extract product links with multiple strategies
  console.error('🔍 Extracting product links...');
  
  const links = await page.evaluate(() => {
    const productLinks = [];
    const productWebsites = [];
    
    // Strategy 1: Look for /posts/ links (old structure)
    const postLinks = Array.from(document.querySelectorAll('a[href*="/posts/"]'));
    for (const link of postLinks) {
      const href = link.getAttribute('href');
      if (href && href.match(/^\/posts\/[a-z0-9-]+$/)) {
        productLinks.push(`https://www.producthunt.com${href}`);
      }
    }
    
    // Strategy 2: Look for /products/ links (possible new structure)
    const productPageLinks = Array.from(document.querySelectorAll('a[href*="/products/"]'));
    for (const link of productPageLinks) {
      const href = link.getAttribute('href');
      if (href && href.match(/^\/products\/[a-z0-9-]+$/)) {
        productLinks.push(`https://www.producthunt.com${href}`);
      }
    }
    
    // Strategy 3: Find product cards/items and extract both PH link and direct website
    // Look for common patterns in product listings
    const cards = Array.from(document.querySelectorAll('[class*="product"], [class*="item"], [data-test*="product"]'));
    for (const card of cards) {
      // Find PH product link within card
      const phLink = card.querySelector('a[href*="/posts/"], a[href*="/products/"]');
      if (phLink) {
        const href = phLink.getAttribute('href');
        if (href && (href.match(/^\/(posts|products)\/[a-z0-9-]+$/) || href.match(/^https:\/\/www\.producthunt\.com\/(posts|products)\/[a-z0-9-]+$/))) {
          const cleanHref = href.startsWith('http') ? href : `https://www.producthunt.com${href}`;
          productLinks.push(cleanHref);
        }
      }
      
      // Find external website link within card
      const externalLink = card.querySelector('a[href^="http"]:not([href*="producthunt.com"])');
      if (externalLink) {
        const href = externalLink.href;
        if (href && 
            !href.includes('twitter.com') &&
            !href.includes('facebook.com') &&
            !href.includes('linkedin.com') &&
            !href.includes('instagram.com') &&
            !href.includes('youtube.com')) {
          productWebsites.push(href);
        }
      }
    }
    
    // Debug: Return some info about what we found
    const allLinksCount = document.querySelectorAll('a').length;
    const postsLinksCount = document.querySelectorAll('a[href*="/posts/"]').length;
    const productsLinksCount = document.querySelectorAll('a[href*="/products/"]').length;
    const externalLinksCount = document.querySelectorAll('a[href^="http"]:not([href*="producthunt.com"])').length;
    
    return { 
      productLinks: [...new Set(productLinks)], // Dedupe
      productWebsites: [...new Set(productWebsites)],
      debug: { allLinksCount, postsLinksCount, productsLinksCount, externalLinksCount }
    };
  });
  
  console.error(`   Debug: ${links.debug.allLinksCount} total links, ${links.debug.postsLinksCount} "/posts/", ${links.debug.productsLinksCount} "/products/", ${links.debug.externalLinksCount} external`);
  console.error(`✓ Found ${links.productLinks.length} product posts, ${links.productWebsites.length} direct product URLs`);
  
  // Add any direct product websites we found
  if (links.productWebsites.length > 0) {
    console.error('✓ Found direct product URLs from homepage');
    links.productWebsites.forEach(url => productUrls.add(url));
  }
  
  // If we have product posts/pages, visit them to get the actual websites
  if (links.productLinks.length > 0) {
    console.error(`📦 Visiting ${Math.min(links.productLinks.length, 15)} product pages to extract websites...`);
    
    let processed = 0;
    for (const productPost of links.productLinks.slice(0, 15)) { // Limit to 15
      try {
        const productName = productPost.split('/').pop();
        console.error(`  ${processed + 1}/${Math.min(links.productLinks.length, 15)}: ${productName}`);
        
        await page.goto(productPost, { 
          waitUntil: 'domcontentloaded',
          timeout: 15000 
        });
        
        await page.waitForTimeout(2000);
        
        // Extract the product website - look for actual URL in content, not just links
        const productWebsite = await page.evaluate(() => {
          // Strategy 1: Look in structured data / meta tags
          const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
          const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
          
          // Strategy 2: Look for website URL in visible text (common pattern)
          const bodyText = document.body.innerText;
          const urlMatch = bodyText.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/gi);
          if (urlMatch) {
            for (const match of urlMatch) {
              const url = match.startsWith('http') ? match : `https://${match}`;
              if (!url.includes('producthunt.com') &&
                  !url.includes('cloudflare.com') &&
                  !url.includes('twitter.com') &&
                  !url.includes('x.com') &&
                  !url.includes('facebook.com') &&
                  !url.includes('linkedin.com')) {
                return url;
              }
            }
          }
          
          // Strategy 3: Look for links labeled as "website" or "visit"
          const buttons = Array.from(document.querySelectorAll('a'));
          for (const btn of buttons) {
            const text = btn.textContent.toLowerCase();
            const href = btn.href;
            
            if ((text.includes('visit') || text.includes('website')) &&
                href &&
                !href.includes('producthunt.com') &&
                !href.includes('cloudflare.com')) {
              return href;
            }
          }
          
          // Strategy 4: First external link that's not social/cloudflare
          const externalLinks = Array.from(document.querySelectorAll('a[href^="http"]'))
            .filter(a => !a.href.includes('producthunt.com') &&
                        !a.href.includes('cloudflare.com') &&
                        !a.href.includes('twitter.com') &&
                        !a.href.includes('x.com') &&
                        !a.href.includes('facebook.com') &&
                        !a.href.includes('linkedin.com'));
          
          return externalLinks.length > 0 ? externalLinks[0].href : null;
        });
        
        if (productWebsite && !productWebsite.includes('cloudflare.com')) {
          // Clean tracking params
          let cleanUrl = productWebsite;
          try {
            const url = new URL(productWebsite);
            url.searchParams.delete('ref');
            url.searchParams.delete('utm_source');
            url.searchParams.delete('utm_medium');
            url.searchParams.delete('utm_campaign');
            cleanUrl = url.toString();
          } catch {}
          
          productUrls.add(cleanUrl);
          console.error(`    ✓ ${cleanUrl.split('/')[2]}`);
        } else {
          console.error(`    ⚠ No website found${productWebsite && productWebsite.includes('cloudflare') ? ' (cloudflare blocked)' : ''}`);
        }
        
        processed++;
        await page.waitForTimeout(800); // Politeness delay
        
      } catch (error) {
        console.error(`    ✗ Error: ${error.message}`);
      }
    }
  }
  
  // If still no URLs, try fallback
  if (productUrls.size === 0) {
    console.error('⚠️  No products found, trying fallback extraction...');
    
    const directUrls = await page.evaluate(() => {
      const urls = [];
      const externalLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
      for (const link of externalLinks) {
        const href = link.href;
        if (href && 
            !href.includes('producthunt.com') &&
            !href.includes('twitter.com') &&
            !href.includes('x.com') &&
            !href.includes('facebook.com') &&
            !href.includes('linkedin.com') &&
            !href.includes('instagram.com') &&
            !href.includes('youtube.com') &&
            !href.includes('google.com') &&
            !href.includes('lu.ma')) {
          urls.push(href);
        }
      }
      return urls;
    });
    
    console.error(`✓ Found ${directUrls.length} fallback URLs`);
    directUrls.slice(0, 20).forEach(url => productUrls.add(url));
    
    await browser.close();
    
    const urlList = Array.from(productUrls);
    fs.writeFileSync(OUTPUT_FILE, urlList.join('\n'));
    
    if (!fs.existsSync('.cache')) {
      fs.mkdirSync('.cache', { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      urls: urlList
    }));
    
    console.error(`\n✅ Scraped ${urlList.length} Product Hunt product websites (fallback method)`);
    console.error(`✓ Wrote to ${OUTPUT_FILE}`);
    console.error(`✓ Cached results for 6 hours`);
    process.exit(0);
  }
  
  await browser.close();
  
} catch (error) {
  console.error(`\n❌ Error scraping Product Hunt: ${error.message}`);
  if (browser) await browser.close();
  
  // Create empty file so the pipeline doesn't break
  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.writeFileSync(OUTPUT_FILE, '');
  }
  process.exit(1);
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

console.error(`\n✅ Scraped ${urlList.length} Product Hunt product websites`);
console.error(`✓ Wrote to ${OUTPUT_FILE}`);
console.error(`✓ Cached results for 6 hours`);
