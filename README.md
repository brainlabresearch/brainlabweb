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

The animated cloud at the bottom of `research.html` is built from the lab's paper
titles.

```bash
node tools/fetch-topics.mjs      # writes assets/data/topics.json
```

Same monthly workflow regenerates it. `assets/js/topics.js` renders it.

**Titles, not abstracts.** Abstracts give ten times the words but nearly all of
them are prose scaffolding; a title is already the author's compression of the
work down to its subject. Switching cut the vocabulary from 121 terms to 51, and
every one of those is now an actual topic.

**The window slides by paper, not by year.** It holds twenty consecutive papers
and advances one at a time, so consecutive frames differ by one paper in and one
out. Year-stepping gave 13 frames and looked like a slideshow; paper-stepping
gives 69 and reads as continuous drift. Windows straddle year boundaries as a
side effect, which is fine — publication years are an accident of review cycles.

**The layout is polar, and radius is a real encoding.** Each term owns one fixed
angle for the whole animation and only ever moves along that ray: near the centre
while it is central to the work, drifting outward and fading as it leaves. The
fixed angle is what lets the eye track a term across fifteen years.

**Motion is continuous, not stepped.** The window index is a float advanced every
animation frame and positions are interpolated between the two windows either
side of it. It deliberately does not use CSS transitions: retargeting a
transition mid-flight restarts its easing curve, so the words re-accelerated from
a standstill several times a second, which is what made an early version choppy.
`SPEED` at the top of the file is the one pacing knob.

**There is no play control.** The timeline is inside the panel — the year range
bottom-left and a hairline filling along the bottom edge — and hovering or
focusing the cloud pauses it. It also stops entirely when scrolled out of view.

**Four things that will bite if you change them:**

*Radius comes from rank, not raw count.* A twenty-title window yields counts like
2, 2, 2, 3, 9 — normalise those directly and every term lands in a knot at the
centre using a third of the panel. Rank spreads them evenly however compressed
the counts are. Exact counts still appear in the tooltip and the table.

*Bigrams only form from words adjacent in the original title.* Stopword removal
pulls survivors together, so "Thermal Profiling **of** CMOS" would otherwise
produce the phantom bigram "profiling cmos". `tokenize()` keeps each word's
original index for exactly this reason.

*Plurals fold into singulars only when the singular already occurs in the corpus.*
Blind `s`-stripping turns "bias" into "bia".

*Words are absolutely positioned so they cannot reflow each other.* In the earlier
flow layout, animating size reflowed the container mid-animation, so position
measurements read stale geometry and words piled on top of one another.

*The collision solver is tuned for a wide, short panel.* It prefers separating
words horizontally and clamps to the panel on every pass. Separating along
whichever axis needs the smaller push — the obvious rule — picks vertical almost
every time here, because the boxes are wider than they are tall and vertical is
the direction with no room. Clamping only after the loop is just as bad: words
pushed past the edge get slammed back onto whatever they were separated from.

**Colour carries no data**, here or in the publication list. Size and radius
already encode frequency, and the two site accents are not separable enough as
text on the pale background to encode anything a reader could decode — a teal
dark enough to pass contrast lands within ΔE 9 of neutral grey, indistinguishable
even with full colour vision.

To suppress a word, add it to the second group of the stopword list in
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

## The logo

`assets/icons/brainlablogo.svg` is the source. Everything else in that folder is
generated:

```bash
node tools/build-logo.mjs
```

| File | Used for |
|---|---|
| `mark.svg` / `mark-dark.svg` | the circular mark in the nav |
| `logo.svg` / `logo-dark.svg` | full lockup — the footer uses the light one |
| `favicon.svg` | browser tab |
| `apple-touch-icon.png` | iOS home screen (180×180) |
| `og-card.png` | social preview (1200×630) |

**Why there are light and dark files instead of one recolourable one.** The mark
is two-tone by design — a pale half and a dark half — so it cannot follow a
single CSS `color` the way a one-colour glyph would. The nav swaps between them
as it flips from the dark band to the light stuck state.

**Two traps in the source**, both of which produced a blank or broken logo before
being handled in `build-logo.mjs`:

- The main circle carries **no `fill` attribute** and relies on inheriting the
  default black. Search-and-replacing `#000000` misses it, and the dark variant
  comes out dark-on-dark.
- The pale half is an **opaque rect that masks the circle beneath it**. Making it
  transparent doesn't reveal the page background, it reveals the black circle and
  the mark collapses into a solid disc. It has to be painted the background
  colour — which is the reason for per-ground files.

It is also a PowerPoint export, so it arrives with a fixed width/height and a
clipPath pinned to a much larger canvas. The script swaps that for a viewBox —
expressed **after** the group's `translate(-1397,-1009)`, since using the
original canvas coordinates frames empty space.

**Outstanding: the wordmark is live text in Aptos**, a Microsoft font that almost
nobody else has and that this site does not load, so it silently falls back to
whatever sans-serif the visitor happens to have. The logo therefore renders
slightly differently from machine to machine. The fix is to re-export the source
with the text converted to outlines, then re-run the script.

To regenerate the two PNGs after changing the source, see the commands in the
commit that added them — they are rendered from HTML with headless Chrome, since
there is no image tooling in this repo.

---

## The three-thrusts figure

`assets/icons/thrusts.jpg` is the diagram at the top of the research page. Three
percentage-positioned hotspots sit over its columns: hovering or focusing one
highlights it, clicking jumps to the matching section below (`#area-1`,
`#area-2`, `#area-3`). They are plain anchors — no JavaScript involved.

The three section headings deliberately match the figure's column labels, so the
graphic and the prose name the same three things.

`brainlabthrusts.svg` is the original as supplied — an SVG wrapper around a
single embedded JPEG. The JPEG was extracted out of it because the base64 wrapper
was 102 KB against 76 KB for the image itself.

**The white background is dropped with `mix-blend-mode: multiply`,** not by
keying the image. The figure is black line art on white, and multiply makes the
white read as whatever is behind it, so the diagram sits on the paper rather than
in a white box. No transparent PNG needed. It only works over a light ground,
which is true everywhere it is used.

**Hotspots are positioned in percentages** so they track the image at any width,
and they stop at 84% height — below that is the brace and caption, which belong
to all three columns rather than any one.

The figure is capped at 560px, well under the image's native 861px — it is an
orientation graphic above the real content, not the content itself. Below 620px
the hotspots are hidden, since they stop being a usable tap target.

`.area` carries a `scroll-margin-top` so an anchor jump does not land with the
heading hidden behind the fixed nav.

---

## Thesis links

Alumni thesis titles link to the record in RIT's institutional repository.

```bash
node tools/match-theses.mjs           # report, change nothing
node tools/match-theses.mjs --write   # apply the links
```

**Run it only when a thesis alum is added — never on a schedule.** It harvests
~11,000 records, and a repository URL never changes once assigned, so there is
nothing to keep in sync. The harvest is cached in `tools/.theses-cache.json`
(gitignored, 1.4 MB); delete it to force a refresh.

**Only theses are linked, not projects.** RIT deposits theses; project reports
generally are not, so searching for those yields misses at best and false matches
at worst. The script keys off the `· Thesis` / `· Project` label already in each
row.

**It must use the `qdc` metadata format.** This is the trap, and it produced
links that were *wrong rather than broken* the first time:

- bepress keeps two unrelated numbering schemes. The OAI header identifier is an
  internal article number; the public page uses a different sequence. Article
  1005 lives at `/theses/21`, and `/theses/12482` is article 13617 — no offset
  between them.
- Deriving the URL from the header gave `/theses/12707` for Shery Mathews, which
  is a real, live page — for somebody else's thesis on B2B cybersecurity sales.
  Only spot-checking the live URLs caught it.
- `oai_dc` exposes just the PDF under `/context/`, which 403s outside a browser.
  `qdc` puts the real landing page in `dc:identifier`.

**Its search cannot be used.** `/do/search/` is a JavaScript Solr client; fetching
it returns a shell reading "No results" whatever the query, and the JSON endpoints
its own scripts call 404 from outside. OAI-PMH is the supported machine interface.

A title match alone is not accepted — the alum's surname must also appear in the
record's `dc:creator`, so a generic title cannot silently attach to the wrong
person's work.

**The repository is authoritative for thesis titles.** Two entries here were
corrected to match their deposited records, along with the spelling of Shery
Mathews' name. If a title stops matching, check the repository before assuming
the script is broken.

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

## Course notes

`learn.html` is a hub listing courses; each course has its own page, currently
just `learn-machine-intelligence.html`. Slides live in
`assets/learn/<course-slug>/` and are served straight from the repo — no login,
no myCourses.

The lecture lists are generated:

```bash
node tools/build-learn.mjs
```

It reads every PDF, counts the slides, measures the file, and rewrites the block
between `<!-- LECTURES:START -->` and `<!-- LECTURES:END -->`, plus the totals
between the `COUNT` markers on both pages. Slide counts and file sizes are the
sort of number that rots quietly when typed by hand, so they are never typed.

**Order and titles come from the `COURSES` table in the script, not from
filenames.** `introduction.pdf` sorts after `classification.pdf`, and no naming
scheme survives a course that reorders a topic mid-semester. The running order
for Machine Intelligence follows the topic list in the course syllabus.

**Adding a lecture** — copy the PDF into the course folder, add a row to
`lectures` in the right position, re-run. A PDF in the folder that no row
mentions is reported and left unpublished, so a deck dropped in and forgotten
does not sit there invisibly.

**Adding a course** — copy `learn-machine-intelligence.html`, keep the four
marker comments, add an entry to `COURSES` and a card to `learn.html`. Then
`sitemap.xml`, and `node tools/stamp-assets.mjs`.

Filenames are the source filenames with underscores turned into hyphens, which
keeps re-syncing from the course folder a mechanical step rather than a lookup.

**Two things deliberately not published.** `lagrange_multipliers_bishop.pdf` is
Appendix E of Bishop's *Pattern Recognition and Machine Learning* — someone
else's copyright, so it stays out. And `combining_models` exists only as a
`.pptx`, with no PDF alongside it; export one and it can be added.

`*.pdf` and `*.pptx` are marked `binary` in `.gitattributes`. This is not
optional: the blanket `text=auto` above them otherwise guesses, and a PDF guessed
wrong has its line endings rewritten on checkout, which corrupts it silently —
it downloads and then refuses to open.

---

## Routine edits

Edit, commit, push. Pages redeploys in under a minute.

**Add a lab member** — copy a `<button class="member">` block in `people.html`,
change the name, initials, programme, and image path. Then copy a
`<dialog class="bio">` block, give it a unique `id`, and point the button's
`data-bio` at that id. Drop the photo in `assets/people/`.

**Photos should be square**, ideally 300×300 to match the rest. A non-square file
still works — the tile is `aspect-ratio:1/1` with `object-fit:cover` — but the
crop is taken from the *centre*, which on a portrait photo usually slices through
the top of the head. Crop it yourself and the framing stays under your control.

Member tiles are **buttons, not links** — clicking opens a bio dialog rather than
navigating to rit.edu. It uses the native `<dialog>` element, so Escape closes
it, focus is trapped while open, and the page behind is inert without any of that
being hand-written. `site.js` only wires up opening, the close button, and
backdrop clicks.

**Move someone to alumni** — delete their `member` block, add an `alum` row with
year and thesis title.

**Add news** — you usually don't. `news.html` is generated:

```bash
node tools/fetch-news.mjs
```

It reads RIT's Brain Lab news index, scrapes each article for title, date, and
summary, rewrites the list in `news.html`, and mirrors the newest three onto
`index.html`. Both regions are delimited by `<!-- NEWS:START -->` /
`<!-- NEWS:END -->` markers; everything outside them is left alone. The monthly
workflow runs it too.

For a story **not on rit.edu** — press coverage elsewhere — add it to the
`MANUAL` array in that script. Those are merged with the scraped items and the
whole list re-sorted by date.

**Why that source and not a search of all RIT news.** There is no clean feed for
"every RIT article mentioning Cory Merkel":

- rit.edu publishes no RSS — `/news/rss.xml`, `/news/rss` and `/news/feed` all
  return the ordinary HTML page.
- There's no author archive; `/news/cory-merkel` returns RIT's generic
  "Latest News (frontpage)" catch-all.
- Their site search is JavaScript-driven, so it can't be fetched.
- Google News RSS does find articles, but a `"Cory Merkel"` query also returns
  two obituaries for a different Merkel and an ice-hockey report, and restricting
  to `site:rit.edu` returns mostly directory pages. Its links are opaque
  `news.google.com` redirects rather than real article URLs.

So the lab's own news index is the source. It's curated and stable, with real
absolute URLs — but it is a *subset*: anything published elsewhere on rit.edu
that never got added to the lab's page won't appear. `MANUAL` is the escape
hatch.

One quirk handled in the script: RIT truncates its own meta descriptions
mid-word. Summaries are trimmed back to the last complete sentence, or the last
whole word plus an ellipsis. Sentence detection ignores abbreviations — matching
a bare `". "` cut *"published on Jan. 22 in Natu"* down to *"published on Jan."*

### Article images

Each scraped item gets a thumbnail, downloaded into `assets/news/` and committed
— never hotlinked. Same reasoning as the headshots: an image served from RIT is
an image RIT can move or delete out from under the site.

Two URLs exist for the same picture, and picking the right one matters. The
article page carries the full-size original on `cdn.rit.edu` (~180 KB each, about
1 MB across the list); the news *index* carries Drupal's pre-sized
`news_thumbnail` variant, roughly 3.5× smaller. The script prefers the thumbnail
and falls back to the original. Total is around 330 KB.

Those thumbnail URLs carry an `itok` signature that **expires** — fatal if we
hotlinked them, irrelevant when downloading, since the token only has to be valid
for that one fetch. But it does mean a later run can fail to re-fetch a picture
that is already on disk, so `saveImage()` keeps the existing file when a download
fails. Without that, an item would silently lose its image while the file stayed
orphaned in the repo.

The two URLs share a filename, and that is what matches a thumbnail to its
article. Note the article page also contains `news_thumbnail` images for *other*
stories listed alongside it — matching those would attach the wrong picture,
which is why the article's own hero is identified by its absolute `cdn.rit.edu`
URL specifically.

A `MANUAL` entry can set `imageUrl` to have its picture downloaded the same way.
Items with no image still emit an empty thumbnail cell, so every headline in the
list starts on the same vertical line.

### feed.xml

The same script writes `feed.xml`, an RSS feed of the news list, linked from
every page's `<head>` so browsers and readers can discover it.

It deliberately has **no `<lastBuildDate>`**. Stamping the current time would
rewrite the file on every run, so the monthly workflow's "commit only if
something changed" check would fire every month and redeploy for nothing. The
newest item's `pubDate` carries the same information and only moves when the news
does.

The feed is also the integration point for pushing news out to social platforms —
see below.

---

## Posting news out to LinkedIn and X

The site is the source of truth; `feed.xml` is what the outside world watches.
Two ways to wire it up, and the choice hinges on LinkedIn, not X.

**Recommended — a feed watcher.** Point Zapier, Make, or Buffer at
`https://www.brainlabresearch.org/feed.xml` with an RSS trigger, and have it post
to the LinkedIn *Page* and X. These services are already approved partners on
both platforms, so they handle OAuth, token refresh, and LinkedIn's organisation
posting permission. Nothing about this lives in the repo and no credentials are
stored here.

**Direct from CI**, if you'd rather not use a third party:

- **X** is workable. Its free API tier still allows writes. A GitHub Action can
  POST to `/2/tweets` with OAuth 1.0a credentials kept as repository secrets.
- **LinkedIn is the hard part.** Posting as an *organisation* needs
  `w_organization_social`, part of the Community Management API, which requires
  app review and approval. Its tokens also expire every 60 days and refreshing
  them is interactive — which does not survive an unattended monthly cron.

**One design decision either way.** `news.html` is mostly *scraped from RIT*, so
auto-posting every new entry would rebroadcast RIT's articles as though they were
lab announcements. If that isn't wanted, gate it: broadcast only items from the
`MANUAL` array, or add an `announce: true` flag and emit a separate
`feed-announce.xml` for the watcher to read.

**Add a page** — drop the `.html` file at the repo root and add it to `sitemap.xml`.

**Change a nav link or the footer** — these are duplicated across all four pages
on purpose (no build step means nothing can fail to build). Search-and-replace
across `*.html`.

**After editing anything in `assets/css` or `assets/js`, run:**

```bash
node tools/stamp-assets.mjs
```

This appends `?v=<hash>` to every reference to the site's own CSS, JS, and icons
— in the HTML, in the `url()`s inside `site.css`, and in the absolute `og:image`
URL. Without it, GitHub Pages and the browser will happily serve stale assets
against fresh HTML, and the symptom is silent: a fix appears not to have worked
when it simply has not loaded.

It has bitten twice. Once on the bio dialogs, where a cached `site.js` meant
clicking a tile did nothing. Once on the logo, where a corrected SVG was live and
verified while the browser kept serving the old one — which is why icons are
covered now and not just code.

Icons are stamped before the stylesheet hash is computed, since `site.css`
references them; doing it the other way round would produce a CSS hash for a
version of the file that never shipped. The script is idempotent — running it
twice changes nothing.

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
