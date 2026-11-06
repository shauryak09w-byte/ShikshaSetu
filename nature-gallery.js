/* ShikshaSetu Nature Background Gallery
   24 bundled original nature scenes, smooth crossfades, user timer and saved preferences.
   Runs on both index.html (login) and dashboard.html (workspace). */
(() => {
  "use strict";

  const SCENES = [{"name":"Misty Rainforest Valley","category":"Monsoon","file":"assets/nature-gallery/01-misty-rainforest-valley.webp"},{"name":"Hidden Forest Waterfall","category":"Waterfall","file":"assets/nature-gallery/02-hidden-forest-waterfall.webp"},{"name":"Misty Tea Terraces","category":"Hills","file":"assets/nature-gallery/03-misty-tea-terraces.webp"},{"name":"Mossy Woodland Creek","category":"Waterfall","file":"assets/nature-gallery/04-mossy-woodland-creek.webp"},{"name":"Cloud-Wrapped Green Valley","category":"Monsoon","file":"assets/nature-gallery/05-cloud-wrapped-green-valley.webp"},{"name":"Emerald Cascade","category":"Waterfall","file":"assets/nature-gallery/06-emerald-cascade.webp"},{"name":"Quiet Mountain Lake","category":"Water","file":"assets/nature-gallery/07-quiet-mountain-lake.webp"},{"name":"Fern-Lined Stream","category":"Waterfall","file":"assets/nature-gallery/08-fern-lined-stream.webp"},{"name":"Rain-Kissed Fern Canopy","category":"Foliage","file":"assets/nature-gallery/09-rain-kissed-fern-canopy.webp"},{"name":"Bamboo Mist Sanctuary","category":"Forest","file":"assets/nature-gallery/10-bamboo-mist-sanctuary.webp"},{"name":"Western Ghats Tea Hills","category":"Hills","file":"assets/nature-gallery/11-western-ghats-tea-hills.webp"},{"name":"Rainforest Creek Bend","category":"Waterfall","file":"assets/nature-gallery/12-rainforest-creek-bend.webp"},{"name":"Sunlit Monsoon Trail","category":"Forest","file":"assets/nature-gallery/13-sunlit-monsoon-trail.webp"},{"name":"Mossy Cascade Pool","category":"Waterfall","file":"assets/nature-gallery/14-mossy-cascade-pool.webp"},{"name":"Fog Over Forest Lake","category":"Water","file":"assets/nature-gallery/15-fog-over-forest-lake.webp"},{"name":"Rain on Broad Green Leaves","category":"Foliage","file":"assets/nature-gallery/16-rain-on-broad-green-leaves.webp"},{"name":"Soft Dawn Woodland Path","category":"Forest","file":"assets/nature-gallery/17-soft-dawn-woodland-path.webp"},{"name":"Forest Rapids","category":"Waterfall","file":"assets/nature-gallery/18-forest-rapids.webp"},{"name":"Cloudy Hill Ridges","category":"Monsoon","file":"assets/nature-gallery/19-cloudy-hill-ridges.webp"},{"name":"Rain-Soaked Tropical Leaves","category":"Foliage","file":"assets/nature-gallery/20-rain-soaked-tropical-leaves.webp"},{"name":"Rainforest Leaf Canopy","category":"Foliage","file":"assets/nature-gallery/21-rainforest-leaf-canopy.webp"},{"name":"Still Lake in the Mist","category":"Water","file":"assets/nature-gallery/22-still-lake-in-the-mist.webp"},{"name":"Moss-Covered Forest Bridge","category":"Forest","file":"assets/nature-gallery/23-moss-covered-forest-bridge.webp"},{"name":"Golden Light Over Green Hills","category":"Hills","file":"assets/nature-gallery/24-golden-light-over-green-hills.webp"}];
  const STORAGE_KEY = "shikshasetu-nature-gallery-v1";
  const DEFAULTS = {
    enabled: true,
    intervalSeconds: 300,
    shuffle: true,
    category: "all",
    index: 0
  };
  const $ = (id) => document.getElementById(id);

  let prefs = loadPrefs();
  let currentIndex = normalizeIndex(prefs.index);
  let timerId = null;
  let fadeId = null;
  let currentCandidates = [];
  let applySequence = 0;

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function savePrefs() {
    prefs.index = currentIndex;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {
      updateStatus("This browser blocked saving preferences; rotation still works until this tab closes.");
    }
  }

  function normalizeIndex(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < SCENES.length ? n : 0;
  }

  function candidates() {
    return SCENES.map((scene, index) => ({ scene, index }))
      .filter(({ scene }) => prefs.category === "all" || scene.category === prefs.category);
  }

  function sceneUrl(index) {
    return `url("${SCENES[index].file}")`;
  }

  function applyScene(index, animate = true) {
    const nextIndex = normalizeIndex(index);
    const root = document.documentElement;
    const nextScene = SCENES[nextIndex];
    const sequence = ++applySequence;
    currentIndex = nextIndex;

    // Resolve from the document root so the same relative asset path works on
    // login and workspace pages. Never let an older preload overwrite a newer click.
    const assetUrl = new URL(nextScene.file, document.baseURI).href;
    const preloader = new Image();
    preloader.onload = () => {
      if (sequence !== applySequence) return;
      const imageValue = `url("${assetUrl.replace(/"/g, '\\"')}")`;
      root.style.setProperty("--scene-next-image", imageValue);
      if (animate && document.body) {
        document.body.classList.remove("scene-fading");
        document.querySelector(".login-page")?.classList.remove("scene-fading");
        void document.body.offsetWidth;
        document.body.classList.add("scene-fading");
        document.querySelector(".login-page")?.classList.add("scene-fading");
        if (fadeId) window.clearTimeout(fadeId);
        fadeId = window.setTimeout(() => {
          if (sequence !== applySequence) return;
          root.style.setProperty("--scene-current-image", imageValue);
          document.body.classList.remove("scene-fading");
          document.querySelector(".login-page")?.classList.remove("scene-fading");
          fadeId = null;
        }, 1900);
      } else {
        root.style.setProperty("--scene-current-image", imageValue);
        root.style.setProperty("--scene-next-image", imageValue);
        document.body?.classList.remove("scene-fading");
        document.querySelector(".login-page")?.classList.remove("scene-fading");
      }

      if (prefs.index !== nextIndex) {
        prefs.index = nextIndex;
        savePrefs();
      }
      renderGalleryUi();
    };
    preloader.onerror = () => {
      if (sequence !== applySequence) return;
      const imageValue = `url("${assetUrl.replace(/"/g, '\\"')}")`;
      // Still set the CSS variables to the requested path so the gallery status
      // remains truthful; the diagnostic below makes a missing asset visible.
      root.style.setProperty("--scene-current-image", imageValue);
      root.style.setProperty("--scene-next-image", imageValue);
      document.body?.classList.remove("scene-fading");
      document.querySelector(".login-page")?.classList.remove("scene-fading");
      updateStatus(`Could not load ${nextScene.file}. Keep the assets/nature-gallery folder beside the HTML files.`);
      renderGalleryUi();
    };
    preloader.src = assetUrl;
  }

  function renderGalleryUi() {
    const scene = SCENES[currentIndex];
    const visible = candidates();
    currentCandidates = visible;

    const name = $("natureSceneName");
    const description = $("natureSceneDescription");
    const count = $("natureSceneCount");
    const preview = $("natureScenePreview");
    const auto = $("natureAutoRotate");
    const interval = $("natureInterval");
    const category = $("natureCategory");
    const shuffle = $("natureShuffle");

    if (name) name.textContent = scene.name;
    if (description) description.textContent = `${scene.category} · Scene ${String(currentIndex + 1).padStart(2, "0")}`;
    if (count) count.textContent = `${String(currentIndex + 1).padStart(2, "0")} / ${String(SCENES.length).padStart(2, "0")}`;
    if (preview) preview.style.backgroundImage = sceneUrl(currentIndex);
    if (auto) auto.checked = Boolean(prefs.enabled);
    if (interval) interval.value = String(prefs.intervalSeconds);
    if (category) category.value = prefs.category;
    if (shuffle) shuffle.checked = Boolean(prefs.shuffle);

    updateStatus();
  }

  function updateStatus(message) {
    const status = $("natureRotationStatus");
    if (!status) return;
    if (message) {
      status.textContent = message;
      return;
    }
    if (!prefs.enabled) {
      status.textContent = "Rotation paused · use Previous or Change scene now anytime.";
      return;
    }
    const timerLabel = prefs.intervalSeconds < 60
      ? `${prefs.intervalSeconds} seconds`
      : prefs.intervalSeconds % 60 === 0
        ? `${prefs.intervalSeconds / 60} minute${prefs.intervalSeconds === 60 ? "" : "s"}`
        : `${Math.floor(prefs.intervalSeconds / 60)}m ${prefs.intervalSeconds % 60}s`;
    status.textContent = `Automatic rotation on · every ${timerLabel}${prefs.shuffle ? " · shuffled" : ""}`;
  }

  function pickNextIndex(direction = 1) {
    const pool = candidates().map(item => item.index);
    if (!pool.length) return currentIndex;
    if (pool.length === 1) return pool[0];

    if (direction === 0 && prefs.shuffle) {
      const others = pool.filter(index => index !== currentIndex);
      return others[Math.floor(Math.random() * others.length)];
    }

    const position = pool.indexOf(currentIndex);
    if (position < 0) return pool[0];
    return pool[(position + direction + pool.length) % pool.length];
  }

  function stopTimer() {
    if (timerId) window.clearTimeout(timerId);
    timerId = null;
  }

  function scheduleNext() {
    stopTimer();
    if (!prefs.enabled || document.hidden) return;
    timerId = window.setTimeout(() => {
      const next = pickNextIndex(prefs.shuffle ? 0 : 1);
      applyScene(next, true);
      scheduleNext();
    }, Math.max(15, Number(prefs.intervalSeconds) || DEFAULTS.intervalSeconds) * 1000);
  }

  function goNext() {
    applyScene(pickNextIndex(prefs.shuffle ? 0 : 1), true);
    scheduleNext();
  }

  function goPrevious() {
    applyScene(pickNextIndex(-1), true);
    scheduleNext();
  }

  function setCategory(categoryValue) {
    prefs.category = categoryValue || "all";
    const pool = candidates();
    if (!pool.some(item => item.index === currentIndex)) {
      const nextIndex = pool.length ? pool[0].index : 0;
      applyScene(nextIndex, true);
    }
    savePrefs();
    renderGalleryUi();
    scheduleNext();
  }

  function bindControls() {
    const auto = $("natureAutoRotate");
    const interval = $("natureInterval");
    const category = $("natureCategory");
    const shuffle = $("natureShuffle");
    const next = $("natureNext");
    const previous = $("naturePrevious");
    const reset = $("natureReset");

    if (auto) {
      auto.addEventListener("change", () => {
        prefs.enabled = auto.checked;
        savePrefs();
        renderGalleryUi();
        scheduleNext();
      });
    }
    if (interval) {
      interval.addEventListener("change", () => {
        prefs.intervalSeconds = Math.max(15, Number(interval.value) || DEFAULTS.intervalSeconds);
        savePrefs();
        renderGalleryUi();
        scheduleNext();
      });
    }
    if (category) {
      category.addEventListener("change", () => setCategory(category.value));
    }
    if (shuffle) {
      shuffle.addEventListener("change", () => {
        prefs.shuffle = shuffle.checked;
        savePrefs();
        renderGalleryUi();
        scheduleNext();
      });
    }
    if (next) next.addEventListener("click", goNext);
    if (previous) previous.addEventListener("click", goPrevious);
    if (reset) {
      reset.addEventListener("click", () => {
        prefs = { ...DEFAULTS };
        currentIndex = DEFAULTS.index;
        savePrefs();
        applyScene(currentIndex, true);
        renderGalleryUi();
        scheduleNext();
      });
    }
  }

  function init() {
    prefs.intervalSeconds = Math.max(15, Math.min(1800, Number(prefs.intervalSeconds) || DEFAULTS.intervalSeconds));
    if (!["all", "Monsoon", "Forest", "Waterfall", "Water", "Foliage", "Hills"].includes(prefs.category)) {
      prefs.category = "all";
    }

    // Apply the saved/default scene immediately on both login and dashboard pages.
    applyScene(currentIndex, false);
    bindControls();
    renderGalleryUi();
    savePrefs();
    scheduleNext();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopTimer();
      else scheduleNext();
    });

    // Keep the timer and visual preview correct after appearance changes.
    window.addEventListener("pageshow", scheduleNext);
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      prefs = loadPrefs();
      prefs.intervalSeconds = Math.max(15, Math.min(1800, Number(prefs.intervalSeconds) || DEFAULTS.intervalSeconds));
      currentIndex = normalizeIndex(prefs.index);
      applyScene(currentIndex, false);
      renderGalleryUi();
      scheduleNext();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
