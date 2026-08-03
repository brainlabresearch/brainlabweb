#!/usr/bin/env node
/**
 * Rebuilds the lecture lists on the Learn pages from the PDFs on disk.
 *
 *   node tools/build-learn.mjs
 *
 * Slide counts and file sizes are printed next to every lecture, and both are
 * exactly the sort of number that goes stale silently: someone re-exports a deck
 * with six new slides and the page still advertises the old count. So neither is
 * written by hand — this reads them back out of the files themselves.
 *
 * ORDER AND TITLES ARE NOT DERIVED FROM FILENAMES. `introduction.pdf` sorts
 * after `classification.pdf`, and no naming scheme survives contact with a
 * course that reorders a topic mid-semester. The COURSES table below is the
 * running order, and it is the one thing here worth editing by hand.
 *
 * TO ADD A LECTURE. Copy the PDF into the course's directory under
 * assets/learn/, add a row to `lectures` in the right position, re-run. A file
 * on disk that no table mentions is reported rather than published, so a deck
 * dropped in the folder and forgotten does not sit there invisibly.
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Running order taken from the course syllabus, not from the filenames.
 *
 * Two decks sit outside the syllabus' topic list but plainly belong where they
 * are put here: the gradient-descent treatment follows the closed-form linear
 * regression it motivates, and the metrics deck follows the classification
 * lecture it measures.
 */
const COURSES = [
  {
    page: 'learn-machine-intelligence.html',
    dir: 'assets/learn/machine-intelligence',
    lectures: [
      { file: 'introduction.pdf', title: 'Introduction to machine learning' },
      { file: 'linear-regression.pdf', title: 'Linear regression' },
      { file: 'linear-regression-gd.pdf', title: 'Linear regression by gradient descent' },
      { file: 'linear-regression-regularization.pdf', title: 'Bias, variance, and regularization' },
      { file: 'classification.pdf', title: 'Classification and k-nearest neighbours' },
      { file: 'classification-metrics.pdf', title: 'Classification metrics' },
      { file: 'decision-trees.pdf', title: 'Decision trees' },
      { file: 'bayes.pdf', title: 'Bayesian classifiers and Bayes nets' },
      { file: 'svm.pdf', title: 'Support vector machines and kernels' },
      { file: 'intro-ann.pdf', title: 'Neural networks and backpropagation' },
      { file: 'ann-architectures.pdf', title: 'Deep learning architectures' },
      { file: 'reinforcement-learning.pdf', title: 'Reinforcement learning' },
    ],
  },
];

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Slide count without a PDF library.
 *
 * Every page object in the file carries `/Type /Page`, so counting those counts
 * the slides. The `[^s]` matters — without it `/Type /Pages`, the node that
 * groups them, is counted too and every deck reads one high. Checked against the
 * `/Count` field on the files that expose one, where the two agree exactly.
 */
function slides(buf) {
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const size = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.round(bytes / 1024)} KB`);

/* Replace only the marked region, exactly as the news build does, so the rest of
   the page stays hand-written. */
function splice(html, name, block) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(html)) throw new Error(`no ${name}:START/END markers found`);
  return html.replace(re, `$1\n${block}\n  $2`);
}

let totalLectures = 0;
let totalSlides = 0;

for (const course of COURSES) {
  const dir = resolve(ROOT, course.dir);
  const rows = [];
  let courseSlides = 0;
  let courseBytes = 0;

  course.lectures.forEach((lec, i) => {
    const path = resolve(dir, lec.file);
    if (!existsSync(path)) {
      console.error(`ERROR  missing ${course.dir}/${lec.file} — listed in the table but not on disk.`);
      process.exit(1);
    }
    const buf = readFileSync(path);
    const bytes = statSync(path).size;
    const n = slides(buf);
    courseSlides += n;
    courseBytes += bytes;

    const num = String(i + 1).padStart(2, '0');
    const meta = `PDF · ${n} slide${n === 1 ? '' : 's'} · ${size(bytes)}`;
    rows.push(`  <a class="lec" href="${course.dir}/${esc(lec.file)}">
    <span class="num">${num}</span>
    <span class="lec-body">
      <span class="lec-t">${esc(lec.title)}</span>
      <span class="lec-m">${meta}</span>
    </span>
    <span class="arrow" aria-hidden="true">↓</span>
  </a>`);
    console.log(`  ${num}  ${String(n).padStart(3)} slides  ${size(bytes).padStart(7)}  ${lec.title}`);
  });

  /* A deck sitting in the folder that no row mentions is almost always one that
     was added and then forgotten, so say so rather than silently ignoring it. */
  const listed = new Set(course.lectures.map((l) => l.file));
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.pdf') && !listed.has(f)) {
      console.warn(`  NOTE  ${f} is in the folder but not in the table — not published.`);
    }
  }

  const page = resolve(ROOT, course.page);
  let html = readFileSync(page, 'utf8');
  html = splice(html, 'LECTURES', rows.join('\n\n'));
  html = splice(html, 'COUNT',
    `  <span class="pub-count">${course.lectures.length} lectures · ${courseSlides} slides · ${size(courseBytes)}</span>`);
  writeFileSync(page, html);

  console.log(`wrote  ${course.lectures.length} lectures to ${course.page}`);
  totalLectures += course.lectures.length;
  totalSlides += courseSlides;
}

/* The hub advertises the totals, so it has to be rewritten whenever a course
   changes rather than carrying a number someone remembered to update. */
const hub = resolve(ROOT, 'learn.html');
let hubHtml = readFileSync(hub, 'utf8');
hubHtml = splice(hubHtml, 'COUNT',
  `  <span class="pub-count">${totalLectures} lectures · ${totalSlides} slides</span>`);
writeFileSync(hub, hubHtml);
console.log(`wrote  totals to learn.html (${totalLectures} lectures, ${totalSlides} slides)`);
