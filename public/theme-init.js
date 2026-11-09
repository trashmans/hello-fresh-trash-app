// Runs before the app loads so a saved dark-mode choice applies without a
// light flash. Mirrors src/lib/theme.js: key 'hft-theme', only the exact
// string 'dark' means dark, and the bar colour matches THEME_COLORS.dark.
try {
  if (localStorage.getItem('hft-theme') === 'dark') {
    document.documentElement.classList.add('dark')
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#1C1A16')
  }
} catch (e) {
  // Storage blocked (private mode, strict settings): stay in light mode.
}
