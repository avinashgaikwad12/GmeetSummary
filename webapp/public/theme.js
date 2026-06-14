// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// External (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  var t = localStorage.getItem('mh_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
