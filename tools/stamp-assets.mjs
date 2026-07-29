#!/usr/bin/env node
/**
 * Cache-busts the site's own assets by appending ?v=<hash of the file>.
 *
 *   node tools/stamp-assets.mjs
 *
 * GitHub Pages serves assets with a cache lifetime, and browsers hold them
 * longer still. The symptom is silent and confusing: the HTML updates but the
 * stylesheet, script, or image does not, so a fix appears not to have worked
 * when it simply has not loaded. That cost a debugging round on the bio dialogs,
 * and again on the logo — where a corrected SVG was live and verified while the
 * browser kept serving the old one.
 *
 * The hash only changes when the file changes, so the cache still does its job
 * the rest of the time.
 *
 * RUN THIS BEFORE COMMITTING any change under assets/css, assets/js, or
 * assets/icons.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Icons first: they are referenced from inside site.css, so their stamps have to
   be written before the stylesheet's own hash is computed — otherwise the CSS
   hash describes a version of the file that never shipped. */
const ICONS = [
  'assets/icons/logo.svg',
  'assets/icons/logo-dark.svg',
  'assets/icons/mark.svg',
  'assets/icons/mark-dark.svg',
  'assets/icons/favicon.svg',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/og-card.png',
].filter((p) => existsSync(resolve(ROOT, p)));

const CODE = ['assets/css/site.css', 'assets/js/site.js', 'assets/js/topics.js']
  .filter((p) => existsSync(resolve(ROOT, p)));

const hash = (rel) =>
  createHash('sha1').update(readFileSync(resolve(ROOT, rel))).digest('hex').slice(0, 8);

/**
 * Rewrite every reference to `rel`, whatever shape it takes: relative
 * ("assets/icons/mark.svg"), root-relative ("/assets/..."), a CSS url()
 * ("../icons/mark.svg"), or the absolute URL used in og:image. Any existing
 * ?v= stamp is replaced rather than appended to.
 */
function stamp(text, rel, v) {
  const file = rel.split('/').pop().replace('.', '\\.');
  const dir = rel.split('/').slice(0, -1).join('/');
  const patterns = [
    new RegExp(`((?:/|\\.\\./|\\.\\./\\.\\./)?${dir}/${file})(\\?v=[a-f0-9]+)?`, 'g'),
    new RegExp(`(\\.\\./${dir.split('/').pop()}/${file})(\\?v=[a-f0-9]+)?`, 'g'),
  ];
  let out = text;
  for (const re of patterns) out = out.replace(re, `$1?v=${v}`);
  return out;
}

/* Pass 1 — icon references inside the stylesheet. */
const iconHashes = Object.fromEntries(ICONS.map((p) => [p, hash(p)]));
const cssPath = resolve(ROOT, 'assets/css/site.css');
if (existsSync(cssPath)) {
  let css = readFileSync(cssPath, 'utf8');
  for (const [rel, v] of Object.entries(iconHashes)) css = stamp(css, rel, v);
  writeFileSync(cssPath, css);
}

/* Pass 2 — everything referenced from the HTML. Code hashes are computed now,
   after the stylesheet has been rewritten above. */
const codeHashes = Object.fromEntries(CODE.map((p) => [p, hash(p)]));
const all = { ...iconHashes, ...codeHashes };

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let touched = 0;
for (const page of pages) {
  const path = resolve(ROOT, page);
  const before = readFileSync(path, 'utf8');
  let html = before;
  for (const [rel, v] of Object.entries(all)) html = stamp(html, rel, v);
  if (html !== before) { writeFileSync(path, html); touched++; }
}

console.log(`stamped ${touched} of ${pages.length} pages`);
for (const [rel, v] of Object.entries(all)) console.log(`  ${rel.padEnd(34)} v=${v}`);
