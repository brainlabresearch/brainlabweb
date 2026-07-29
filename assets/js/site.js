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

/* Scroll reveal. */
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
  }, { threshold: 0.08 });
  Array.prototype.forEach.call(els, function (el) { io.observe(el); });
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
