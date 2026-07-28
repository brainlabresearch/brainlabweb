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

const esc = (s) => String(s ?? '')
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
    'cited_by_count',
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

function renderWork(w) {
  const source = w.primary_location?.source?.display_name;
  const venue = source
    ? source + (w.type === 'preprint' ? ' · preprint' : '')
    : (TYPE_LABEL[w.type] ?? '');
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
          ${venue ? `<p class="venue">${esc(venue)}</p>` : ''}
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

  const years = works.map((w) => w.publication_year).filter(Boolean);
  const range = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';

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
    <p>${works.length} publications${range ? `, ${range}` : ''} — memristive learning circuits, spiking network hardware, reservoir computing, and the adversarial robustness of neuromorphic systems.</p>
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
const works = tidy(raw);
mkdirSync(dirname(CONFIG.out), { recursive: true });
writeFileSync(CONFIG.out, renderPage(works), 'utf8');

const dropped = raw.length - works.length;
console.log(`fetched ${raw.length} records from OpenAlex`);
console.log(`wrote   ${works.length} publications to ${CONFIG.out}`);
if (dropped > 0) console.log(`dropped ${dropped} (duplicates, preprints of published work, and non-article types)`);
