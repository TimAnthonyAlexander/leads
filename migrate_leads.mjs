// migrate_leads.mjs - Clean legacy leads.csv from .com.com bugs and aggregators
import { parse as parseDomain } from 'tldts';
import { format } from '@fast-csv/format';
import * as fs from 'fs';

const LEADS_FILE = 'leads.csv';
const BACKUP_FILE = 'leads.csv.backup';

// Aggregators and platforms to skip
const SKIP_DOMAINS = new Set([
  'github.com', 'substack.com', 'steampowered.com', 'medium.com',
  'wordpress.com', 'blogspot.com', 'tumblr.com', 'wixsite.com',
  'marketplace.visualstudio.com', 'chrome.google.com', 'addons.mozilla.org'
]);

// Multi-tenant platforms - dedupe by full hostname
const MULTI_TENANT_SUFFIXES = [
  'vercel.app', 'netlify.app', 'github.io', 'herokuapp.com',
  'azurewebsites.net', 'cloudfront.net', 'amplifyapp.com',
  'web.app', 'firebaseapp.com', 'pages.dev'
];

function getCanonical(hostname) {
  const p = parseDomain(hostname);
  const regDomain = p.hostname || hostname;
  
  const isMultiTenant = MULTI_TENANT_SUFFIXES.some(suffix => hostname.endsWith(suffix));
  return isMultiTenant ? hostname : regDomain;
}

function shouldSkip(hostname) {
  const p = parseDomain(hostname);
  const regDomain = p.hostname || hostname;
  return SKIP_DOMAINS.has(regDomain);
}

if (!fs.existsSync(LEADS_FILE)) {
  console.error('No leads.csv found. Nothing to migrate.');
  process.exit(0);
}

// Backup original
fs.copyFileSync(LEADS_FILE, BACKUP_FILE);
console.error(`Backed up ${LEADS_FILE} to ${BACKUP_FILE}`);

const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n');
const validLeads = new Map();
let dropped = 0;
let duplicates = 0;
let aggregators = 0;
let buggedDomains = 0;

// Skip header and any non-CSV lines at the top
let headerIdx = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('discovered_at,')) {
    headerIdx = i;
    break;
  }
}

if (headerIdx === 0 && !lines[0].startsWith('discovered_at,')) {
  console.error('No valid CSV header found');
  process.exit(1);
}

// Process each line
for (let i = headerIdx + 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const parts = line.split(',');
  if (parts.length < 3) continue;
  
  const oldCanonical = parts[2];
  
  // Skip bugged domains (.com.com, .app.app, etc.)
  if (oldCanonical.match(/\.(com|app|org|io|co|in|dev)\.?\1$/)) {
    buggedDomains++;
    dropped++;
    continue;
  }
  
  // Try to extract hostname from source_url to re-canonicalize
  const sourceUrl = parts[1];
  let hostname;
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch {
    // If source_url is invalid, skip this lead
    dropped++;
    continue;
  }
  
  // Skip aggregators
  if (shouldSkip(hostname)) {
    aggregators++;
    dropped++;
    continue;
  }
  
  // Re-canonicalize correctly
  const correctCanonical = getCanonical(hostname);
  
  // Deduplicate - keep earliest discovery
  if (validLeads.has(correctCanonical)) {
    duplicates++;
    dropped++;
    continue;
  }
  
  // Store with corrected canonical
  parts[2] = correctCanonical;
  validLeads.set(correctCanonical, parts.join(','));
}

// Write cleaned CSV
const out = format({ headers: true });
const outFile = fs.createWriteStream(LEADS_FILE);
out.pipe(outFile);

// Write header
const header = {
  discovered_at: 'discovered_at',
  source_url: 'source_url',
  canonical: 'canonical',
  title: 'title',
  status: 'status',
  score: 'score',
  has_pricing: 'has_pricing',
  has_docs: 'has_docs',
  has_signup: 'has_signup',
  has_changelog: 'has_changelog',
  has_privacy: 'has_privacy',
  has_terms: 'has_terms',
  emails: 'emails'
};

// Write valid leads
for (const [canonical, line] of validLeads) {
  const parts = line.split(',');
  out.write({
    discovered_at: parts[0],
    source_url: parts[1],
    canonical: parts[2],
    title: parts[3],
    status: parts[4],
    score: parts[5],
    has_pricing: parts[6],
    has_docs: parts[7],
    has_signup: parts[8],
    has_changelog: parts[9],
    has_privacy: parts[10],
    has_terms: parts[11],
    emails: parts.slice(12).join(',')
  });
}

out.end();

console.error(`\nMigration complete:`);
console.error(`  Valid leads preserved: ${validLeads.size}`);
console.error(`  Dropped (total): ${dropped}`);
console.error(`    - Bugged domains (.com.com, etc.): ${buggedDomains}`);
console.error(`    - Aggregators (GitHub, Substack, etc.): ${aggregators}`);
console.error(`    - Duplicates: ${duplicates}`);
console.error(`\nOriginal backed up to ${BACKUP_FILE}`);

