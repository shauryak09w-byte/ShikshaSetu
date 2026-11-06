/* ShikshaSetu API endpoint migration: the FastAPI service is the active API. */
(() => {
  try {
    const saved = localStorage.getItem('shikshasetu-api');
    const legacySpringLocal = /^https?:\/\/(localhost|127\.0\.0\.1):8080\/?$/i.test(saved || '');
    if (!saved || legacySpringLocal) {
      localStorage.setItem('shikshasetu-api', 'http://localhost:8000');
    }
    window.SHIKSHASETU_API_BASE = localStorage.getItem('shikshasetu-api') || 'http://localhost:8000';
  } catch (_) {
    window.SHIKSHASETU_API_BASE = 'http://localhost:8000';
  }
})();
