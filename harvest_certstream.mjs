// harvest_certstream.mjs
import WebSocket from 'ws';
import { parse as parseDomain } from 'tldts';
import { format } from '@fast-csv/format';

const TLD_ALLOW = new Set(['app','dev','io','ai','so','tech']);
const KEYWORDS = ['pricing','changelog','docs','documentation','signup','sign up','login','get started'];
const out = format({ headers: true });
out.pipe(process.stdout);

function baseDomain(host) {
  const p = parseDomain(host);
  // p.hostname is the correct registrable domain
  return p.hostname || null;
}

async function probe(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = (await r.text()).slice(0, 200000).toLowerCase();
    const hit = KEYWORDS.reduce((acc, k) => ({ ...acc, [k.replace(/\s+/g,'_')]: html.includes(k) }), {});
    const title = (html.match(/<title>([^<]{1,200})<\/title>/)?.[1] || '').trim();
    return { ok: true, status: r.status, title, ...hit };
  } catch {
    return { ok: false, status: 0, title: '' };
  } finally {
    clearTimeout(t);
  }
}

const seen = new Set();
const ws = new WebSocket('wss://certstream.calidog.io/');
ws.on('message', async msg => {
  try {
    const data = JSON.parse(msg);
    if (data.message_type !== 'certificate_update') return;
    const names = data.data?.leaf_cert?.all_domains || [];
    for (const n of names) {
      if (!n || n.startsWith('*.')) continue;
      const bd = baseDomain(n);
      if (!bd) continue;
      const tld = bd.split('.').pop();
      if (!TLD_ALLOW.has(tld)) continue;
      if (seen.has(bd)) continue;
      seen.add(bd);

      const https = `https://${bd}`;
      const r = await probe(https);
      if (!r.ok) continue;

      out.write({
        source: 'certstream',
        discovered_at: new Date().toISOString(),
        domain: bd,
        url: https,
        status: r.status,
        title: r.title,
        has_pricing: r.pricing ? 1 : 0,
        has_docs: r.docs || r.documentation ? 1 : 0,
        has_signup: r.signup || r.sign_up || r.get_started ? 1 : 0,
        has_changelog: r.changelog ? 1 : 0
      });
    }
  } catch {}
});
