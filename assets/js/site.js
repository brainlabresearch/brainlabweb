/* Brain Lab — shared behaviour. No dependencies, no build step. */

/* Sticky nav: swaps to light once past the dark band. */
(function () {
  var nav = document.getElementById('nav');
  if (!nav) return;
  var band = document.querySelector('.hero, .pagehead');
  function onScroll() {
    var h = band ? band.offsetHeight - 70 : 200;
    nav.classList.toggle('stuck', window.scrollY > h);
  }
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
})();

/* Scroll reveal.

   threshold is 0, NOT a fraction of the element. A fractional threshold is a
   trap on tall sections: it asks for a percentage of the ELEMENT, so on the
   publications page — one section 11,235px tall — the old 0.08 demanded 899px
   of it be visible, more than the viewport itself. The page loaded to blank
   space and only appeared after scrolling several hundred pixels.

   The negative bottom margin keeps a little of the effect: an element starts its
   fade once it is ~60px into view rather than the instant its first pixel is. */
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(els, function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0, rootMargin: '0px 0px -60px 0px' });
  Array.prototype.forEach.call(els, function (el) { io.observe(el); });

  /* Safety net: content hidden by CSS must never stay hidden because an observer
     failed to fire. Anything still unrevealed after a moment gets shown. */
  setTimeout(function () {
    Array.prototype.forEach.call(els, function (el) {
      var b = el.getBoundingClientRect();
      if (b.top < innerHeight && b.bottom > 0) el.classList.add('in');
    });
  }, 1200);
})();

/* Hero spike raster.
   Rows are neurons, x is time, events flow right to left like a live recording.
   One row in seven fires in RIT orange so the plot reads as two populations. */
(function () {
  var c = document.getElementById('raster');
  if (!c) return;
  var ctx = c.getContext('2d');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROWS = 30, WINDOW = 6200;
  var W = 0, H = 0, rowH = 0, spikes = [], rates = [], last = 0, t = 0;

  function seed() {
    rates = [];
    for (var i = 0; i < ROWS; i++) rates.push(0.7 + 2.6 * Math.abs(Math.sin(i * 1.7)));
    spikes = [];
    for (var r = 0; r < ROWS; r++) {
      var u = -WINDOW;
      while (u < 0) {
        u += -Math.log(1 - Math.random()) / (rates[r] / 1000);
        if (u < 0) spikes.push([r, u]);
      }
    }
    t = 0;
  }
  function size() {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    W = c.clientWidth; H = c.clientHeight;
    c.width = W * d; c.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    rowH = H / ROWS;
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var tick = Math.min(rowH * 0.5, 13);
    for (var i = spikes.length - 1; i >= 0; i--) {
      var r = spikes[i][0], u = spikes[i][1], age = t - u;
      if (age > WINDOW) { spikes.splice(i, 1); continue; }
      var x = W * (1 - age / WINDOW);
      var y = rowH * (r + 0.5);
      var a = 0.15 + 0.85 * Math.pow(1 - age / WINDOW, 1.6);
      ctx.strokeStyle = (r % 7 === 3)
        ? 'rgba(247,105,2,' + a + ')'
        : 'rgba(90,220,205,' + (a * 0.85) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - tick / 2);
      ctx.lineTo(x, y + tick / 2);
      ctx.stroke();
    }
  }
  function step(now) {
    if (!last) last = now;
    var dt = Math.min(now - last, 60); last = now;
    t += dt;
    for (var r = 0; r < ROWS; r++) {
      if (Math.random() < rates[r] * dt / 1000) spikes.push([r, t]);
    }
    draw();
    requestAnimationFrame(step);
  }
  addEventListener('resize', function () { size(); draw(); });
  size(); seed();
  if (reduce) draw(); else requestAnimationFrame(step);
})();

/* Bio dialogs on the people page.
   Native <dialog> does the hard parts — Escape to close, focus trapping, making
   the rest of the page inert — so this only wires up opening, the close button,
   and clicking the backdrop. Without JS the tiles simply don't open; the bio
   text still ships in the HTML. */
(function () {
  var openers = document.querySelectorAll('[data-bio]');
  if (!openers.length) return;

  Array.prototype.forEach.call(openers, function (btn) {
    var dlg = document.getElementById(btn.dataset.bio);
    if (!dlg || typeof dlg.showModal !== 'function') return;

    btn.addEventListener('click', function () { dlg.showModal(); });

    var x = dlg.querySelector('.bio-x');
    if (x) x.addEventListener('click', function () { dlg.close(); });

    /* A click landing on the dialog element itself is a click on the backdrop —
       the content sits in a child, so anything inside never reaches here. */
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.close();
    });

    /* Return focus to the tile that opened it. */
    dlg.addEventListener('close', function () { btn.focus(); });
  });
})();

/* Enlarging a news photo.
   The thumbnails ship as links to the largest copy of the picture we hold, so
   with no JS a click simply opens that file — which is a perfectly reasonable
   outcome and the reason they are anchors rather than buttons. Here that is
   upgraded into a dialog, reusing the same native <dialog> the bios use for
   Escape, focus trapping, and inerting the page behind.
   One dialog is built and shared, rather than one per item. */
(function () {
  var links = document.querySelectorAll('a.thumb');
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;

  var dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  var img = document.createElement('img');
  dlg.appendChild(img);
  document.body.appendChild(dlg);
  if (typeof dlg.showModal !== 'function') return;

  var opener = null;

  Array.prototype.forEach.call(links, function (a) {
    a.addEventListener('click', function (e) {
      /* Leave modified clicks alone so "open in new tab" keeps working. */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      var inner = a.querySelector('img');
      img.src = a.getAttribute('href');
      img.alt = (inner && inner.alt) || '';
      opener = a;
      dlg.showModal();
    });
  });

  /* The image fills the dialog, so a click that lands on the dialog itself is a
     click on the backdrop. Clicking the picture closes it too — there is
     nothing else in here to interact with. */
  dlg.addEventListener('click', function () { dlg.close(); });

  dlg.addEventListener('close', function () {
    /* Drop the source so a large picture is not held once it is out of view. */
    img.removeAttribute('src');
    if (opener) opener.focus();
  });
})();

/* Mobile nav. Below 820px the links live in a panel behind the toggle; above it
   the toggle is hidden and this does nothing. */
(function () {
  var nav = document.getElementById('nav');
  var btn = nav && nav.querySelector('.nav-toggle');
  if (!btn) return;

  function set(open) {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', function () {
    set(!nav.classList.contains('open'));
  });

  /* Same-page anchors like #join do not reload, so the panel would otherwise
     stay open over the content the visitor just asked to see. */
  Array.prototype.forEach.call(nav.querySelectorAll('.nav-links a'), function (a) {
    a.addEventListener('click', function () { set(false); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') set(false);
  });

  /* Rotating a phone or widening the window can cross the breakpoint while the
     panel is open; without this it stays flagged open and reappears on the way
     back down. */
  addEventListener('resize', function () {
    if (innerWidth > 820) set(false);
  });
})();
