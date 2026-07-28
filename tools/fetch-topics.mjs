#!/usr/bin/env node
/**
 * Builds assets/data/topics.json — the term frequencies behind the animated
 * topic cloud on research.html.
 *
 *   node tools/fetch-topics.mjs
 *
 * Source is the abstracts OpenAlex holds for the lab's papers (88% coverage as
 * of writing). OpenAlex stores an abstract as an "inverted index" — a map of
 * word to the positions it occupies — so the text has to be reassembled before
 * it can be counted.
 *
 * The output is a series of overlapping time windows. Overlapping rather than
 * discrete years because a single year is only 2-12 papers here, which is far
 * too noisy to read as a trend; a four-year window smooths that without
 * flattening the drift.
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
  windowYears: 4,   // width of each window
  step: 1,          // years between windows
  termsPerWindow: 30,
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
`.trim().split(/\s+/));

/** Reassemble OpenAlex's position-indexed abstract back into running text. */
function inflateAbstract(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(' ');
}

async function fetchWorks() {
  const filter = `author.id:${CONFIG.authorIds.join('|')}`;
  const select = 'id,title,publication_year,type,abstract_inverted_index';
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

function tokenize(text, singularise = (w) => w) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= CONFIG.minTermLength && !STOP.has(w) && !/^\d+$/.test(w))
    .map(singularise);
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
      uni.set(tokens[i], (uni.get(tokens[i]) ?? 0) + 1);
      if (i < tokens.length - 1) {
        const b = `${tokens[i]} ${tokens[i + 1]}`;
        bi.set(b, (bi.get(b) ?? 0) + 1);
      }
    }
  }

  const bigrams = [...bi.entries()]
    .filter(([, n]) => n >= 3)
    .map(([t, n]) => ({ t, n, score: n * 1.6 }));

  // Drop a unigram once a bigram containing it accounts for a meaningful share
  // of its uses. At 0.4, "neural" (33) loses to "neural network" (19) — which is
  // right, because the bare word says nothing on its own. An earlier, tighter
  // threshold let both through and the cloud showed the same topic twice.
  const unigrams = [...uni.entries()]
    .filter(([t, n]) => n >= 2 && bigramMax(bi, t) < n * 0.4)
    .map(([t, n]) => ({ t, n, score: n }));

  return [...bigrams, ...unigrams]
    .sort((a, b) => b.score - a.score)
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
  if (!w.abstract_inverted_index || !w.publication_year) continue;
  if (w.publication_year < CONFIG.minYear) continue;
  const key = normTitle(w.title);
  if (!seen.has(key)) seen.set(key, w);
}
const works = [...seen.values()];

const years = works.map((w) => w.publication_year);
const minY = Math.min(...years);
const maxY = Math.max(...years);

// One pass over everything to learn which plurals are safe to fold, then a
// second pass that applies it. Has to be corpus-wide: a window too small to
// contain the singular would otherwise keep the plural as a separate term.
const singularise = buildSingulariser(
  works.flatMap((w) => tokenize(inflateAbstract(w.abstract_inverted_index))));

const windows = [];
for (let from = minY; from + CONFIG.windowYears - 1 <= maxY; from += CONFIG.step) {
  const to = from + CONFIG.windowYears - 1;
  const inWindow = works.filter((w) => w.publication_year >= from && w.publication_year <= to);
  if (!inWindow.length) continue;
  const docs = inWindow.map((w) => tokenize(inflateAbstract(w.abstract_inverted_index), singularise));
  windows.push({
    from,
    to,
    papers: inWindow.length,
    terms: countTerms(docs).map(({ t, n }) => ({ t, n })),
  });
}

const vocab = [...new Set(windows.flatMap((w) => w.terms.map((t) => t.t)))].sort();

mkdirSync(dirname(CONFIG.out), { recursive: true });
writeFileSync(CONFIG.out, JSON.stringify({ windows, vocab }, null, 0), 'utf8');

console.log(`abstracts   ${works.length} of ${raw.length} works had one`);
console.log(`windows     ${windows.length} (${CONFIG.windowYears}-year, stepping ${CONFIG.step})`);
console.log(`vocabulary  ${vocab.length} distinct terms across all windows`);
console.log(`wrote       ${CONFIG.out}`);
