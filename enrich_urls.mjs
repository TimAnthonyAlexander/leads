// enrich_urls.mjs - Enhanced lead enrichment with weighted ICP scoring
import { parse as parseDomain } from 'tldts';
import { format } from '@fast-csv/format';
import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import {
  WEIGHTS, DEV_SIGNALS, TEAM_SIGNALS, PRICING_MODELS, THRESHOLDS,
  BUILDER_DOMAINS, SKIP_DOMAINS, MULTI_TENANT_SUFFIXES
} from './scoring_config.mjs';

// Cache directory
const CACHE_DIR = '.cache';
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load existing leads to avoid reprocessing and preserve discovery dates
const existingLeads = new Map();
const LEADS_FILE = 'leads.csv';
const FILTERED_FILE = 'leads_filtered.csv';

if (fs.existsSync(LEADS_FILE)) {
  const lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length > 2) {
      const canonical = parts[3]; // canonical is 4th column in new schema
      if (canonical) {
        // Filter aggregators from existing leads
        try {
          const url = new URL(parts[2]); // source_url
          if (!shouldSkip(url.hostname)) {
            existingLeads.set(canonical, { line });
          }
        } catch {
          // Keep existing lead if URL parsing fails
          existingLeads.set(canonical, { line });
        }
      }
    }
  }
  console.error(`Loaded ${existingLeads.size} existing leads from ${LEADS_FILE}`);
}

const out = format({ headers: true });
out.pipe(process.stdout);

const filteredOut = format({ headers: true });
const filteredStream = fs.createWriteStream(FILTERED_FILE);
filteredOut.pipe(filteredStream);

// Load URLs from input files
const urls = new Set();
const sourceMap = new Map(); // Track which source each URL came from
for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) continue;
  const source = file.replace('_urls.txt', '').replace('.txt', '');
  fs.readFileSync(file, 'utf8').split('\n').forEach(l => {
    const u = l.trim();
    if (!u) return;
    try { 
      new URL(u); 
      urls.add(u);
      sourceMap.set(u, source);
    } catch {}
  });
}

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

function isBuilder(hostname) {
  const p = parseDomain(hostname);
  const regDomain = p.hostname || hostname;
  return BUILDER_DOMAINS.has(regDomain);
}

// Cache key generator
function getCacheKey(canonical, path) {
  const date = new Date().toISOString().split('T')[0]; // Daily cache
  const hash = crypto.createHash('md5').update(`${canonical}${path}${date}`).digest('hex').slice(0, 8);
  return `${CACHE_DIR}/${canonical.replace(/[^a-z0-9]/gi, '_')}_${path.replace(/\//g, '_')}_${hash}.cache`;
}

// Cached fetch
async function fetchHtml(u, timeoutMs = 7000, useCache = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  
  // Check cache for subpage requests
  if (useCache) {
    try {
      const url = new URL(u);
      const cacheKey = getCacheKey(url.hostname, url.pathname);
      if (fs.existsSync(cacheKey)) {
        const cached = JSON.parse(fs.readFileSync(cacheKey, 'utf8'));
        const age = Date.now() - cached.timestamp;
        if (age < 7 * 24 * 60 * 60 * 1000) { // 7 days TTL
          return { status: cached.status, html: cached.html, cached: true };
        }
      }
    } catch {}
  }
  
  try {
    const r = await fetch(u, { 
      redirect: 'follow', 
      signal: ctrl.signal, 
      headers: { 'User-Agent': 'Lead-Harvester/1.0 (Ventasso outreach tool)' } 
    });
    const html = await r.text();
    const result = { status: r.status, html, cached: false };
    
    // Cache subpage results
    if (useCache && r.status >= 200 && r.status < 400) {
      try {
        const url = new URL(u);
        const cacheKey = getCacheKey(url.hostname, url.pathname);
        fs.writeFileSync(cacheKey, JSON.stringify({
          status: r.status,
          html: html.slice(0, 200000), // Cap cached HTML size
          timestamp: Date.now()
        }));
      } catch {}
    }
    
    return result;
  } catch {
    return { status: 0, html: '', cached: false };
  } finally {
    clearTimeout(t);
  }
}

function decodeHtmlEntities(text) {
  return text
    // URL-encoded entities
    .replace(/u003e/gi, '>')
    .replace(/u003c/gi, '<')
    .replace(/u0026/gi, '&')
    .replace(/u0022/gi, '"')
    .replace(/u0027/gi, "'")
    // HTML entities
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // Strip leading/trailing angle brackets and spaces
    .replace(/^[\s<>]+|[\s<>]+$/g, '');
}

function extractEmails(text) {
  const decoded = decodeHtmlEntities(text);
  const m = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!m) return [];
  
  const bad = [
    'noreply@', 'no-reply@', 'donotreply@', 'do-not-reply@',
    'you@example.com', 'your@email.com', 'email@domain.com',
    'test@example.com', 'user@example.com', 'name@example.com',
    '@example.com', 'example@', 'test@test.com', 'email@email.com',
    'info@', 'admin@', 'webmaster@', 'postmaster@'
  ];
  
  const emails = [...new Set(m.filter(e => {
    const lower = e.toLowerCase();
    return !bad.some(b => lower.includes(b) || lower === b);
  }))];
  
  // Sort by confidence: personal > team > support > generic
  const sorted = emails.sort((a, b) => {
    const getScore = (email) => {
      const lower = email.toLowerCase();
      if (lower.includes('support@')) return 2;
      if (lower.includes('contact@')) return 2;
      if (lower.includes('hello@')) return 3;
      if (lower.includes('team@')) return 3;
      return 4; // Personal or unknown (highest confidence)
    };
    return getScore(b) - getScore(a);
  });
  
  return sorted.slice(0, 5);
}

function getEmailConfidence(emails) {
  if (!emails || emails.length === 0) return 'none';
  const first = emails[0].toLowerCase();
  if (first.includes('support@') || first.includes('contact@')) return 'medium';
  if (first.includes('hello@') || first.includes('team@')) return 'high';
  return 'high'; // Personal email
}

// Weighted scoring function
function scoreContent(html, title, sourceUrl) {
  const text = (html + ' ' + title).toLowerCase();
  let weightedScore = 0;
  const detectedSignals = { dev: [], team: [], launch: [], negative: [] };
  
  // Scan for all weighted tokens
  for (const [token, weight] of Object.entries(WEIGHTS)) {
    const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(text)) {
      weightedScore += weight;
      
      // Categorize signals
      if (DEV_SIGNALS.includes(token)) {
        detectedSignals.dev.push(token);
      } else if (TEAM_SIGNALS.includes(token)) {
        detectedSignals.team.push(token);
      } else if (weight < 0) {
        detectedSignals.negative.push(token);
      } else if (['show hn', 'product hunt', 'beta', 'launching'].includes(token)) {
        detectedSignals.launch.push(token);
      }
    }
  }
  
  // Detect specific flags for backward compatibility
  const flags = {
    pricing: /\bpricing\b/i.test(text),
    docs: /\b(docs|documentation|api reference)\b/i.test(text),
    signup: /\b(signup|sign up|get started|register)\b/i.test(text),
    changelog: /\bchangelog\b/i.test(text),
    api: /\b(api|rest api|graphql)\b/i.test(text),
    webhook: /\bwebhook/i.test(text),
    cli: /\b(cli|command line)\b/i.test(text),
    sdk: /\bsdk\b/i.test(text),
    careers: /\b(careers|hiring|we're hiring|join us)\b/i.test(text),
    privacy: /\b(privacy policy|\/privacy)\b/i.test(text),
    terms: /\b(terms of service|\/terms)\b/i.test(text)
  };
  
  // Check thresholds
  const hasDevSignal = detectedSignals.dev.length > 0;
  const hasTeamCue = detectedSignals.team.length > 0;
  const meetsMinimum = weightedScore >= THRESHOLDS.minimum_score;
  
  let passed = meetsMinimum;
  let filterReason = '';
  
  if (!meetsMinimum) {
    filterReason = 'below_threshold';
    passed = false;
  } else if (THRESHOLDS.require_dev_signal && !hasDevSignal) {
    filterReason = 'no_dev_signal';
    passed = false;
  } else if (THRESHOLDS.require_team_cue && !hasTeamCue) {
    filterReason = 'no_team_cue';
    passed = false;
  }
  
  // Detect pricing model
  let pricingModel = '';
  for (const [model, patterns] of Object.entries(PRICING_MODELS)) {
    if (patterns.some(p => text.includes(p))) {
      pricingModel = model;
      break;
    }
  }
  
  return {
    weightedScore,
    flags,
    detectedSignals,
    passed,
    filterReason,
    pricingModel,
    teamCue: detectedSignals.team[0] || '',
    hasDevSignal,
    hasTeamCue
  };
}

// Extract value proposition
function extractValueProp($, html) {
  // Try h1 first
  let valueProp = $('h1').first().text().trim();
  
  // Try meta description
  if (!valueProp || valueProp.length < 10) {
    valueProp = $('meta[name="description"]').attr('content') || '';
  }
  
  // Try og:description
  if (!valueProp || valueProp.length < 10) {
    valueProp = $('meta[property="og:description"]').attr('content') || '';
  }
  
  // Try first significant paragraph
  if (!valueProp || valueProp.length < 10) {
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20 && text.length < 200) {
        valueProp = text;
        return false; // Break
      }
    });
  }
  
  return valueProp.slice(0, 120).trim();
}

// Detect team size and careers
function detectTeamSignals($, html) {
  const text = html.toLowerCase();
  const hasCareers = /\b(careers|jobs|hiring|join us|we're hiring)\b/i.test(text);
  
  // Try to estimate team size from about/team pages
  let teamSizeEstimate = 'unknown';
  const teamMembers = $('img[alt*="team"]').length + $('div[class*="team"] img').length;
  
  if (teamMembers === 0) teamSizeEstimate = '0';
  else if (teamMembers <= 3) teamSizeEstimate = '1-3';
  else if (teamMembers <= 10) teamSizeEstimate = '4-10';
  else teamSizeEstimate = '10+';
  
  return { hasCareers, teamSizeEstimate };
}

// Extract contact channels
function extractContactChannels($, html) {
  const channels = [];
  
  // Contact form
  if ($('form[action*="contact"]').length > 0 || $('a[href*="/contact"]').length > 0) {
    const contactLink = $('a[href*="/contact"]').attr('href');
    if (contactLink) channels.push(`form:${contactLink}`);
  }
  
  // Discord
  const discordLink = $('a[href*="discord.gg"], a[href*="discord.com/invite"]').attr('href');
  if (discordLink) channels.push(`discord:${discordLink}`);
  
  // Slack
  const slackLink = $('a[href*="slack.com"]').attr('href');
  if (slackLink) channels.push(`slack:${slackLink}`);
  
  // Intercom
  if (html.includes('intercom') || html.includes('Intercom')) {
    channels.push('intercom:detected');
  }
  
  // Calendly
  const calendlyLink = $('a[href*="calendly.com"]').attr('href');
  if (calendlyLink) channels.push(`calendly:${calendlyLink}`);
  
  return channels.join(' | ');
}

// Calculate freshness score
function calculateFreshness(discoveredAt, html, title, sourceUrl) {
  let score = 0;
  const text = (html + ' ' + title).toLowerCase();
  const age = Date.now() - new Date(discoveredAt).getTime();
  const daysOld = age / (24 * 60 * 60 * 1000);
  
  // Age bonus
  if (daysOld < 7) score += 3;
  else if (daysOld < 14) score += 2;
  else if (daysOld < 30) score += 1;
  
  // Launch indicators
  if (/\b(show hn|product hunt)\b/i.test(sourceUrl)) score += 2;
  if (/\b(launching|just launched|announcing)\b/i.test(text)) score += 1;
  if (/\b(beta|early access|coming soon)\b/i.test(text)) score += 1;
  
  let context = '';
  if (/show\s+hn/i.test(sourceUrl)) context = 'Show HN';
  else if (/producthunt/i.test(sourceUrl)) context = 'Product Hunt';
  else if (/\b(beta|early access)\b/i.test(text)) context = 'Beta';
  else if (daysOld < 7) context = 'New';
  
  return { freshnessScore: Math.min(score, 5), launchContext: context };
}

// Generate personalization seed
function generatePersonalizationSeed(signals, flags, pricingModel, launchContext) {
  const hooks = [];
  
  if (launchContext) {
    hooks.push(`I saw your ${launchContext} launch`);
  }
  
  if (signals.dev.length > 0) {
    const devSignal = signals.dev[0];
    hooks.push(`noticed your ${devSignal}`);
  }
  
  if (pricingModel === 'per_seat' || pricingModel === 'per_workspace') {
    hooks.push(`per-seat pricing suggests team collaboration focus`);
  }
  
  if (flags.api && flags.webhook) {
    hooks.push(`API-first with webhook support`);
  }
  
  if (signals.team.length > 0) {
    hooks.push(`${signals.team[0]} for teams`);
  }
  
  if (hooks.length === 0) {
    hooks.push(`interesting SaaS product`);
  }
  
  return hooks.slice(0, 2).join(', ');
}

// Resolve GitHub repos to actual websites
async function resolveGitHubRepo(html, repoUrl) {
  const $ = cheerio.load(html);
  const links = $('a[href^="http"]').map((_, el) => $(el).attr('href')).get();
  
  for (const link of links) {
    try {
      const url = new URL(link);
      const p = parseDomain(url.hostname);
      const regDomain = p.hostname;
      
      if (regDomain !== 'github.com' && 
          regDomain !== 'twitter.com' && 
          regDomain !== 'linkedin.com' &&
          !url.hostname.startsWith('www.google.')) {
        return link;
      }
    } catch {}
  }
  
  return null;
}

// Process URLs
const newLeads = [];
const filteredLeads = [];
const stats = {
  processed: 0,
  skipped: 0,
  filtered: {
    aggregator: 0,
    builder: 0,
    below_threshold: 0,
    no_dev_signal: 0,
    no_team_cue: 0,
    other: 0
  },
  sources: {}
};

for (const u of urls) {
  const urlObj = new URL(u);
  const hostname = urlObj.hostname;
  const source = sourceMap.get(u) || 'unknown';
  
  // Track source stats
  stats.sources[source] = (stats.sources[source] || 0) + 1;
  
  // Skip aggregators
  if (shouldSkip(hostname)) {
    stats.filtered.aggregator++;
    continue;
  }
  
  const canonical = getCanonical(hostname);
  const p = parseDomain(hostname);
  const regDomain = p.hostname || hostname;
  
  // Skip existing
  if (existingLeads.has(canonical)) {
    stats.skipped++;
    continue;
  }
  
  // Resolve GitHub repos
  if (regDomain === 'github.com' && !shouldSkip(hostname)) {
    const first = await fetchHtml(u);
    if (!first.html) continue;
    
    const externalUrl = await resolveGitHubRepo(first.html, u);
    if (externalUrl) {
      urls.add(externalUrl);
      sourceMap.set(externalUrl, source);
    }
    stats.filtered.aggregator++;
    continue;
  }
  
  // Fetch homepage
  const home = `https://${canonical}`;
  const first = await fetchHtml(u);
  const page = first.html ? first : await fetchHtml(home);
  if (!page.html) continue;

  const $ = cheerio.load(page.html);
  const title = ($('title').first().text() || '').trim().slice(0, 200);
  const mail = extractEmails(page.html);
  
  // Probe subpages (with caching)
  const probes = ['/pricing', '/docs', '/documentation', '/api', '/changelog', '/contact', '/about', '/team', '/careers', '/legal', '/privacy'];
  let extraHtml = '';
  for (const probePath of probes) {
    try {
      const r = await fetchHtml(new URL(probePath, home).href, 5000, true); // Use cache
      if (r.status >= 200 && r.status < 400) {
        extraHtml += r.html.slice(0, 100000);
      }
      // Politeness delay (but not if cached)
      if (!r.cached) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch {}
  }

  // Score the content
  const allHtml = page.html + extraHtml;
  const scoring = scoreContent(allHtml, title, u);
  const allEmails = [...new Set([...mail, ...extractEmails(extraHtml)])];
  const emailConfidence = getEmailConfidence(allEmails);
  
  // Extract enrichment data
  const valueProp = extractValueProp($, page.html);
  const teamSignals = detectTeamSignals($, allHtml);
  const contactChannels = extractContactChannels($, allHtml);
  const freshness = calculateFreshness(new Date().toISOString(), allHtml, title, u);
  const personalizationSeed = generatePersonalizationSeed(
    scoring.detectedSignals, 
    scoring.flags, 
    scoring.pricingModel, 
    freshness.launchContext
  );
  
  // Check if builder platform
  const builderPenalty = isBuilder(hostname) ? -5 : 0;
  const finalScore = scoring.weightedScore + builderPenalty;
  
  const lead = {
    discovered_at: new Date().toISOString(),
    source,
    source_url: u,
    canonical,
    title,
    value_prop: valueProp,
    status: first.status || 0,
    weighted_score: finalScore,
    has_pricing: scoring.flags.pricing ? 1 : 0,
    has_docs: scoring.flags.docs ? 1 : 0,
    has_signup: scoring.flags.signup ? 1 : 0,
    has_changelog: scoring.flags.changelog ? 1 : 0,
    has_api: scoring.flags.api ? 1 : 0,
    has_webhook: scoring.flags.webhook ? 1 : 0,
    has_cli: scoring.flags.cli ? 1 : 0,
    has_sdk: scoring.flags.sdk ? 1 : 0,
    team_cue: scoring.teamCue,
    pricing_model: scoring.pricingModel,
    has_careers: teamSignals.hasCareers ? 1 : 0,
    team_size_estimate: teamSignals.teamSizeEstimate,
    freshness_score: freshness.freshnessScore,
    launch_context: freshness.launchContext,
    emails: allEmails.slice(0, 5).join(' | '),
    email_confidence: emailConfidence,
    contact_channels: contactChannels,
    personalization_seed: personalizationSeed,
    filter_reason: ''
  };
  
  // Apply filters
  if (isBuilder(hostname) && finalScore < THRESHOLDS.minimum_score) {
    stats.filtered.builder++;
    lead.filter_reason = 'builder_platform';
    filteredLeads.push(lead);
  } else if (!scoring.passed) {
    stats.filtered[scoring.filterReason]++;
    lead.filter_reason = scoring.filterReason;
    filteredLeads.push(lead);
  } else {
    newLeads.push(lead);
    stats.processed++;
  }
}

// Output stats
console.error(`\n=== Lead Harvesting Stats ===`);
console.error(`Sources: ${Object.entries(stats.sources).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.error(`Dedupe: ${stats.skipped} already processed`);
console.error(`Filtered: ${stats.filtered.aggregator} aggregators, ${stats.filtered.below_threshold} below threshold, ${stats.filtered.no_dev_signal} no dev signals, ${stats.filtered.no_team_cue} no team cues, ${stats.filtered.builder} builders`);
console.error(`Enriched: ${stats.processed} new leads`);
if (newLeads.length > 0) {
  const topScore = Math.max(...newLeads.map(l => l.weighted_score));
  const avgScore = (newLeads.reduce((sum, l) => sum + l.weighted_score, 0) / newLeads.length).toFixed(1);
  const topLead = newLeads.find(l => l.weighted_score === topScore);
  console.error(`Top score: ${topScore} (${topLead.canonical})`);
  console.error(`Avg score: ${avgScore}`);
}

// Write existing leads (preserve discovery dates)
for (const [canonical, data] of existingLeads) {
  const parts = data.line.split(',');
  // Old schema had 13 columns, new has 27 - need to handle both
  if (parts.length >= 13) {
    // Try to preserve old format data
    out.write({
      discovered_at: parts[0] || '',
      source: parts[1] || 'legacy',
      source_url: parts[2] || '',
      canonical: parts[3] || canonical,
      title: parts[4] || '',
      value_prop: parts[5] || '',
      status: parts[6] || 0,
      weighted_score: parts[7] || 0,
      has_pricing: parts[8] || 0,
      has_docs: parts[9] || 0,
      has_signup: parts[10] || 0,
      has_changelog: parts[11] || 0,
      has_api: parts[12] || 0,
      has_webhook: parts[13] || 0,
      has_cli: parts[14] || 0,
      has_sdk: parts[15] || 0,
      team_cue: parts[16] || '',
      pricing_model: parts[17] || '',
      has_careers: parts[18] || 0,
      team_size_estimate: parts[19] || 'unknown',
      freshness_score: parts[20] || 0,
      launch_context: parts[21] || '',
      emails: parts[22] || '',
      email_confidence: parts[23] || 'none',
      contact_channels: parts[24] || '',
      personalization_seed: parts[25] || '',
      filter_reason: ''
    });
  }
}

// Write new leads
for (const lead of newLeads) {
  out.write(lead);
}

out.end();

// Write filtered leads
for (const lead of filteredLeads) {
  filteredOut.write(lead);
}

filteredOut.end();

console.error(`\n✓ leads.csv updated with ${newLeads.length} new leads`);
console.error(`✓ leads_filtered.csv updated with ${filteredLeads.length} filtered leads`);
