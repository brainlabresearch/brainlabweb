# Brain Lab — www.brainlabresearch.org

Static site for the RIT Brain Lab. Four HTML files, one stylesheet, one script.
No build step, no dependencies, no framework. Open `index.html` in a browser to
preview locally; what you see is what deploys.

```
index.html         home — hero, mission, latest three news items, join/publications
research.html      the three research areas
people.html        PI, current research assistants, alumni
news.html          full news list
publications.html  GENERATED — do not edit by hand (see below)
404.html
assets/css/site.css
assets/js/site.js
assets/people/     headshots (see below)
tools/             the publications generator
CNAME              custom domain for GitHub Pages
.nojekyll          tells Pages to serve the files as-is, no Jekyll processing
```

---

## Publications

`publications.html` is generated. Don't edit it — your changes get overwritten.

```bash
node tools/fetch-publications.mjs
```

Zero dependencies, no API key. `.github/workflows/publications.yml` also runs it
on the 1st of each month and commits the result only if something changed, so
the page keeps itself current.

**Why not Google Scholar.** Scholar has no public API and actively blocks
automated access — CAPTCHAs, IP bans. A scraper works for a while, then breaks,
and can't run in CI at all. Scholar is still linked from the page and the footer.

**Two sources.** [OpenAlex](https://openalex.org) supplies the list of works,
the authors, and the open-access PDF links. [Crossref](https://crossref.org)
supplies the citation line — journal or proceedings name, volume, issue, pages —
because OpenAlex has no proceedings record for a lot of IEEE and ACM conferences
and would otherwise leave half the list with no venue at all. Both are free and
need no key.

**Crossref rate-limits aggressively.** At six concurrent requests it returned 429
for more than a third of them. Because a failed lookup falls back silently to
OpenAlex, the only symptom was a low venue count that looked like missing data
rather than a bug. The script now runs two at a time, retries on 429, and prints
a warning naming the number of failures. If you see that warning, just re-run —
and don't raise the concurrency.

**Two things about OpenAlex worth knowing:**

*Split identities.* Cory Merkel has two OpenAlex author records. Both are listed
in `CONFIG.authorIds` and the results de-duplicated. If publications start going
missing, search `api.openalex.org/authors?search=Cory Merkel` for a third record
and add its ID.

*Misattribution.* OpenAlex disambiguates authors automatically and sometimes
merges different people with the same name — it had credited a 1985 NASA report
on West German wind power. `CONFIG.minYear` filters the obvious cases; for a
wrong paper inside the year range, add its ID to `CONFIG.excludeIds`.

The nav and footer inside `tools/fetch-publications.mjs` are copies of the ones
in the other pages, the same way those duplicate each other. Change the nav
site-wide and you have to change it there too, or this page drifts.

---

## The topic cloud

The animated cloud at the bottom of `research.html` is built from the abstracts
OpenAlex holds for the lab's papers (88% of them have one).

```bash
node tools/fetch-topics.mjs      # writes assets/data/topics.json
```

Same monthly workflow regenerates it. The page reads the JSON at runtime;
`assets/js/topics.js` does the rendering.

**Why four-year windows and not years.** A single year is 2–12 papers, which is
far too few to read as a trend — the cloud would just flicker. Overlapping
four-year windows smooth that out without hiding the drift.

**Size is the only data encoding.** Colour carries nothing. An earlier version
coloured terms by rising/falling, but a teal dark enough to read as text on the
pale background lands within ΔE 9 of the neutral grey — indistinguishable even
with full colour vision, let alone with a colour-vision deficiency. The animation
already communicates change, so colour was dropped rather than faked.

**Two things in the generator worth not breaking:**

*Plurals* are folded into singulars only when the singular already appears in the
corpus on its own. Blind `s`-stripping turns "bias" into "bia".

*Unigrams* are dropped when a bigram containing them accounts for ≥40% of their
uses, so "neural" gives way to "neural network". Loosen that and the cloud shows
the same topic two or three times.

If you add a term to the stopword list, put it in the second group in
`tools/fetch-topics.mjs` — the one for academic boilerplate, not English filler.

---

## Deploying to GitHub Pages

1. Create an **organisation** (`brainlabresearch`, to match the domain) rather
   than using a personal account. The org name ends up in your DNS record, and
   ownership can be handed to the next person without moving the repo or
   touching DNS.
2. Create a public repo in it, named `brainlabweb`. Don't let GitHub add a README —
   you already have one, and it just causes a conflict on first push.
3. Push these files to the default branch, at the repo root.
4. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
5. **Settings → Pages → Custom domain**: it should already read
   `www.brainlabresearch.org` — the `CNAME` file here populates it automatically.
6. Add the DNS records below, then tick **Enforce HTTPS** once the certificate
   provisions (usually a few minutes, occasionally up to a day).

### DNS

At your registrar:

```
CNAME  www   <your-org>.github.io.          ← note the trailing dot
A      @     185.199.108.153
A      @     185.199.109.153
A      @     185.199.110.153
A      @     185.199.111.153
```

The `CNAME` file in this repo says `www`, which makes the www version primary.
GitHub then redirects the bare `brainlabresearch.org` to it automatically —
that's what the four A records are for. You don't need a redirect rule.

> Verify the four A records against GitHub's current Pages documentation before
> you paste them — they have changed before, and a stale IP is a silently dead site.

If you use Cloudflare for DNS, set these to **DNS only** (grey cloud) until the
GitHub certificate issues, otherwise the challenge can't complete. You can switch
to proxied afterwards if you want the analytics.

---

## Headshots

The site expects local images at `assets/people/<first-last>.jpg`, square-ish.
Until a file exists, that person shows a styled initials tile, so nothing breaks.

To pull the existing photos off rit.edu once:

```bash
bash assets/people/fetch-headshots.sh
```

Do this rather than linking to rit.edu directly — hotlinking means RIT can break
your site by reorganising a folder, which is the thing this move was meant to fix.
`cory-merkel.jpg` has to be added by hand; the directory URL carries an expiring token.

---

## Routine edits

Edit, commit, push. Pages redeploys in under a minute.

**Add a lab member** — copy an `<a class="member">` block in `people.html`,
change the name, initials, programme, image path, and link. Drop the photo in
`assets/people/`.

**Move someone to alumni** — delete their `member` block, add an `alum` row with
year and thesis title.

**Add news** — copy an `<a class="news-item">` block in `news.html`. Keep the list
newest-first, and mirror the top three onto `index.html`.

**Add a page** — drop the `.html` file at the repo root and add it to `sitemap.xml`.

**Change a nav link or the footer** — these are duplicated across all four pages
on purpose (no build step means nothing can fail to build). Search-and-replace
across `*.html`.

---

## Things worth doing later

- **Keep `rit.edu/brainlab` alive** as a one-page stub pointing here. Department
  directories, grant reports, and old news articles link there, and a `.edu` domain
  carries real search weight. Don't delete it.
- **Selected publications section.** Right now Publications links straight to
  Google Scholar. Six to eight hand-picked papers with venue and PDF links on the
  site itself is the single biggest upgrade for recruiting.
- **Analytics.** Cloudflare Web Analytics is cookieless, so no consent banner.
- **Auto-renew the domain**, registered several years out. Lapsed renewal is the
  usual way lab sites die.

## Design notes

Two accent colours, used as two populations: `--excite` is RIT orange, `--inhibit`
is teal. The hero canvas is a spike raster — rows are neurons, x is time, events
flow right to left like a live recording — and the same tick motif recurs in the
section divider and the three research glyphs (crossbar array, spike train,
decision boundary with one sample pushed across it). Dark bands are the instrument
screen; the pale ground is the lab notebook. Type is Archivo for display,
Newsreader for prose, IBM Plex Mono for anything numeric or labelled.

`prefers-reduced-motion` is respected: the raster renders one static frame and
scroll reveals are disabled.
