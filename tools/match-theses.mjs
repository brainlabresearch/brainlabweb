#!/usr/bin/env node
/**
 * Finds each alumni thesis in RIT's institutional repository and links its title
 * to the record.
 *
 *   node tools/match-theses.mjs           # report matches, change nothing
 *   node tools/match-theses.mjs --write   # rewrite people.html with the links
 *
 * Run this only when alumni with a THESIS are added — not on a schedule. It
 * harvests ~11,000 records, and a thesis URL never changes once assigned, so
 * there is nothing to keep in sync.
 *
 * WHY HARVEST RATHER THAN SEARCH. repository.rit.edu runs Digital Commons. Its
 * search page is a JavaScript Solr client — fetching /do/search/?q=… returns a
 * shell that says "No results" no matter the query, and the JSON endpoints the
 * page's own scripts use are not reachable from outside. OAI-PMH is the
 * supported machine interface, so that is what this uses.
 *
 * IT MUST USE THE qdc METADATA FORMAT, not oai_dc.
 *
 * bepress keeps two unrelated numbering schemes. The OAI header identifier
 * carries an internal article number — oai:...:theses-1005 — while the public
 * page for that same record is /theses/21. There is no offset between them:
 * landing page /theses/12482 is article 13617. Deriving the URL from the header
 * produced links that were confidently wrong rather than broken — /theses/12707
 * was a real page, just somebody else's thesis about B2B cybersecurity sales.
 *
 * oai_dc gives only the PDF path under /context/, which 403s outside a browser.
 * qdc puts the actual landing page in dc:identifier, which is what this reads.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = resolve(ROOT, 'people.html');
const CACHE = resolve(ROOT, 'tools/.theses-cache.json');
const WRITE = process.argv.includes('--write');

const OAI = 'https://repository.rit.edu/do/oai/';
const UA = 'brainlabresearch.org thesis linker';

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/&amp;/g, '&').replace(/&#0?39;|[’']/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function harvest() {
  if (existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    console.log(`using cached harvest: ${c.length} records (delete tools/.theses-cache.json to refresh)`);
    return c;
  }

  const out = [];
  let url = `${OAI}?verb=ListRecords&metadataPrefix=qdc&set=publication:theses`;
  let page = 0;

  while (url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`OAI returned ${res.status}`);
    const xml = await res.text();

    for (const rec of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
      const body = rec[1];
      /* In qdc, dc:identifier IS the public landing page. Do not substitute the
         number from the OAI header — that is a different sequence entirely. */
      const url = (body.match(/<dc:identifier>(https:\/\/repository\.rit\.edu\/theses\/\d+)<\/dc:identifier>/) || [])[1];
      const title = (body.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1];
      if (!url || !title) continue;
      const creators = [...body.matchAll(/<dc:creator>([\s\S]*?)<\/dc:creator>/g)].map((m) => m[1]);
      out.push({ url, title: title.trim(), creators });
    }

    const tok = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/);
    page++;
    process.stdout.write(`\r  harvested ${out.length} records (page ${page})`);
    url = tok ? `${OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(tok[1])}` : null;
    if (url) await sleep(400);          // be polite to a public endpoint
  }

  process.stdout.write('\n');
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const records = await harvest();

/* Index by normalised title. */
const byTitle = new Map();
for (const r of records) {
  const k = norm(r.title);
  if (!byTitle.has(k)) byTitle.set(k, r);
}

let html = readFileSync(PAGE, 'utf8');
const rows = [...html.matchAll(/<div class="alum">[\s\S]*?<\/div>/g)].map((m) => m[0]);

let matched = 0, missed = 0, already = 0;

for (const row of rows) {
  const deg = (row.match(/<span class="deg">([^<]*)<\/span>/) || [])[1] || '';
  if (!/Thesis/.test(deg)) continue;                       // projects are not deposited

  const who = (row.match(/<span class="who">([^<]*)/) || [])[1] || '';
  const thMatch = row.match(/<span class="th">([\s\S]*?)<\/span>/);
  if (!thMatch) continue;
  if (/<a /.test(thMatch[1])) { already++; continue; }

  const title = thMatch[1];
  const hit = byTitle.get(norm(title));

  if (!hit) {
    console.log(`  MISS  ${who.padEnd(22)} ${title.slice(0, 58)}`);
    missed++;
    continue;
  }

  /* Guard against a same-title collision by another author: the surname must
     appear among the record's creators. */
  const surname = who.trim().split(/\s+/).pop().toLowerCase();
  const ok = hit.creators.some((c) => c.toLowerCase().includes(surname));
  if (!ok) {
    console.log(`  SKIP  ${who.padEnd(22)} title matched but creators are ${hit.creators.join('; ')}`);
    missed++;
    continue;
  }

  const url = hit.url;
  console.log(`  ok    ${who.padEnd(22)} -> ${url}`);
  matched++;

  if (WRITE) {
    const linked = row.replace(
      /<span class="th">([\s\S]*?)<\/span>/,
      `<span class="th"><a href="${url}">$1</a></span>`,
    );
    html = html.replace(row, linked);
  }
}

console.log(`\nmatched ${matched}, missed ${missed}, already linked ${already}`);
if (WRITE) { writeFileSync(PAGE, html); console.log('people.html updated'); }
else console.log('(dry run — pass --write to apply)');
