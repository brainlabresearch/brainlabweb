#!/usr/bin/env node
/**
 * Regenerates publications.html from OpenAlex.
 *
 *   node tools/fetch-publications.mjs
 *
 * No dependencies, no API key. OpenAlex is a free, open index of scholarly
 * works; unlike Google Scholar it has a real API that permits automated access,
 * which is why the data comes from here rather than from Scholar directly.
 *
 * The generated file is committed like any other page. Re-run it whenever a new
 * paper lands, or let .github/workflows/publications.yml do it on a schedule.
 *
 * NOTE: the nav and footer below are copies of the ones in the other pages, the
 * same way those four duplicate each other. If you change the nav site-wide,
 * change it here too or this page will drift.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  // Cory Merkel has two OpenAlex records (a split identity). Both are pulled and
  // the results de-duplicated. If a third ever appears, add it here.
  authorIds: ['A5079020868', 'A5136052479'],
  // OpenAlex asks for a contact address; it buys you a faster, more reliable
  // request pool. It is not authentication and is not secret.
  mailto: 'c.merkel87@gmail.com',
  out: resolve(ROOT, 'publications.html'),
  // Names to embolden in the author list.
  highlight: [/merkel/i],

  // OpenAlex disambiguates authors automatically and sometimes merges records
  // belonging to different people with the same name. Anything published before
  // this year is somebody else. (The giveaway that prompted this: a 1985 NASA
  // report on wind power stations in West Germany.)
  minYear: 2008,

  // Specific OpenAlex work IDs to suppress — for misattributions that fall
  // inside the year range and so survive the filter above. Add the bare ID,
  // e.g. 'W2054210942'.
  excludeIds: new Set([]),
  // Work types worth showing. OpenAlex also emits "paratext" (tables of
  // contents, front matter) and "conference-abstract", which are noise on a
  // publications page.
  //
  // Careful here: OpenAlex names conference papers "conference-paper", NOT
  // "proceedings-article". Getting that wrong silently drops roughly half the
  // list. Both spellings are accepted below in case the vocabulary shifts.
  keepTypes: new Set([
    'article', 'preprint', 'book', 'book-chapter', 'dissertation', 'report',
    'conference-paper', 'proceedings-article',
  ]),
};

// Crossref hands back titles that are ALREADY HTML-encoded ("Computing in
// Science &amp; Engineering"), and occasionally double-encoded. Escaping those
// again produces visible "&amp;amp;" on the page, so decode to plain text first
// and then escape exactly once. The loop handles the double-encoded cases.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  let out = String(s ?? '');
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => ENTITIES[e.toLowerCase()])
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
    if (next === out) break;
    out = next;
  }
  return out;
}

const esc = (s) => decodeEntities(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Titles vary in punctuation and case between sources; normalise before
// comparing so a preprint and its published version collapse into one entry.
const normTitle = (t) => String(t ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function fetchAll() {
  const filter = `author.id:${CONFIG.authorIds.join('|')}`;
  const select = [
    'id', 'doi', 'title', 'publication_year', 'publication_date', 'type',
    'primary_location', 'best_oa_location', 'open_access', 'authorships',
    'cited_by_count', 'biblio',
  ].join(',');

  const works = [];
  let cursor = '*';
  while (cursor) {
    const url = 'https://api.openalex.org/works'
      + `?filter=${encodeURIComponent(filter)}`
      + `&select=${select}&per-page=200&cursor=${encodeURIComponent(cursor)}`
      + `&mailto=${encodeURIComponent(CONFIG.mailto)}`;

    const res = await fetch(url, { headers: { 'User-Agent': `brainlabresearch.org (${CONFIG.mailto})` } });
    if (!res.ok) throw new Error(`OpenAlex returned ${res.status} ${res.statusText}`);
    const data = await res.json();
    works.push(...data.results);
    cursor = data.meta?.next_cursor ?? null;
    if (!data.results.length) break;
  }
  return works;
}

/**
 * OpenAlex is missing the venue for about half of these papers — it has no
 * proceedings record for many IEEE and ACM conferences. Crossref, which is the
 * registration agency behind the DOIs themselves, has all of them, plus volume,
 * issue, and page numbers. So Crossref is the authority for the citation line
 * and OpenAlex is the fallback.
 *
 * One request per DOI. Crossref rate-limits hard: at six concurrent requests it
 * returned 429 for well over a third of them, and because a failed lookup falls
 * back silently to OpenAlex, the only visible symptom was a suspiciously low
 * venue count. Hence the low concurrency, the retry on 429, and the explicit
 * count of failures printed at the end — a silent degradation here looks exactly
 * like "OpenAlex just doesn't have the data".
 */
let crossrefFailures = 0;

async function crossrefGet(url, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': `brainlabresearch.org (mailto:${CONFIG.mailto})` } });
    if (res.status !== 429) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
  return null;
}

async function enrich(works) {
  const cite = async (w) => {
    const oa = {
      venue: w.primary_location?.source?.display_name ?? null,
      volume: w.biblio?.volume ?? null,
      issue: w.biblio?.issue ?? null,
      first: w.biblio?.first_page ?? null,
      last: w.biblio?.last_page ?? null,
    };
    if (!w.doi) return { ...w, cite: oa };

    try {
      const doi = String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
      const res = await crossrefGet(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(CONFIG.mailto)}`);
      if (!res || !res.ok) { crossrefFailures++; return { ...w, cite: oa }; }
      const m = (await res.json()).message ?? {};

      const container = (m['container-title'] ?? []).find(Boolean) ?? m.event?.name ?? null;
      const [first, last] = String(m.page ?? '').split(/[-–]/);
      return {
        ...w,
        cite: {
          venue: container ?? oa.venue,
          volume: m.volume ?? oa.volume,
          issue: m.issue ?? oa.issue,
          first: first || oa.first,
          last: last || oa.last,
        },
      };
    } catch {
      crossrefFailures++;
      return { ...w, cite: oa };
    }
  };

  const out = [];
  const BATCH = 2;
  for (let i = 0; i < works.length; i += BATCH) {
    out.push(...await Promise.all(works.slice(i, i + BATCH).map(cite)));
    process.stdout.write(`\r  enriching from Crossref… ${Math.min(i + BATCH, works.length)}/${works.length}`);
  }
  process.stdout.write('\n');
  return out;
}

function tidy(works) {
  const kept = works.filter((w) =>
    w.title
    && CONFIG.keepTypes.has(w.type)
    && (w.publication_year ?? 0) >= CONFIG.minYear
    && !CONFIG.excludeIds.has(String(w.id).replace('https://openalex.org/', '')));

  // De-duplicate on the normalised title. Title is the primary key rather than
  // DOI because the case that matters most is a preprint and its published
  // version, which have DIFFERENT DOIs but the same title — keying on DOI would
  // never collapse them. Where two records collide, keep the better one: a
  // published version beats a preprint, a record with a DOI beats one without,
  // and citation count breaks the remaining ties.
  const better = (a, b) => {
    if ((a.type === 'preprint') !== (b.type === 'preprint')) return a.type === 'preprint' ? b : a;
    if ((a.doi ? 1 : 0) !== (b.doi ? 1 : 0)) return a.doi ? a : b;
    return (b.cited_by_count ?? 0) > (a.cited_by_count ?? 0) ? b : a;
  };

  const byKey = new Map();
  for (const w of kept) {
    const key = normTitle(w.title) || w.doi?.toLowerCase() || w.id;
    byKey.set(key, byKey.has(key) ? better(byKey.get(key), w) : w);
  }
  const unique = [...byKey.values()];

  unique.sort((a, b) =>
    (b.publication_date ?? '').localeCompare(a.publication_date ?? '')
    || (b.publication_year ?? 0) - (a.publication_year ?? 0));

  return unique;
}

function authorLine(w) {
  const names = (w.authorships ?? []).map((a) => a.author?.display_name ?? a.raw_author_name).filter(Boolean);
  if (!names.length) return '';
  const shown = names.length > 12 ? [...names.slice(0, 12), '…'] : names;
  return shown
    .map((n) => (CONFIG.highlight.some((re) => re.test(n)) ? `<b>${esc(n)}</b>` : esc(n)))
    .join(', ');
}

// OpenAlex has no proceedings record for a lot of IEEE conference papers, so
// roughly half the list would otherwise show no venue at all. Falling back to
// the work type keeps every entry informative — a reader can still tell a
// journal article from a conference paper. (The locations[] array is NOT used
// as a fallback: it tends to yield institutional repository names, which read
// as venues but aren't.)
const TYPE_LABEL = {
  'article': 'Journal article',
  'conference-paper': 'Conference paper',
  'proceedings-article': 'Conference paper',
  'book-chapter': 'Book chapter',
  'preprint': 'Preprint',
  'report': 'Report',
  'book': 'Book',
  'dissertation': 'Dissertation',
};

/** "Neurocomputing, vol. 381, no. 2, pp. 89–106" — parts omitted when unknown. */
function citation(w) {
  const c = w.cite ?? {};
  const name = c.venue ?? TYPE_LABEL[w.type] ?? '';
  if (!name) return '';

  const bits = [];
  if (c.volume) bits.push(`vol. ${esc(c.volume)}`);
  if (c.issue) bits.push(`no. ${esc(c.issue)}`);
  if (c.first && c.last && c.first !== c.last) bits.push(`pp. ${esc(c.first)}–${esc(c.last)}`);
  else if (c.first) bits.push(`p. ${esc(c.first)}`);
  if (w.type === 'preprint') bits.push('preprint');

  return `<em>${esc(name)}</em>${bits.length ? `<span class="biblio">, ${bits.join(', ')}</span>` : ''}`;
}

function renderWork(w) {
  const venue = citation(w);
  const doiUrl = w.doi;
  const oaUrl = w.best_oa_location?.pdf_url ?? w.open_access?.oa_url;

  const links = [];
  if (doiUrl) links.push(`<a href="${esc(doiUrl)}">DOI</a>`);
  if (oaUrl && oaUrl !== doiUrl) links.push(`<a href="${esc(oaUrl)}">PDF</a>`);

  const titleHtml = doiUrl
    ? `<a href="${esc(doiUrl)}">${esc(w.title)}</a>`
    : esc(w.title);

  return `      <div class="pub">
        <div>
          <h4>${titleHtml}</h4>
          <p class="authors">${authorLine(w)}</p>
          ${venue ? `<p class="venue">${venue}</p>` : ''}
        </div>
        ${links.length ? `<div class="links">${links.join('')}</div>` : '<div class="links"></div>'}
      </div>`;
}

function renderPage(works) {
  const byYear = new Map();
  for (const w of works) {
    const y = w.publication_year ?? 'Undated';
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(w);
  }

  const body = [...byYear.entries()].map(([year, items]) => `
      <div class="pub-year">${esc(year)}</div>
${items.map(renderWork).join('\n')}`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publications — Brain Lab</title>
<meta name="description" content="Peer-reviewed publications from the Brain Lab on neuromorphic hardware, memristive learning circuits, spiking neural networks, and the robustness of neuromorphic systems.">
<link rel="canonical" href="https://www.brainlabresearch.org/publications.html">
<meta property="og:title" content="Publications — Brain Lab">
<meta property="og:description" content="Papers on neuromorphic hardware, memristive learning circuits, spiking neural networks, and adversarial robustness.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node tools/fetch-publications.mjs -->

<nav class="nav" id="nav">
  <div class="nav-in">
    <a class="brand" href="index.html">BRAIN LAB <span>RESEARCH</span></a>
    <div class="nav-links">
      <a href="research.html">Research</a>
      <a href="people.html">People</a>
      <a href="news.html">News</a>
      <a href="publications.html" aria-current="page">Publications</a>
      <a href="index.html#join" class="nav-cta">Join us</a>
    </div>
  </div>
</nav>

<header class="pagehead">
  <canvas id="raster" aria-hidden="true"></canvas>
  <div class="wrap">
    <div class="eyebrow">Publications</div>
    <h1>The work</h1>
  </div>
</header>

<main id="main">
<section class="sec wrap reveal">
${body}

  <p style="margin-top:34px" class="pub-count">Indexed via OpenAlex · also on
    <a href="https://scholar.google.com/citations?hl=en&amp;user=YnhtWqYAAAAJ&amp;view_op=list_works&amp;sortby=pubdate">Google Scholar</a>
  </p>
</section>
</main>

<footer>
  <div class="wrap">
    <div class="foot">
      <div>
        <div class="foot-mark">BRAIN LAB</div>
        <p style="color:var(--muted);max-width:34ch;font-size:15px">Neuroscience, machine learning, and the hardware in between.</p>
      </div>
      <div>
        <h5>Find us</h5>
        <p>Rochester, New York</p>
      </div>
      <div>
        <h5>Elsewhere</h5>
        <a href="mailto:cemeec@rit.edu">cemeec@rit.edu</a>
        <a href="https://www.linkedin.com/company/ritbrainlab">LinkedIn</a>
        <a href="https://twitter.com/ritbrainlab">X / Twitter</a>
        <a href="https://scholar.google.com/citations?hl=en&amp;user=YnhtWqYAAAAJ&amp;view_op=list_works&amp;sortby=pubdate">Google Scholar</a>
      </div>
    </div>
    <div class="colophon">
      <span>© Brain Lab</span>
    </div>
  </div>
</footer>

<script src="assets/js/site.js"></script>
</body>
</html>
`;
}

const raw = await fetchAll();
console.log(`fetched ${raw.length} records from OpenAlex`);
const works = await enrich(tidy(raw));

const dropped = raw.length - works.length;
const named = works.filter((w) => w.cite?.venue).length;
const coverage = works.length ? named / works.length : 0;

/**
 * Refuse to publish a page that has lost its citation lines.
 *
 * Crossref rate-limits cloud IPs far harder than a laptop. A scheduled run on a
 * GitHub runner got through the entire enrichment pass in four seconds, which is
 * only possible if essentially every lookup was turned away. Since failures fall
 * back to OpenAlex silently and the script still exited 0, that run was one
 * green news step away from committing a page with half its venues missing,
 * under a commit message that reads like a routine refresh.
 *
 * The floor is checked against the outcome rather than against crossrefFailures:
 * what matters is whether the page is good, not how it got that way. OpenAlex
 * alone covers about half of these papers and a healthy run covers all but one,
 * so neither case lands anywhere near 90%.
 *
 * Exit 3 rather than 1, and note that publications.html is left untouched. The
 * workflow distinguishes the two: a degraded run must not abort the job, because
 * this is the first of three refresh steps and failing here would also strand
 * the news and topic updates that come after it. It lets those finish and commit
 * before failing the run at the end. Any other non-zero exit is a real error and
 * stops the job where it happens.
 */
const FLOOR = 0.9;
const DEGRADED_EXIT = 3;
if (coverage < FLOOR && !process.env.ALLOW_DEGRADED) {
  console.error(`\nDEGRADED  only ${named}/${works.length} entries (${Math.round(coverage * 100)}%) have a venue; expected at least ${FLOOR * 100}%.`);
  console.error(`          ${crossrefFailures} Crossref lookups failed, which usually means rate limiting.`);
  console.error('          publications.html is unchanged — the previous version stands.');
  console.error('          Re-run to pick them up, or set ALLOW_DEGRADED=1 to publish as-is.');
  process.exit(DEGRADED_EXIT);
}

mkdirSync(dirname(CONFIG.out), { recursive: true });
writeFileSync(CONFIG.out, renderPage(works), 'utf8');

console.log(`wrote   ${works.length} publications to ${CONFIG.out}`);
if (dropped > 0) console.log(`dropped ${dropped} (duplicates, preprints of published work, and non-article types)`);
console.log(`venues  ${named}/${works.length} have a named journal or conference`);
if (crossrefFailures > 0) {
  console.warn(`WARNING ${crossrefFailures} Crossref lookups failed even after retrying — those entries`);
  console.warn(`        fall back to OpenAlex and may show no venue. Re-run to pick them up.`);
}
