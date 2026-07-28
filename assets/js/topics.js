/* Brain Lab — animated topic cloud.
   Reads assets/data/topics.json (built by tools/fetch-topics.mjs from paper
   titles) and slides a twenty-paper window forward one paper at a time.

   LAYOUT is polar. Every term owns a fixed angle for the whole animation and
   only ever moves along that one ray: frequent terms sit near the centre and
   large, and as a term fades from the lab's output it drifts outward, shrinking,
   until it leaves the edge. Radius is therefore a real encoding — distance from
   centre means "how central to the work right now" — and because a term's angle
   never changes, the eye can track it across the whole fifteen years.

   Two consequences worth knowing:

   - Every term in the vocabulary stays in the DOM permanently, at opacity 0 when
     it is absent from the current window. Nothing is ever added or removed, so
     there is no enter/exit popping — only movement.
   - The words are absolutely positioned, so they cannot reflow each other. That
     is what makes it safe to transition font-size here; in the earlier flow
     layout, animating size reflowed the container mid-transition and words piled
     up on one another.

   Colour carries no data. Size and radius already encode frequency, and the two
   site accents are not separable enough as text on this pale ground to encode
   anything a reader could actually decode. */
(function () {
  var root = document.querySelector('[data-topics]');
  if (!root) return;

  var cloud = root.querySelector('.cloud');
  var playBtn = root.querySelector('.cloud-play');
  var scrub = root.querySelector('.cloud-scrub');
  var label = root.querySelector('.cloud-window');
  var tableBody = root.querySelector('.cloud-table tbody');
  var status = root.querySelector('.cloud-status');
  var tip = root.querySelector('.cloud-tip');

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HOLD = 340;          /* ms per frame — shorter than the CSS transition, on
                              purpose: words are still travelling when the next
                              frame retargets them, which is what turns a series
                              of steps into continuous drift. */
  var GOLDEN = 137.50776;  /* degrees; the phyllotaxis angle. Spreads successive
                              vocabulary entries around the circle without the
                              clustering a random or evenly-divided angle gives. */

  var windows = [];
  var nodes = {};
  var at = 0;
  var timer = null;
  var rx = 0, ry = 0;

  fetch('assets/data/topics.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function (data) {
      windows = data.windows || [];
      if (!windows.length || !data.vocab) throw new Error('empty');
      build(data.vocab);
      start();
    })
    .catch(function () {
      if (status) { status.hidden = false; }
      root.classList.add('cloud-failed');
    });

  function build(vocab) {
    vocab.forEach(function (term, i) {
      var el = document.createElement('span');
      el.className = 'w';
      el.textContent = term;
      el.dataset.t = term;
      /* Fixed for the lifetime of the animation. */
      el.dataset.a = String((i * GOLDEN) % 360);
      bindTip(el);
      cloud.appendChild(el);
      nodes[term] = el;
    });
    measure();
    addEventListener('resize', function () { measure(); paint(windows[at], false); });
  }

  function measure() {
    var b = cloud.getBoundingClientRect();
    /* Inset generously: a word is placed by its centre, so a long term sitting
       at the rim would otherwise hang outside the panel. */
    rx = Math.max(60, b.width / 2 - 96);
    ry = Math.max(50, b.height / 2 - 34);
  }

  function start() {
    root.classList.add('cloud-ready');
    scrub.max = String(windows.length - 1);
    scrub.value = '0';
    paint(windows[0], false);

    scrub.addEventListener('input', function () {
      pause();
      show(Number(scrub.value));
    });
    playBtn.addEventListener('click', function () { timer ? pause() : play(); });

    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { play(); io.disconnect(); } });
      }, { threshold: 0.3 });
      io.observe(root);
    }
  }

  function play() {
    if (timer) return;
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-label', 'Pause the topic animation');
    timer = setInterval(function () { show((at + 1) % windows.length); }, HOLD);
  }

  function pause() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-label', 'Play the topic animation');
  }

  function show(i) {
    at = i;
    scrub.value = String(i);
    paint(windows[i], true);
  }

  function paint(w, animate) {
    if (!w) return;
    var present = {};
    w.terms.forEach(function (t) { present[t.t] = t.n; });

    scrub.setAttribute('aria-valuetext', w.from + ' to ' + w.to);
    label.innerHTML = '<b>' + w.from + '–' + w.to + '</b><span>' + w.papers + ' papers</span>';

    /* Radius comes from RANK, not from the raw count.
       A twenty-title window produces counts like 2, 2, 2, 3, 9 — so normalised
       frequency spans a narrow band near the top and every term lands in a knot
       at the centre, using maybe a third of the panel. Rank spreads them evenly
       across the full radius however compressed the counts happen to be. Within
       a frame rank IS frequency order, so the meaning is unchanged; the counts
       are still exact in the tooltip and the table. */
    var ranked = w.terms.slice().sort(function (a, b) {
      return (b.n - a.n) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
    });
    var N = ranked.length;
    var wmin = parseFloat(getComputedStyle(cloud).getPropertyValue('--wmin')) || 12;
    var wmax = parseFloat(getComputedStyle(cloud).getPropertyValue('--wmax')) || 38;

    var live = ranked.map(function (t, rank) {
      var p = N > 1 ? 1 - rank / (N - 1) : 1;
      var el = nodes[t.t];
      var theta = Number(el.dataset.a) * Math.PI / 180;
      var tr = Math.pow(1 - p, 0.78) * 0.95;
      var fs = wmin + (wmax - wmin) * p;
      return {
        el: el, n: t.n, p: p, fs: fs,
        x: Math.cos(theta) * rx * tr,
        y: Math.sin(theta) * ry * tr,
        /* 0.54em average glyph width is close enough for Archivo at these
           weights; this only has to be good enough to detect a collision. */
        hw: t.t.length * fs * 0.54 / 2,
        hh: fs * 1.15 / 2,
      };
    });

    relax(live);

    live.forEach(function (o) {
      o.el.style.transform = 'translate(-50%,-50%) translate('
        + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px)';
      o.el.style.setProperty('--s', o.p.toFixed(3));
      o.el.style.opacity = (0.42 + 0.58 * o.p).toFixed(2);
      o.el.style.zIndex = String(Math.round(o.p * 20));
      o.el.dataset.n = o.n;
      o.el.setAttribute('aria-hidden', 'false');
      o.el.style.pointerEvents = 'auto';
    });

    /* Everything not in this window is parked just beyond the rim at zero
       opacity, on its own ray — so when it returns it drifts inward from
       off-panel rather than popping into existence. */
    Object.keys(nodes).forEach(function (term) {
      if (term in present) return;
      var el = nodes[term];
      var theta = Number(el.dataset.a) * Math.PI / 180;
      el.style.transform = 'translate(-50%,-50%) translate('
        + (Math.cos(theta) * rx * 1.18).toFixed(1) + 'px,'
        + (Math.sin(theta) * ry * 1.18).toFixed(1) + 'px)';
      el.style.opacity = '0';
      el.style.zIndex = '0';
      el.dataset.n = 0;
      el.setAttribute('aria-hidden', 'true');
      el.style.pointerEvents = 'none';
    });

    if (!animate) {
      /* First paint: skip the transition so it does not fly in from the origin. */
      cloud.classList.add('no-anim');
      void cloud.offsetWidth;
      requestAnimationFrame(function () { cloud.classList.remove('no-anim'); });
    }

    describe(w);
  }

  /**
   * Nudge overlapping words apart.
   *
   * Fixed angles guarantee smooth travel but guarantee nothing about spacing —
   * two terms can share almost the same ray and sit on top of each other. A few
   * iterations of pushing overlapping boxes apart fixes that, and because the
   * input positions only change a little between frames, the relaxed output
   * changes a little too. So this stays smooth; it does not jitter.
   *
   * Bigger words win: displacement is weighted by the other word's prominence,
   * so a peripheral term gives way to a central one rather than shoving it off
   * its ray.
   */
  function relax(list) {
    for (var pass = 0; pass < 7; pass++) {
      var moved = false;
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i], b = list[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var ox = (a.hw + b.hw + 7) - Math.abs(dx);
          var oy = (a.hh + b.hh + 5) - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;

          moved = true;
          /* Separate along whichever axis needs the least movement. */
          var wa = b.p + 0.15, wb = a.p + 0.15;
          var tot = wa + wb;
          if (ox < oy) {
            var sx = (dx < 0 ? -1 : 1) * ox;
            a.x -= sx * (wa / tot); b.x += sx * (wb / tot);
          } else {
            var sy = (dy < 0 ? -1 : 1) * oy;
            a.y -= sy * (wa / tot); b.y += sy * (wb / tot);
          }
        }
      }
      if (!moved) break;
    }
    /* Keep everything inside the panel after all that shoving. */
    list.forEach(function (o) {
      o.x = Math.max(-rx - 40, Math.min(rx + 40, o.x));
      o.y = Math.max(-ry, Math.min(ry, o.y));
    });
  }

  function bindTip(el) {
    if (!tip) return;
    el.addEventListener('mouseenter', function () {
      if (!Number(el.dataset.n)) return;
      tip.textContent = el.dataset.t + ' · ' + el.dataset.n + ' of ' + windows[at].papers + ' titles';
      tip.hidden = false;
    });
    el.addEventListener('mousemove', function (ev) {
      var box = root.getBoundingClientRect();
      tip.style.left = (ev.clientX - box.left) + 'px';
      tip.style.top = (ev.clientY - box.top - 14) + 'px';
    });
    el.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  /* The cloud is unreadable to a screen reader, so the same figures are
     published as a table and the region carries a plain-language summary. */
  function describe(w) {
    var top = w.terms.slice().sort(function (a, b) { return b.n - a.n; });
    cloud.setAttribute('aria-label',
      'Most frequent terms in Brain Lab paper titles, ' + w.from + ' to ' + w.to
      + '. Leading terms: ' + top.slice(0, 6).map(function (t) { return t.t; }).join(', ') + '.');
    if (!tableBody) return;
    tableBody.innerHTML = top.map(function (t) {
      return '<tr><td>' + esc(t.t) + '</td><td>' + t.n + '</td></tr>';
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
