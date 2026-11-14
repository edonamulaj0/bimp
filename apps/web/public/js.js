// Runs before first paint on the site and in the app.
// 1. Theme: html[data-theme] is the reader's saved choice, else their system setting. Any [data-theme-toggle] switches it.
// 2. Marks that scripts run (.js), so the site's drafting animations can start from hidden lines (see site.css).
//    If the site module never arrives, the mark is withdrawn so nothing stays hidden.
(function () {
  var root = document.documentElement, cls = root.classList, key = 'bimp-theme', saved = null;
  try { saved = localStorage.getItem(key); } catch (e) { /* private mode */ }
  function apply(v) {
    root.setAttribute('data-theme', v);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', v === 'dark' ? '#171614' : '#f4f1ea');
  }
  apply(saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  window.bimpTheme = function (v) {
    v = v || (root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    cls.add('theming'); // one frame of colour transitions on everything, then back to normal
    apply(v);
    try { localStorage.setItem(key, v); } catch (e) { /* not saved */ }
    setTimeout(function () { cls.toggle('theming', false); }, 450);
    window.dispatchEvent(new CustomEvent('bimp-theme', { detail: v }));
    return v;
  };
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) window.bimpTheme();
  });
  cls.add('js');
  setTimeout(function () { if (!cls.contains('ready')) cls.toggle('js', false); }, 4000);
})();
