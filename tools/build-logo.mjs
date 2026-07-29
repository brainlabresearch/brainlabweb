#!/usr/bin/env node
/**
 * Derives the site's logo assets from assets/icons/brainlablogo.svg.
 *
 *   node tools/build-logo.mjs
 *
 * Re-run this if the source logo is ever replaced. Everything it writes is
 * generated — edit the source, not the output.
 *
 * The source is a PowerPoint export, which brings three problems this script
 * exists to solve:
 *
 * 1. Fixed width/height and a clipPath pinned to a much larger canvas, so it
 *    won't scale. Replaced with a viewBox. Note the viewBox has to be expressed
 *    AFTER the group's translate(-1397,-1009) — using the original canvas
 *    coordinates frames empty space.
 * 2. The mark is two-tone by design: a pale half and a dark half. That cannot be
 *    recoloured with a single CSS `color`, so light- and dark-ground variants are
 *    baked out separately.
 * 3. The wordmark is live text in Aptos — a Microsoft font almost nobody else
 *    has, so it silently falls back to some other sans on most machines. See the
 *    note at the bottom of this file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'assets/icons');
const src = readFileSync(resolve(DIR, 'brainlablogo.svg'), 'utf8');

/* Frames expressed in post-translate coordinates. */
const FULL = '38 -6 312 380';   // mark plus wordmark
const MARK = '60 -6 253 282';   // circular mark only

const ON_PAPER = { ink: '#161C24', ground: '#F0F2ED' };
const ON_INK = { ink: '#F0F2ED', ground: '#0D1522' };

/**
 * Widen the rectangle that masks the pale half of the mark.
 *
 * As exported, that rect is x=1464 y=1009 w=121 h=270 — its left edge sits at
 * exactly x=1464, which is also the circle's leftmost point, and its bottom at
 * exactly y=1279, the circle's bottom. Coincident edges do not cancel under
 * antialiasing: the renderer leaves a hairline of the dark circle showing along
 * the left and lower-left, which reads as a faint oval outline.
 *
 * Measured on a 1200px render: pixel column 33 deviated from the ground colour
 * by 36/255 before this, and not at all after.
 *
 * The right edge must stay at 1585 — that is the split between the two halves,
 * and pushing it right would eat into the dark side.
 */
function patchMask(svg) {
  return svg.replace(
    /<rect x="1464" y="1009" width="121" height="270"/,
    '<rect x="1444" y="989" width="141" height="310"',
  );
}

function reframe(svg, box) {
  return patchMask(svg)
    /* Deliberately no fill="none" on the root: several paths carry no fill at
       all and depend on inheriting the default. Setting none blanks the mark. */
    .replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${box}">`)
    .replace(/<clipPath id="clip0"><rect[^/]*\/><\/clipPath>/,
      '<clipPath id="clip0"><rect x="0" y="0" width="4000" height="4000"/></clipPath>');
}

/**
 * Two traps here, both found the hard way:
 *
 * - The main circle has NO fill attribute and inherits the default black, so
 *   replacing the literal "#000000" misses it and the dark variant comes out
 *   dark-on-dark. Hence the explicit fill on the root element.
 * - The pale half is an opaque rect that MASKS the circle underneath. Making it
 *   transparent does not reveal the page background, it reveals the black circle
 *   and the mark collapses into a solid disc. It must be painted the background
 *   colour, which is why there are separate files per ground.
 *
 * The orange is left untouched; it reads on both.
 */
function recolour(svg, { ink, ground }) {
  return svg
    .replace(/^<svg/, `<svg fill="${ink}"`)
    .replace(/#000000/gi, '@@INK@@')
    .replace(/#FFFFFF/gi, ground)
    .replace(/@@INK@@/g, ink);
}

const out = {
  'logo.svg': recolour(reframe(src, FULL), ON_PAPER),
  'logo-dark.svg': recolour(reframe(src, FULL), ON_INK),
  'mark.svg': recolour(reframe(src, MARK), ON_PAPER),
  'mark-dark.svg': recolour(reframe(src, MARK), ON_INK),
};

/* The favicon needs its own opaque tile. Browser tab strips are light in some
   themes and dark in others, and a mark that relies on the page background
   disappears into one of them. */
out['favicon.svg'] = recolour(reframe(src, MARK), ON_PAPER)
  .replace(/(<svg[^>]*>)/, '$1<rect x="-1000" y="-1000" width="4000" height="4000" fill="#F0F2ED"/>');

mkdirSync(DIR, { recursive: true });
for (const [name, svg] of Object.entries(out)) {
  writeFileSync(resolve(DIR, name), svg);
  console.log(`  ${name.padEnd(16)} ${svg.length} bytes`);
}

console.log(`
NOTE: the wordmark is live text in "Aptos", a Microsoft font that is not on most
machines and is not loaded by this site, so it falls back to whatever sans-serif
the visitor has. To make the logo render identically everywhere, re-export the
source with the text converted to outlines and re-run this script.`);
