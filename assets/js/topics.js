/* Brain Lab — animated topic cloud.
   Reads assets/data/topics.json (built by tools/fetch-topics.mjs from paper
   titles) and slides a twenty-paper window forward one paper at a time.

   LAYOUT is polar. Every term owns a fixed angle for the whole animation and
   only ever moves along that one ray: frequent terms sit near the centre and
   large, and as a term fades from the lab's output it drifts outward, shrinking,
   until it leaves the edge. Radius is a real encoding — distance from centre
   means "how central to the work right now" — and because a term's angle never
   changes, the eye can track it across the whole fifteen years.

   MOTION is continuous, not stepped. The window index is a float advanced every
   animation frame, and each term's position is interpolated between the two
   windows either side of it. An earlier version stepped discretely and leaned on
   CSS transitions to smooth the gaps, which was visibly choppy: retargeting a
   transition every 340ms restarts its easing curve, so the words re-accelerated
   from a standstill several times a second. Nothing here transitions in CSS.

   Layouts for all windows — including the collision-relaxation pass — are solved
   once up front and cached. Relaxing on every animation frame would let the
   solver flip between equally-valid arrangements and the cloud would shimmer. */
(function () {
  var root = document.querySelector('[data-topics]');
  if (!root) return;

  var cloud = root.querySelector('.cloud');
  var meta = root.querySelector('.cloud-meta');
  var bar = root.querySelector('.cloud-progress i');
  var status = root.querySelector('.cloud-status');
  var tip = root.querySelector('.cloud-tip');

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SPEED = 1.25;        /* windows per second — 69 frames, so a full pass
                              through fifteen years takes about 55 seconds */
  var GOLDEN = 137.50776;  /* phyllotaxis angle — spreads successive vocabulary
                              entries around the circle without the clustering a
                              random or evenly-divided angle produces. */

  var windows = [];
  var vocab = [];
  var nodes = {};
  var angle = {};
  var layouts = [];        /* layouts[windowIndex][term] = {x,y,fs,op} */
  var pos = 0;             /* float window index */
  var playing = false;
  var onScreen = false;
  var raf = null;
  var lastT = 0;
  var rx = 0, ry = 0;
  var wmin = 12, wmax = 38;

  fetch('assets/data/topics.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      windows = data.windows || [];
      vocab = data.vocab || [];
      if (!windows.length || !vocab.length) throw new Error('empty');
      build();
      start();
    })
    .catch(function () {
      if (status) status.hidden = false;
      root.classList.add('cloud-failed');
    });

  function build() {
    vocab.forEach(function (term, i) {
      var el = document.createElement('span');
      el.className = 'w';
      el.textContent = term;
      el.dataset.t = term;
      bindTip(el);
      cloud.appendChild(el);
      nodes[term] = el;
      angle[term] = ((i * GOLDEN) % 360) * Math.PI / 180;
    });
    solveAll();

    var pending;
    addEventListener('resize', function () {
      clearTimeout(pending);
      pending = setTimeout(function () { solveAll(); draw(); }, 120);
    });
  }

  function measure() {
    var b = cloud.getBoundingClientRect();
    var cs = getComputedStyle(cloud);
    wmin = parseFloat(cs.getPropertyValue('--wmin')) || 12;
    wmax = parseFloat(cs.getPropertyValue('--wmax')) || 38;
    /* Inset generously: a word is placed by its centre, so a long term at the
       rim would otherwise hang outside the panel. */
    rx = Math.max(70, b.width / 2 - 104);
    ry = Math.max(46, b.height / 2 - 30);
  }

  /* Solve every window's layout once. Cheap (69 x ~12 words) and it means the
     animation loop only has to interpolate. */
  function solveAll() {
    measure();
    layouts = windows.map(function (w) {
      /* Ranked on the raw count. Smoothing the score across neighbouring windows
         was tried to damp rank churn and measured WORSE — mean normalised rank
         shift between adjacent windows went from 0.070 to 0.089, because
         blending in the neighbours imports their variance instead of cancelling
         it. Left alone deliberately; don't re-add it without measuring. */
      var ranked = w.terms.slice().sort(function (a, b) {
        return (b.n - a.n) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
      });
      var N = ranked.length;

      var live = ranked.map(function (t, rank) {
        /* Radius comes from RANK, not the raw count. A twenty-title window gives
           counts like 2, 2, 2, 3, 9 — normalise those directly and everything
           lands in a knot at the centre using a third of the panel. */
        var p = N > 1 ? 1 - rank / (N - 1) : 1;
        var tr = Math.pow(1 - p, 0.78) * 0.95;
        var fs = wmin + (wmax - wmin) * p;
        return {
          t: t.t, n: t.n, p: p, fs: fs,
          x: Math.cos(angle[t.t]) * rx * tr,
          y: Math.sin(angle[t.t]) * ry * tr,
          hw: t.t.length * fs * 0.54 / 2,
          hh: fs * 1.15 / 2,
        };
      });

      relax(live);

      var out = {};
      live.forEach(function (o) {
        out[o.t] = { x: o.x, y: o.y, fs: o.fs, op: 0.42 + 0.58 * o.p, n: o.n, z: Math.round(o.p * 20) };
      });
      /* Absent terms park just beyond the rim on their own ray, so a returning
         term drifts inward from off-panel instead of appearing from nothing. */
      vocab.forEach(function (term) {
        if (out[term]) return;
        out[term] = {
          x: Math.cos(angle[term]) * rx * 1.2,
          y: Math.sin(angle[term]) * ry * 1.2,
          fs: wmin, op: 0, n: 0, z: 0,
        };
      });
      return out;
    });
  }

  /**
   * Nudge overlapping words apart.
   *
   * Fixed angles guarantee smooth travel but nothing about spacing — two terms
   * can share almost the same ray. Bigger words win: displacement is weighted by
   * the other word's prominence, so a peripheral term gives way to a central one
   * rather than shoving it off its ray.
   */
  function relax(list) {
    /* The panel is wide and short, so there is far more slack sideways than
       vertically. Two corrections follow from that:

       - Prefer horizontal separation. Picking whichever axis needs the smaller
         push (the obvious rule) almost always picks vertical here, because the
         boxes are wider than they are tall — and vertical is exactly the
         direction with no room.
       - Clamp inside the loop, not after it. Clamping only at the end undoes the
         solver's work: words pushed past the edge get slammed back on top of
         whatever they were separated from. */
    for (var pass = 0; pass < 26; pass++) {
      var moved = false;
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i], b = list[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var ox = (a.hw + b.hw + 9) - Math.abs(dx);
          var oy = (a.hh + b.hh + 6) - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          var wa = b.p + 0.15, wb = a.p + 0.15, tot = wa + wb;
          if (ox < oy * 2.6) {
            var sx = (dx < 0 ? -1 : 1) * ox;
            a.x -= sx * (wa / tot); b.x += sx * (wb / tot);
          } else {
            var sy = (dy < 0 ? -1 : 1) * oy;
            a.y -= sy * (wa / tot); b.y += sy * (wb / tot);
          }
        }
      }
      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        o.x = Math.max(-rx - 60, Math.min(rx + 60, o.x));
        o.y = Math.max(-ry, Math.min(ry, o.y));
      }
      if (!moved) break;
    }
  }

  function start() {
    root.classList.add('cloud-ready');
    draw();

    /* No play control, so pausing has to come from attention: hovering or
       focusing holds the current window still long enough to read it. */
    cloud.addEventListener('mouseenter', stop);
    cloud.addEventListener('mouseleave', function () { if (onScreen) go(); });
    cloud.addEventListener('focus', stop);
    cloud.addEventListener('blur', function () { if (onScreen) go(); });

    if (reduce) return;
    if (!('IntersectionObserver' in window)) { onScreen = true; go(); return; }
    /* Toggle rather than disconnect: no reason to burn frames on a section
       that has scrolled out of view. */
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        onScreen = e.isIntersecting;
        onScreen ? go() : stop();
      });
    }, { threshold: 0.2 }).observe(cloud);
  }

  function go() {
    if (playing) return;
    playing = true;
    lastT = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
  }

  function tick(now) {
    if (!lastT) lastT = now;
    /* Cap dt so a backgrounded tab doesn't jump the animation on return. */
    var dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    pos = (pos + dt * SPEED) % windows.length;
    draw();
    raf = requestAnimationFrame(tick);
  }

  function draw() {
    var i0 = Math.floor(pos) % windows.length;
    var i1 = (i0 + 1) % windows.length;
    var f = pos - Math.floor(pos);
    /* Smoothstep across the crossfade so terms ease in and out of each window
       rather than changing direction abruptly at the boundary. */
    var e = f * f * (3 - 2 * f);

    var A = layouts[i0], B = layouts[i1];
    if (!A || !B) return;

    for (var k = 0; k < vocab.length; k++) {
      var term = vocab[k];
      var a = A[term], b = B[term];
      var el = nodes[term];
      var op = a.op + (b.op - a.op) * e;

      if (op < 0.012) {
        if (el.style.opacity !== '0') {
          el.style.opacity = '0';
          el.setAttribute('aria-hidden', 'true');
          el.style.pointerEvents = 'none';
        }
        continue;
      }

      var x = a.x + (b.x - a.x) * e;
      var y = a.y + (b.y - a.y) * e;
      var fs = a.fs + (b.fs - a.fs) * e;

      el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      el.style.fontSize = fs.toFixed(2) + 'px';
      el.style.opacity = op.toFixed(3);
      el.style.zIndex = String(a.z);
      el.dataset.n = (e < 0.5 ? a.n : b.n);
      el.setAttribute('aria-hidden', 'false');
      el.style.pointerEvents = 'auto';
    }

    var w = windows[e < 0.5 ? i0 : i1];
    meta.innerHTML = '<b>' + w.from + '–' + w.to + '</b><span>' + w.papers + ' papers</span>';
    bar.style.width = (100 * pos / (windows.length - 1)).toFixed(2) + '%';
    describe(w);
  }

  function bindTip(el) {
    if (!tip) return;
    el.addEventListener('mouseenter', function () {
      if (!Number(el.dataset.n)) return;
      tip.textContent = el.dataset.t + ' · ' + el.dataset.n + ' titles';
      tip.hidden = false;
    });
    el.addEventListener('mousemove', function (ev) {
      var box = root.getBoundingClientRect();
      tip.style.left = (ev.clientX - box.left) + 'px';
      tip.style.top = (ev.clientY - box.top - 14) + 'px';
    });
    el.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  /* A moving cloud of words is meaningless to a screen reader, so the region
     carries a plain-language summary of whatever is currently showing. */
  var lastDesc = '';
  function describe(w) {
    var top = w.terms.slice().sort(function (a, b) { return b.n - a.n; })
      .slice(0, 6).map(function (t) { return t.t; }).join(', ');
    if (top === lastDesc) return;
    lastDesc = top;
    cloud.setAttribute('aria-label',
      'Most frequent terms in Brain Lab paper titles, ' + w.from + ' to ' + w.to + ': ' + top + '.');
  }
})();
