// Marks that scripts run, so the site's drafting animations can start from hidden lines (see site.css, .js).
// If the site module never arrives, the mark is withdrawn so nothing stays hidden.
var bimpRoot = document.documentElement.classList;
bimpRoot.add('js');
setTimeout(function () { if (!bimpRoot.contains('ready')) bimpRoot.toggle('js', false); }, 4000);
