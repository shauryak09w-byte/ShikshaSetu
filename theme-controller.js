/* Shared ShikshaSetu theme controller.
   Keeps login and workspace in the same persisted light/dark theme. */
(() => {
  "use strict";
  const STORAGE_KEY = "shikshasetu-theme";
  const VALID = new Set(["light", "dark"]);
  const root = document.documentElement;

  function readTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (VALID.has(saved)) return saved;
    } catch (_) { /* storage may be disabled */ }
    const current = root.dataset.theme;
    return VALID.has(current) ? current : "dark";
  }

  function updateControls(theme) {
    const isDark = theme === "dark";
    const nextLabel = isDark ? "Switch to light mode" : "Switch to dark mode";
    const icon = isDark ? "☼" : "☾";
    ["themeToggle", "loginThemeToggle"].forEach(id => {
      const button = document.getElementById(id);
      if (!button) return;
      button.textContent = icon;
      button.setAttribute("aria-label", nextLabel);
      button.setAttribute("title", nextLabel);
      button.setAttribute("aria-pressed", String(isDark));
    });
    const appearanceButton = document.getElementById("appearanceTheme");
    if (appearanceButton) {
      appearanceButton.textContent = `${nextLabel} ${icon}`;
      appearanceButton.setAttribute("aria-label", nextLabel);
      appearanceButton.setAttribute("aria-pressed", String(isDark));
    }
  }

  function apply(theme, options = {}) {
    const next = VALID.has(theme) ? theme : "dark";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#041509" : "#d9f2e4");
    updateControls(next);
    if (options.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* theme still changes for this page */ }
    }
    window.dispatchEvent(new CustomEvent("shikshasetu:themechange", { detail: { theme: next } }));
    return next;
  }

  function toggle() {
    return apply(root.dataset.theme === "dark" ? "light" : "dark");
  }

  // Apply before paint; pages start dark unless a saved preference exists.
  apply(readTheme(), { persist: false });

  document.addEventListener("DOMContentLoaded", () => updateControls(root.dataset.theme));
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY && VALID.has(event.newValue)) apply(event.newValue, { persist: false });
  });

  window.ShikshaSetuTheme = Object.freeze({ apply, toggle, current: () => root.dataset.theme });
})();
