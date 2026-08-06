#!/usr/bin/env node
/**
 * Rebuilds news.html (and the three-item summary on index.html) from RIT's news
 * search, limited to the last few years — see CONFIG.maxAgeYears.
 *
 *   node tools/fetch-news.mjs
 *
 * WHY THIS SOURCE. The ask was "anything on RIT news mentioning my name".
 *
 * This used to read https://www.rit.edu/brainlab/news, a curated per-lab index.
 * RIT retired that subsite — every path under /brainlab now 404s, including the
 * article URLs themselves — so that approach died outright. The articles all
 * survive under /news/<slug>, which is where this now points.
 *
 * The replacement source is RIT's news search, which despite an earlier note in
 * this file is NOT JavaScript-only: /news/news-stories?keys=… is a server-side
 * Drupal view that renders complete results, pager and all. Searching the
 * surname turns up every story naming him, which is strictly better than the old
 * lab index — that page listed 7 articles, this finds 12, some dating to 2014.
 *
 * Two wrinkles, both handled below:
 *
 *   - The results markup shares a page with promo/sidebar cards, so a raw href
 *     sweep picks up unrelated stories. Rather than guess at the container
 *     markup — which RIT can restyle at any time — every candidate is fetched
 *     and kept only if the article actually names him. See VERIFY.
 *   - The search index is not exhaustive: at least one story that names him in
 *     plain text is missing from it. Those go in PINNED.
 *
 * Anything published off rit.edu still goes in MANUAL.
 *
 * Everything the search reaches back to is then cut to a rolling age window, so
 * the finds below that horizon — the 2012–2018 stories — are deliberately not on
 * the page. Widen CONFIG.maxAgeYears to bring them back; they cost nothing to
 * rediscover, since the pruning below only removes the pictures.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  search: 'https://www.rit.edu/news/news-stories',
  keys: 'Merkel',
  /* Generous: the pager runs out after two pages today. The loop stops as soon
     as a page yields no new links, so this only bounds a runaway. */
  maxPages: 8,
  /* A rolling window, not a fixed date: anything older drops off on the run
     after its fifth anniversary. The search reaches back to 2012, and a news
     page led by a decade-old story reads as abandoned rather than deep. */
  maxAgeYears: 5,
  ua: 'brainlabresearch.org news updater',
};

const SINCE = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - CONFIG.maxAgeYears);
  return d.toISOString().slice(0, 10);
})();

/* Applied to the manual entries too, so the window means the same thing
   everywhere on the page. ISO dates compare correctly as strings. */
const recent = (n) => Boolean(n.date) && n.date >= SINCE;

/**
 * Which candidates are really his. Search hits are mixed in with unrelated promo
 * cards on the same page, so each one is fetched and tested against this.
 *
 * The full name, not the bare surname: RIT news carries at least one other
 * Merkel, and every genuine article introduces him by first and last name before
 * dropping to the surname, so nothing is lost by being strict.
 */
const VERIFY = /\bCory\s+Merkel\b/i;

/**
 * Stories that name him but that the search index does not return. Kept as bare
 * slugs under /news/. Re-check occasionally — if RIT reindexes, these become
 * redundant rather than wrong, since everything is de-duplicated by URL.
 */
const PINNED = [
  'team-presents-eye-tracking-research',
];

/**
 * Items from outside rit.edu, which no scraper will find. Keep newest-first;
 * they are merged with the fetched ones and the whole list re-sorted.
 *
 * Set `announce: true` on anything that should be broadcast to LinkedIn and X.
 * Those items — and only those — end up in feed-announce.xml, which is what the
 * posting automation watches. Everything still appears on the news page either
 * way; announce only controls whether it goes out to social.
 */
const MANUAL = [
  {
    /* From the photograph's EXIF capture time, 5 Aug 2026 16:15. */
    date: '2026-08-05',
    title: 'Karthik Kumar Defends Thesis on Efficient Spike-Based Learning',
    /* A defence is an event, not an article — there is nowhere to link. */
    linkTitle: false,
    /* Photographed in the room, so there is no URL to fetch it from; the file is
       committed alongside the scraped thumbnails and named here directly. */
    image: 'assets/news/karthik-kumar-thesis-defense.jpg',
    /* Same crop at 1620x1080 for the enlarged view — the 540px thumbnail the
       list uses has nothing to zoom into. */
    imageLarge: 'assets/news/karthik-kumar-thesis-defense-large.jpg',
    /* Deliberately does not say who is who — that is not readable from the
       photograph, and a wrong name in alt text is worse than none. */
    imageAlt: 'Three people standing either side of a projection screen showing the SpikeRFF thesis defence title slide.',
    summary: 'Congratulations to Karthik Kumar on successfully defending his MS in AI thesis, “SpikeRFF: Learning Forward with Layer-Local Plasticity and Semi-Hard Negatives.” His work explores self-supervised learning of spiking neural networks without backpropagation. Thank you to Alex Ororbia and Sathwika Bavikadi for serving on Karthik’s committee.',
    summaryHtml: 'Congratulations to Karthik Kumar on successfully defending his MS in AI thesis, “SpikeRFF: Learning Forward with Layer-Local Plasticity and Semi-Hard Negatives.” His work explores self-supervised learning of spiking neural networks without backpropagation. Thank you to Alex Ororbia and Sathwika Bavikadi for serving on Karthik’s committee.',
    announce: true,
  },
  {
    date: '2026-07-29',
    title: 'Manali Dangarikar to present at NAECON 2026',
    url: 'https://attend.ieee.org/naecon-2026/',
    /* No article of its own — the only link is NAECON, inline in the text. */
    linkTitle: false,
    summary: 'Manali Dangarikar will present her research, “Understanding fault tolerance of adversarially robust pruned models,” at the 2026 NAECON conference in Cincinnati.',
    summaryHtml: 'Manali Dangarikar will present her research, “Understanding fault tolerance of adversarially robust pruned models,” at the 2026 <a href="https://attend.ieee.org/naecon-2026/">NAECON</a> conference in Cincinnati.',
    announce: true,
  },
  {
    date: '2025-05-30',
    title: 'Machine learning predicts where the HHL quantum algorithm will pay off',
    url: 'https://quantumzeitgeist.com/quantum-machine-learning-predicts-suitability-of-hhl-algorithm-for-equations/',
    summary: 'Quantum Zeitgeist covers research by Sonia Lopez Alarcon and Cory Merkel, associate professors of computer engineering, with Mark Danza ’25 MS (computer engineering).',
    announce: false,
  },
];

/**
 * Scraped RIT articles default to NOT being broadcast — they are RIT's stories,
 * and auto-posting all of them would read as the lab claiming RIT's output.
 * To broadcast one anyway, paste its URL here.
 */
const ANNOUNCE_SCRAPED = new Set([
  // 'https://www.rit.edu/news/some-article-slug',
]);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': CONFIG.ua } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
};

const clean = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, '’')
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&mdash;/g, '—').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slugify = (s) => String(s ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * RIT cuts its own meta descriptions at a fixed length, mid-word — one of them
 * ends "published on Jan. 22 in Natu". Rather than print that, fall back to the
 * last complete sentence, or failing that the last whole word plus an ellipsis.
 */
const ABBREV = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|Dr|Prof|Mr|Mrs|Ms|St|vs|etc|No|Inc|Ltd|Fig|Eq|Approx|U\.S)\.$/i;

function tidySummary(s) {
  const t = clean(s);
  if (!t || /[.!?]["’)]?$/.test(t)) return t;

  /* A full stop only ends a sentence if what follows starts a new one. Matching
     a bare ". " instead cut "published on Jan. 22 in Natu" down to "published on
     Jan." — the month abbreviation read as a sentence end. */
  let cut = -1;
  const re = /[.!?]\s+(?=[A-Z"“'’(])/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (ABBREV.test(t.slice(0, m.index + 1))) continue;
    cut = m.index + 1;
  }

  /* Only accept a sentence cut that keeps most of the text, or the summary
     collapses to one short clause. */
  if (cut > t.length * 0.5) return t.slice(0, cut);

  return t.slice(0, t.lastIndexOf(' ')).replace(/[,;:]$/, '') + '…';
}

/**
 * Article images.
 *
 * Two URLs exist for the same picture and the choice matters:
 *
 *   - The article page carries the full-size original on cdn.rit.edu — around
 *     180 KB each, roughly 1 MB across the list.
 *   - The listing carries Drupal's pre-sized `news_thumbnail` variant of the
 *     same file, about 3.5x smaller. The search results pages serve the same
 *     variant the retired lab index did, so this survived the move intact.
 *
 * The thumbnails carry an `itok` signature that expires, which would be fatal if
 * we hotlinked them — but we download at build time, so the token only has to be
 * valid for that one fetch. Downloading rather than hotlinking is the same call
 * made for the headshots: an image served from RIT is an image RIT can move or
 * delete out from under the site.
 *
 * The two URLs share a filename, which is what links a thumbnail to its article.
 */
function thumbIndex(indexHtml) {
  const map = new Map();
  for (const m of indexHtml.matchAll(/(?:src|data-src)="([^"]*styles\/news_thumbnail\/[^"]*)"/g)) {
    const url = m[1].startsWith('http') ? m[1] : `https://www.rit.edu${m[1]}`;
    map.set(basename(url.split('?')[0]).toLowerCase(), url);
  }
  return map;
}

async function saveImage(url, slug, dir) {
  const dest = resolve(dir, `${slug}.jpg`);
  const rel = `assets/news/${slug}.jpg`;

  /* Keep whatever is already committed if the download fails. The itok
     signatures on RIT's thumbnails expire, so a later run can easily fail to
     re-fetch a picture that is sitting right there on disk — and without this
     the item would silently lose its image while the file stayed orphaned in
     the repo. */
  const keepExisting = () => (existsSync(dest) ? { file: rel, bytes: null, reused: true } : null);

  try {
    const res = await fetch(url, { headers: { 'User-Agent': CONFIG.ua } });
    if (!res.ok) return keepExisting();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return keepExisting();   // an error page, not a picture
    mkdirSync(dir, { recursive: true });
    writeFileSync(dest, buf);
    return { file: rel, bytes: buf.length };
  } catch {
    return keepExisting();
  }
}

async function scrapeArticle(url) {
  const html = (await get(url)).replace(/<script[\s\S]*?<\/script>/gi, ' ');

  const meta = (prop) => {
    const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`, 'i'));
    return m ? clean(m[1]) : '';
  };

  /* RIT suffixes every og:title with the subsite name — "| Brain Lab" on the
     retired lab pages, "| RIT" on the university ones these moved to. */
  const title = meta('og:title').replace(/\s*\|\s*(?:Brain Lab|RIT)\s*$/i, '').trim();
  const summary = tidySummary(meta('og:description') || meta('description'));

  /* Whether this is actually about him — the search returns promo cards too. */
  const named = VERIFY.test(html);

  /* No article:published_time and no ld+json on these pages, so the printed
     date is all there is. The first one on the page is the article's. */
  const m = html.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
  let date = null;
  if (m) {
    const mm = String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0');
    date = `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`;
  }

  /* The article's own hero is the absolute cdn.rit.edu one. The relative
     news_thumbnail images on the same page belong to OTHER articles listed
     alongside it, so matching those would attach the wrong picture. */
  const hero = (html.match(/https:\/\/cdn\.rit\.edu\/images\/news\/[^"?\s]+\.(?:jpg|jpeg|png|webp)/i) || [])[0] || null;

  return { url, title, summary, date, hero, named };
}

const fmt = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`;
};

/**
 * A card is a <div>, not an <a>.
 *
 * It used to wrap the whole card in an anchor, which made it impossible to put a
 * link inside the summary text — HTML forbids nesting one anchor in another, and
 * browsers silently break the markup apart if you try. Now the headline carries
 * the link and CSS stretches its hit area over the whole card, so the card still
 * behaves as one big click target while inline links in the summary keep working.
 *
 * Fields:
 *   url          where the card and the feed item point
 *   linkTitle    set false when there is no article to link to, only inline links
 *   summaryHtml  raw HTML for the page; `summary` stays plain text for the feed
 */
const item = (n) => {
  const body = n.summaryHtml ?? esc(n.summary);
  const linked = n.url && n.linkTitle !== false;
  const head = linked ? `<a href="${esc(n.url)}">${esc(n.title)}</a>` : esc(n.title);
  /* The cell is emitted even with no picture, so every headline in the list
     still starts on the same vertical line.
   *
   * A picture is wrapped in a plain link to the biggest copy we hold. site.js
   * upgrades that into a dialog; with no JS the link still opens the image,
   * which is the whole point of making it an anchor rather than a button. */
  const full = n.imageLarge ?? n.image;
  const pic = n.image
    ? `<a class="thumb" href="${esc(full)}" aria-label="View larger image">`
      + `<img src="${esc(n.image)}" alt="${esc(n.imageAlt ?? '')}" loading="lazy" onerror="this.closest('.thumb').remove()"></a>`
    : '<span class="thumb"></span>';
  return `  <div class="news-item">
    <span class="date">${esc(fmt(n.date))}</span>
    ${pic}
    <span><h4>${head}</h4>
    <p>${body}</p></span>
    ${linked ? '<span class="arrow">→</span>' : '<span></span>'}
  </div>`;
};

/* ---------- run ---------- */

/* Page through the search until a page turns up nothing new, harvesting the
   thumbnails on the way past — those only exist on the listing pages. */
const candidates = new Set(PINNED.map((s) => `https://www.rit.edu/news/${s}`));
const thumbs = new Map();
let pages = 0;

for (let page = 0; page < CONFIG.maxPages; page++) {
  const html = await get(`${CONFIG.search}?keys=${encodeURIComponent(CONFIG.keys)}&page=${page}`);
  pages += 1;

  for (const [name, url] of thumbIndex(html)) if (!thumbs.has(name)) thumbs.set(name, url);

  /* Articles are linked by relative path here. Excluding the query-string forms
     of the listing URL is free — the pattern already stops at "?". */
  const found = [...html.matchAll(/href="(?:https:\/\/www\.rit\.edu)?(\/news\/[^"#?]+)"/g)]
    .map((m) => `https://www.rit.edu${m[1].replace(/\/$/, '')}`)
    .filter((u) => u !== `${CONFIG.search}`);

  const before = candidates.size;
  found.forEach((u) => candidates.add(u));
  if (candidates.size === before) break;
}

console.log(`searched ${pages} result page(s) for "${CONFIG.keys}" — ${candidates.size} candidates, ${thumbs.size} thumbnails`);
const IMG_DIR = resolve(ROOT, 'assets/news');

const scraped = [];
let unrelated = 0;
let verified = 0;
let stale = 0;
for (const u of candidates) {
  try {
    const a = await scrapeArticle(u);
    /* Promo cards and section links share the listing page with real hits. */
    if (!a.named) { unrelated += 1; continue; }
    if (!a.title) { console.warn(`  SKIP (no title) ${u}`); continue; }
    verified += 1;
    if (!a.date) { console.warn(`  SKIP (no date) ${u}`); continue; }
    /* Ahead of the image download, so aged-out articles cost no bandwidth. */
    if (!recent(a)) { stale += 1; continue; }
    a.announce = ANNOUNCE_SCRAPED.has(u);
    const slug = u.replace(/\/$/, '').split('/').pop();
    const want = a.hero ? thumbs.get(basename(a.hero).toLowerCase()) ?? a.hero : null;
    if (want) {
      const saved = await saveImage(want, slug, IMG_DIR);
      if (saved) { a.image = saved.file; a.bytes = saved.bytes; }
    }
    scraped.push(a);
    console.log(`  ${a.date ?? '????-??-??'}  ${a.image ? (a.bytes ? String(Math.round(a.bytes/1024)).padStart(4)+'K' : ' kept') : '  --'}  ${a.title.slice(0, 62)}`);
  } catch (e) {
    console.warn(`  FAILED ${u} — ${e.message}`);
  }
}
if (unrelated) console.log(`  ignored ${unrelated} candidate(s) that do not name him`);
if (stale) console.log(`  ignored ${stale} article(s) published before ${SINCE}`);

/* Without this, a search that quietly stops returning results would rewrite the
   page down to just the MANUAL entries and delete years of history in a commit
   that looks routine. RIT has already moved this source once.
 *
 * Deliberately counted before the age filter. Checking the published list
 * instead would conflate a broken source with the legitimate case where every
 * hit is simply too old — and would turn a quiet news year into a build
 * failure. */
if (!verified) {
  console.error(`\nERROR  no RIT articles survived verification (${candidates.size} candidates checked).`);
  console.error(`       ${CONFIG.search} has probably moved or changed shape again.`);
  console.error('       Refusing to rewrite news.html with only the manual entries.');
  process.exit(1);
}

/* MANUAL entries may name an imageUrl; download it the same way so nothing on
   the page is hotlinked from someone else's server. An entry may instead name an
   `image` that is already committed under assets/news — a photo taken in the
   room was never published anywhere there is a URL to fetch it from. */
for (const n of MANUAL) {
  if (n.image) {
    if (!existsSync(resolve(ROOT, n.image))) {
      console.warn(`  MISSING ${n.image} — “${n.title}” will render without a picture.`);
      delete n.image;
      delete n.imageLarge;
    } else if (n.imageLarge && !existsSync(resolve(ROOT, n.imageLarge))) {
      /* Fall back to the thumbnail rather than linking at a 404. */
      console.warn(`  MISSING ${n.imageLarge} — enlarged view falls back to the thumbnail.`);
      delete n.imageLarge;
    }
    continue;
  }
  if (!n.imageUrl) continue;
  const slug = slugify(n.slug ?? n.title);
  const saved = await saveImage(n.imageUrl, slug, resolve(ROOT, 'assets/news'));
  if (saved) n.image = saved.file;
}

const all = [...scraped, ...MANUAL]
  .filter(recent)
  .sort((a, b) => b.date.localeCompare(a.date));

/* Every article that ages out strands its picture, and the manual entries have
   pictures too — so the keep-set is built from what actually got published
   rather than from the scraped list. Only ever touches .jpg files in this one
   directory, and only on a run that got past the verification guard above. */
/* Not .map(basename) — map hands the index in as basename's second argument,
   which it reads as a suffix to strip and rejects for not being a string. */
const keep = new Set(all.flatMap((n) => [n.image, n.imageLarge].filter(Boolean))
  .map((p) => basename(p)));
let pruned = 0;
for (const f of readdirSync(IMG_DIR)) {
  if (!/\.jpg$/i.test(f) || keep.has(f)) continue;
  unlinkSync(resolve(IMG_DIR, f));
  pruned += 1;
}
if (pruned) console.log(`pruned  ${pruned} image(s) whose article is no longer listed`);

/* news.html — replace only the list, leaving the rest of the page alone. */
const NEWS = resolve(ROOT, 'news.html');
let news = readFileSync(NEWS, 'utf8');
const block = all.map(item).join('\n\n');
news = news.replace(
  /(<!-- NEWS:START -->)[\s\S]*?(<!-- NEWS:END -->)/,
  `$1\n${block}\n\n  $2`,
);
writeFileSync(NEWS, news);

/* feed.xml — the machine-readable copy of the same list.
 *
 * Worth having for its own sake, but it is also the hook for automation: a
 * service watching this feed can post new items to LinkedIn and X without any
 * platform API credentials living in this repo.
 *
 * NOTE the absence of <lastBuildDate>. Stamping the current time would rewrite
 * the file on every run, so the monthly workflow's "commit only if something
 * changed" check would fire every month and redeploy for nothing. The newest
 * item's date carries the same information and only moves when the news does. */
const rfc822 = (iso) => new Date(`${iso}T12:00:00Z`).toUTCString();
const SITE = 'https://www.brainlabresearch.org';

const buildFeed = (title, self, list, desc) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${title}</title>
  <link>${SITE}/news.html</link>
  <atom:link href="${SITE}/${self}" rel="self" type="application/rss+xml"/>
  <description>${desc}</description>
  <language>en-us</language>
${list.map((n) => {
  /* Not every item has somewhere to point: a thesis defence is an event, not an
     article. Those link to the news page and carry a non-permalink guid built
     from the date and title, because a feed watcher dedupes on guid and every
     such item would otherwise share an empty one and post only once, ever. */
  const link = n.url || `${SITE}/news.html`;
  const guid = n.url
    ? `<guid isPermaLink="true">${esc(n.url)}</guid>`
    : `<guid isPermaLink="false">${esc(`${SITE}/news.html#${n.date}-${slugify(n.title)}`)}</guid>`;
  return `  <item>
    <title>${esc(n.title)}</title>
    <link>${esc(link)}</link>
    ${guid}
    <pubDate>${rfc822(n.date)}</pubDate>
    <description>${esc(n.summary)}</description>
  </item>`;
}).join('\n')}
</channel>
</rss>
`;
writeFileSync(resolve(ROOT, 'feed.xml'), buildFeed('Brain Lab — News', 'feed.xml', all, 'News and coverage from the Brain Lab.'));

/* Only the flagged items. This is what the social automation subscribes to, so
   nothing reaches LinkedIn or X unless it was explicitly opted in. */
const announced = all.filter((n) => n.announce);
writeFileSync(resolve(ROOT, 'feed-announce.xml'), buildFeed('Brain Lab — Announcements', 'feed-announce.xml', announced, 'Brain Lab items flagged for broadcast to LinkedIn and X.'));

/* index.html mirrors the newest three. */
const INDEX = resolve(ROOT, 'index.html');
let home = readFileSync(INDEX, 'utf8');
home = home.replace(
  /(<!-- NEWS:START -->)[\s\S]*?(<!-- NEWS:END -->)/,
  `$1\n${all.slice(0, 3).map(item).join('\n\n')}\n\n  $2`,
);
writeFileSync(INDEX, home);

console.log(`\nwrote ${all.length} items to news.html, feed.xml, newest 3 to index.html`);
console.log(`      ${announced.length} flagged for broadcast in feed-announce.xml`);
