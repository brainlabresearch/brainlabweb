/* Brain Lab — animated topic cloud.
   Reads assets/data/topics.json (built by tools/fetch-topics.mjs from the
   abstracts OpenAlex holds for the lab's papers) and steps through overlapping
   four-year windows so the drift in subject matter is visible as motion.

   Encoding: SIZE is how often a term appears in that window; MOTION over the
   windows is the change. Colour deliberately carries no data — the words are all
   one ink. An earlier version coloured them by rising/falling, but a teal dark
   enough to read as body text on this pale ground sits too close to grey to be
   told apart, and the animation already says the same thing. */
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
  var windows = [];
  var at = 0;
  var timer = null;
  var HOLD = 2100;

  fetch('assets/data/topics.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function (data) {
      windows = data.windows || [];
      if (!windows.length) throw new Error('no windows');
      start();
    })
    .catch(function () {
      /* Never leave an empty box on the page. */
      if (status) {
        status.textContent = 'Topic data could not be loaded.';
        status.hidden = false;
      }
      root.classList.add('cloud-failed');
    });

  function start() {
    root.classList.add('cloud-ready');
    scrub.max = String(windows.length - 1);
    scrub.value = '0';
    render(0, false);

    scrub.addEventListener('input', function () {
      pause();
      render(Number(scrub.value), true);
    });
    playBtn.addEventListener('click', function () {
      timer ? pause() : play();
    });

    /* Autoplay only once the section is actually on screen, and never under
       reduced-motion — an animation nobody asked for that starts off-screen is
       just churn. */
    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { play(); io.disconnect(); }
        });
      }, { threshold: 0.35 });
      io.observe(root);
    }
  }

  function play() {
    if (timer) return;
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-label', 'Pause the topic animation');
    timer = setInterval(function () {
      render((at + 1) % windows.length, true);
    }, HOLD);
  }

  function pause() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-label', 'Play the topic animation');
  }

  function render(i, animate) {
    at = i;
    var w = windows[i];
    var max = w.terms.reduce(function (m, t) { return Math.max(m, t.n); }, 1);

    scrub.value = String(i);
    scrub.setAttribute('aria-valuetext', w.from + ' to ' + w.to);
    label.innerHTML = '<b>' + w.from + '–' + w.to + '</b><span>' + w.papers + ' papers</span>';

    /* FLIP: measure where everything is, rebuild, then animate from the old
       positions to the new ones. Without this the words teleport whenever a
       neighbour changes size, and the drift becomes impossible to follow. */
    var before = {};
    var kids = Array.prototype.slice.call(cloud.children);
    kids.forEach(function (el) { before[el.dataset.t] = el.getBoundingClientRect(); });

    var wanted = {};
    w.terms.forEach(function (t) { wanted[t.t] = t.n; });

    kids.forEach(function (el) {
      if (!(el.dataset.t in wanted)) exit(el, before[el.dataset.t]);
    });

    /* Alphabetical, so a term that survives keeps roughly the same neighbours
       from frame to frame. A frequency-ordered or randomly packed layout
       reshuffles on every step and reads as noise. */
    w.terms.slice().sort(function (a, b) {
      return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
    }).forEach(function (t) {
      var el = cloud.querySelector('[data-t="' + cssEscape(t.t) + '"]');
      var isNew = !el;
      if (isNew) {
        el = document.createElement('span');
        el.className = 'w';
        el.dataset.t = t.t;
        el.textContent = t.t;
        bindTip(el);
      }
      el.dataset.n = t.n;
      el.style.setProperty('--s', (Math.sqrt(t.n / max)).toFixed(3));
      cloud.appendChild(el);
      if (isNew && animate && !reduce) {
        el.classList.add('is-new');
        requestAnimationFrame(function () { el.classList.remove('is-new'); });
      }
    });

    if (animate && !reduce) {
      Array.prototype.forEach.call(cloud.children, function (el) {
        var was = before[el.dataset.t];
        if (!was) return;
        var now = el.getBoundingClientRect();
        var dx = was.left - now.left;
        var dy = was.top - now.top;
        if (!dx && !dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        requestAnimationFrame(function () {
          el.style.transition = '';
          el.style.transform = '';
        });
      });
    }

    describe(w);
  }

  /* Exiting words are lifted out of the flow at their last position and faded,
     so their departure doesn't shove the surviving words sideways. */
  function exit(el, rect) {
    if (!rect || reduce) { el.remove(); return; }
    var box = cloud.getBoundingClientRect();
    el.classList.add('is-out');
    el.style.left = (rect.left - box.left) + 'px';
    el.style.top = (rect.top - box.top) + 'px';
    setTimeout(function () { el.remove(); }, 240);
  }

  function bindTip(el) {
    if (!tip) return;
    el.addEventListener('mouseenter', function () {
      tip.textContent = el.dataset.t + ' · ' + el.dataset.n + ' mentions';
      tip.hidden = false;
    });
    el.addEventListener('mousemove', function (ev) {
      var box = root.getBoundingClientRect();
      tip.style.left = (ev.clientX - box.left) + 'px';
      tip.style.top = (ev.clientY - box.top - 14) + 'px';
    });
    el.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  /* The cloud itself is unreadable to a screen reader, so the same numbers are
     published as a table and the region carries a plain-language summary. */
  function describe(w) {
    var top = w.terms.slice().sort(function (a, b) { return b.n - a.n; });
    cloud.setAttribute('aria-label',
      'Most frequent terms in Brain Lab paper abstracts, ' + w.from + ' to ' + w.to
      + '. Leading terms: ' + top.slice(0, 8).map(function (t) { return t.t; }).join(', ') + '.');

    if (!tableBody) return;
    tableBody.innerHTML = top.map(function (t) {
      return '<tr><td>' + esc(t.t) + '</td><td>' + t.n + '</td></tr>';
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }
})();
