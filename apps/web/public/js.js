// Runs before the page paints: lets the site's drafting animations start from hidden lines (see site.css, .js),
// unless the reader has asked for reduced motion, in which case everything is simply shown.
if (!window.matchMedia || !matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('js');
