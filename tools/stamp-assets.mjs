#!/usr/bin/env node
/**
 * Cache-busts the CSS and JS links in every HTML file.
 *
 *   node tools/stamp-assets.mjs
 *
 * GitHub Pages serves assets with a cache lifetime, and browsers hold them
 * longer still. The symptom is nasty because it is silent: the HTML updates but
 * the stylesheet or script does not, so a new feature appears to be "not
 * working" when it is really just not loaded. That cost us a debugging round on
 * the bio dialogs.
 *
 * This appends ?v=<hash of the file contents> to each reference. The hash only
 * changes when the file does, so browsers re-fetch exactly when they should and
 * keep using the cache when nothing moved.
 *
 * RUN THIS BEFORE COMMITTING any change to assets/css or assets/js.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const short = (rel) =>
  createHash('sha1').update(readFileSync(resolve(ROOT, rel))).digest('hex').slice(0, 8);

const ASSETS = ['assets/css/site.css', 'assets/js/site.js', 'assets/js/topics.js'];
const hashes = Object.fromEntries(ASSETS.map((a) => [a, short(a)]));

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let touched = 0;

for (const page of pages) {
  const path = resolve(ROOT, page);
  let html = readFileSync(path, 'utf8');
  const before = html;

  for (const [rel, hash] of Object.entries(hashes)) {
    const file = rel.split('/').pop();
    /* Matches the reference with or without an existing ?v= stamp, and works for
       404.html's root-relative paths as well as the relative ones elsewhere. */
    const re = new RegExp(`(["'])((?:/|\\.\\./)?assets/(?:css|js)/${file.replace('.', '\\.')})(?:\\?v=[a-f0-9]+)?\\1`, 'g');
    html = html.replace(re, `$1$2?v=${hash}$1`);
  }

  if (html !== before) { writeFileSync(path, html); touched++; }
}

console.log(`stamped ${touched} of ${pages.length} pages`);
for (const [rel, hash] of Object.entries(hashes)) console.log(`  ${rel.padEnd(24)} v=${hash}`);
