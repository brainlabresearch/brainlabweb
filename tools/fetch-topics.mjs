#!/usr/bin/env node
/**
 * Builds assets/data/topics.json — the term frequencies behind the animated
 * topic cloud on research.html.
 *
 *   node tools/fetch-topics.mjs
 *
 * Source is paper TITLES, not abstracts. Abstracts carry far more words but most
 * of them are prose scaffolding — a title is already the author's compression of
 * the work down to its subject, so nearly every word in it earns its place.
 *
 * The window slides by PAPER, not by year: it holds a fixed number of
 * consecutive papers and advances one paper at a time. Stepping by year gave 13
 * frames and a slideshow; stepping by paper gives ~80 frames that each differ
 * from the last by one paper in and one paper out, which is what makes the
 * motion continuous. Windows straddle year boundaries as a side effect, which is
 * fine — publication years are an accident of review cycles, not of when the
 * work changed.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  authorIds: ['A5079020868', 'A5136052479'],
  mailto: 'c.merkel87@gmail.com',
  out: resolve(ROOT, 'assets/data/topics.json'),
  minYear: 2011,
  windowPapers: 20, // papers held in the window at once
  stepPapers: 1,    // papers advanced per frame — 1 is what makes it smooth
  termsPerWindow: 18,
  minTermLength: 4,
};

/**
 * Stopwords. Beyond the usual English filler this has to strip academic
 * boilerplate — "paper", "propose", "results", "show" appear in nearly every
 * abstract and say nothing about the subject. Without this second group the
 * cloud is dominated by the vocabulary of writing papers rather than the
 * vocabulary of the research.
 */
const STOP = new Set(`
a about above after again against all also am an and any are aren as at be because been
before being below between both but by can cannot could couldn did didn do does doesn
doing don down during each few for from further had hadn has hasn have haven having he
her here hers herself him himself his how i if in into is isn it its itself let me more
most mustn my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan she should shouldn so some such than that the their theirs them
themselves then there these they this those through to too under until up very was wasn
we were weren what when where which while who whom why with won would wouldn you your
yours yourself yourselves
paper papers present presents presented proposed propose proposes propose show shows
shown showed demonstrate demonstrates demonstrated result results resulting work works
study studies approach approaches method methods methodology technique techniques
using used use uses useful based introduce introduces introduction conclusion conclusions
however therefore thus furthermore moreover additionally finally first second third
new novel recent recently several various different many much more less least
paper's abstract keywords index terms ieee acm copyright reserved rights
one two three four five six seven eight nine ten
achieve achieves achieved obtain obtained provide provides provided
consider considered considering compare compared comparison
allow allows enable enables require requires required
increase increases increased decrease decreases decreased
high higher low lower large larger small smaller good better best
well also may might must shall will can able
respectively via within without across among towards toward
et al fig figure table section
invited review reviews survey surveys overview tutorial editorial chapter
perspective perspectives position context exploring investigation investigating
`.trim().split(/\s+/));

async function fetchWorks() {
  const filter = `author.id:${CONFIG.authorIds.join('|')}`;
  const select = 'id,title,publication_year,publication_date,type';
  const out = [];
  let cursor = '*';
  while (cursor) {
    const url = 'https://api.openalex.org/works'
      + `?filter=${encodeURIComponent(filter)}&select=${select}`
      + `&per-page=200&cursor=${encodeURIComponent(cursor)}`
      + `&mailto=${encodeURIComponent(CONFIG.mailto)}`;
    const res = await fetch(url, { headers: { 'User-Agent': `brainlabresearch.org (${CONFIG.mailto})` } });
    if (!res.ok) throw new Error(`OpenAlex returned ${res.status}`);
    const data = await res.json();
    out.push(...data.results);
    cursor = data.meta?.next_cursor ?? null;
    if (!data.results.length) break;
  }
  return out;
}

const normTitle = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Returns kept words along with their ORIGINAL position in the title.
 *
 * The position matters. Dropping stopwords pulls the survivors together, so
 * "Thermal Profiling of CMOS" would otherwise yield the bigram "profiling cmos"
 * — two words that were never next to each other. Keeping the original index
 * lets countTerms() form bigrams only from genuinely adjacent words.
 */
function tokenize(text, singularise = (w) => w) {
  const out = [];
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .forEach((w, i) => {
      if (w.length >= CONFIG.minTermLength && !STOP.has(w) && !/^\d+$/.test(w)) {
        out.push({ w: singularise(w), i });
      }
    });
  return out;
}

/**
 * Build a plural→singular map so "neural networks" and "neural network" stop
 * competing for the same slot.
 *
 * Naive 's'-stripping would turn "bias" into "bia" and "analysis" into
 * "analysi". So a plural is only folded in when the singular ALREADY occurs in
 * the corpus on its own — real words vouch for each other, and invented stems
 * never do.
 */
function buildSingulariser(allTokens) {
  const counts = new Map();
  for (const t of allTokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  const map = new Map();
  for (const [word] of counts) {
    if (word.length < 5 || !word.endsWith('s') || /(ss|us|is)$/.test(word)) continue;
    const singular = word.slice(0, -1);
    if ((counts.get(singular) ?? 0) >= 2) map.set(word, singular);
  }
  return (w) => map.get(w) ?? w;
}

/**
 * Count unigrams and bigrams together, then drop any unigram that mostly lives
 * inside a bigram we're already showing. "neural" on its own is noise next to
 * "neural networks"; "spiking neural networks" is the actual topic. Bigrams get
 * a small score bonus for exactly that reason — they carry more meaning per slot.
 */
function countTerms(docs) {
  const uni = new Map();
  const bi = new Map();
  for (const tokens of docs) {
    for (let i = 0; i < tokens.length; i++) {
      uni.set(tokens[i].w, (uni.get(tokens[i].w) ?? 0) + 1);
      // Only pair words that were adjacent in the original title.
      if (i < tokens.length - 1 && tokens[i + 1].i === tokens[i].i + 1) {
        const b = `${tokens[i].w} ${tokens[i + 1].w}`;
        bi.set(b, (bi.get(b) ?? 0) + 1);
      }
    }
  }

  // Threshold of 2, not 3: a window is now 20 titles rather than 20 abstracts,
  // so absolute counts are an order of magnitude smaller.
  const bigrams = [...bi.entries()]
    .filter(([, n]) => n >= 2)
    .map(([t, n]) => ({ t, n, score: n * 1.6 }));

  // Drop a unigram once a bigram containing it accounts for a meaningful share
  // of its uses. At 0.4, "neural" (33) loses to "neural network" (19) — which is
  // right, because the bare word says nothing on its own. An earlier, tighter
  // threshold let both through and the cloud showed the same topic twice.
  // n >= 2 matters. A term appearing in exactly one title out of twenty is not a
  // theme, and with only ~18 slots the singletons crowd out real ones.
  const unigrams = [...uni.entries()]
    .filter(([t, n]) => n >= 2 && bigramMax(bi, t) < n * 0.4)
    .map(([t, n]) => ({ t, n, score: n }));

  // Ties are common now that counts are small, so break them on the term itself.
  // Without a deterministic tiebreak, equal-scoring terms swap rank between
  // adjacent frames and the cloud jitters instead of drifting.
  return [...bigrams, ...unigrams]
    .sort((a, b) => (b.score - a.score) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .slice(0, CONFIG.termsPerWindow);
}

/** Largest count of any bigram containing this word. */
function bigramMax(bi, word) {
  let max = 0;
  for (const [b, n] of bi) {
    if (n > max && b.split(' ').includes(word)) max = n;
  }
  return max;
}

const raw = await fetchWorks();

// De-duplicate on title so a preprint and its published version don't have the
// same abstract counted twice, which would double-weight those terms.
const seen = new Map();
for (const w of raw) {
  if (!w.title || !w.publication_year) continue;
  if (w.publication_year < CONFIG.minYear) continue;
  const key = normTitle(w.title);
  if (!seen.has(key)) seen.set(key, w);
}
const works = [...seen.values()];

// Oldest first, so the window slides forward through time.
works.sort((a, b) =>
  String(a.publication_date ?? a.publication_year).localeCompare(
    String(b.publication_date ?? b.publication_year)));

// One pass over everything to learn which plurals are safe to fold, then a
// second pass that applies it. Has to be corpus-wide: a window too small to
// contain the singular would otherwise keep the plural as a separate term.
const singularise = buildSingulariser(works.flatMap((w) => tokenize(w.title).map((t) => t.w)));

const windows = [];
const span = Math.min(CONFIG.windowPapers, works.length);
for (let i = 0; i + span <= works.length; i += CONFIG.stepPapers) {
  const slice = works.slice(i, i + span);
  const docs = slice.map((w) => tokenize(w.title, singularise));
  windows.push({
    from: slice[0].publication_year,
    to: slice[slice.length - 1].publication_year,
    papers: slice.length,
    terms: countTerms(docs).map(({ t, n }) => ({ t, n })),
  });
}

const vocab = [...new Set(windows.flatMap((w) => w.terms.map((t) => t.t)))].sort();

mkdirSync(dirname(CONFIG.out), { recursive: true });
writeFileSync(CONFIG.out, JSON.stringify({ windows, vocab }, null, 0), 'utf8');

console.log(`titles      ${works.length} papers after de-duplication`);
console.log(`frames      ${windows.length} (${CONFIG.windowPapers}-paper window, stepping ${CONFIG.stepPapers})`);
console.log(`vocabulary  ${vocab.length} distinct terms across all windows`);
console.log(`wrote       ${CONFIG.out}`);
