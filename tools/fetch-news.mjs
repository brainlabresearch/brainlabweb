#!/usr/bin/env node
/**
 * Rebuilds news.html (and the three-item summary on index.html) from RIT's
 * Brain Lab news index.
 *
 *   node tools/fetch-news.mjs
 *
 * WHY THIS SOURCE. The ask was "anything on RIT news mentioning my name", and
 * there is no clean way to get that:
 *
 *   - rit.edu publishes no RSS. /news/rss.xml, /news/rss and /news/feed all
 *     return the ordinary HTML page, not a feed.
 *   - There is no author archive. /news/cory-merkel returns RIT's generic
 *     "Latest News (frontpage)" — their catch-all for unknown paths.
 *   - Their site search is JavaScript-driven, so it can't be fetched.
 *   - Google News RSS does find articles, but a "Cory Merkel" query also returns
 *     two obituaries for a different Merkel and an ice-hockey report, and
 *     restricting to site:rit.edu returns mostly directory pages rather than
 *     articles. Worse, its links are opaque news.google.com redirects rather
 *     than real article URLs.
 *
 * The Brain Lab news index is curated, stable, and carries real absolute URLs,
 * so that is what this reads. It is a subset of "every RIT mention" — anything
 * published elsewhere on rit.edu that never got added to the lab's own news page
 * will not appear. Add those to MANUAL below.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  index: 'https://www.rit.edu/brainlab/news',
  ua: 'brainlabresearch.org news updater',
};

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
  // 'https://www.rit.edu/brainlab/news/some-article-slug',
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

async function scrapeArticle(url) {
  const html = (await get(url)).replace(/<script[\s\S]*?<\/script>/gi, ' ');

  const meta = (prop) => {
    const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`, 'i'));
    return m ? clean(m[1]) : '';
  };

  /* RIT suffixes every og:title with the subsite name. */
  const title = meta('og:title').replace(/\s*\|\s*Brain Lab\s*$/i, '').trim();
  const summary = tidySummary(meta('og:description') || meta('description'));

  /* No article:published_time and no ld+json on these pages, so the printed
     date is all there is. The first one on the page is the article's. */
  const m = html.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/);
  let date = null;
  if (m) {
    const mm = String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0');
    date = `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`;
  }

  return { url, title, summary, date };
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
  return `  <div class="news-item">
    <span class="date">${esc(fmt(n.date))}</span>
    <span><h4>${head}</h4>
    <p>${body}</p></span>
    ${linked ? '<span class="arrow">→</span>' : '<span></span>'}
  </div>`;
};

/* ---------- run ---------- */

const index = await get(CONFIG.index);
const urls = [...new Set(
  [...index.matchAll(/href="(https:\/\/www\.rit\.edu\/brainlab\/news\/[^"]+)"/g)].map((m) => m[1]),
)];
console.log(`found ${urls.length} article links on ${CONFIG.index}`);

const scraped = [];
for (const u of urls) {
  try {
    const a = await scrapeArticle(u);
    if (!a.title) { console.warn(`  SKIP (no title) ${u}`); continue; }
    if (!a.date) console.warn(`  no date found for ${u}`);
    a.announce = ANNOUNCE_SCRAPED.has(u);
    scraped.push(a);
    console.log(`  ${a.date ?? '????-??-??'}  ${a.title.slice(0, 70)}`);
  } catch (e) {
    console.warn(`  FAILED ${u} — ${e.message}`);
  }
}

const all = [...scraped, ...MANUAL]
  .filter((n) => n.date)
  .sort((a, b) => b.date.localeCompare(a.date));

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
${list.map((n) => `  <item>
    <title>${esc(n.title)}</title>
    <link>${esc(n.url)}</link>
    <guid isPermaLink="true">${esc(n.url)}</guid>
    <pubDate>${rfc822(n.date)}</pubDate>
    <description>${esc(n.summary)}</description>
  </item>`).join('\n')}
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
