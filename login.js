/* ShikshaSetu Firebase Google Authentication.
 * Firebase SDK imports are dynamic so a CDN/network failure can be shown in
 * the login page instead of leaving the Google buttons silently disabled.
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const $ = id => document.getElementById(id);
  const API = (window.SHIKSHASETU_API_BASE || localStorage.getItem("shikshasetu-api") || "http://localhost:8000").replace(/\/$/, "");
  const PROFILE_KEY = "shikshasetu-account-profile-v1";
  const SESSION_KEY = "shikshasetu-auth-session-v1";
  const TOKEN_KEY = "shikshasetu-session-token-v1";
  const loginButton = $("loginGoogleButton");
  const signupButton = $("signupGoogleButton");
  const setupStatus = $("firebaseSetupStatus");
  let auth = null;
  let firebaseSdk = null;
  let activeRequest = false;
  let authReady = false;
  let firebaseCheckInProgress = false;

  const setSetupStatus = (message, state = "info") => {
    if (!setupStatus) return;
    setupStatus.hidden = !message;
    const messageElement = $("firebaseSetupMessage");
    if (messageElement) messageElement.textContent = message || "";
    setupStatus.dataset.state = state;
  };

  const feedback = (id, message, error = false) => {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.className = `login-feedback show${error ? " error" : ""}`;
  };

  const clear = () => ["loginFeedback", "signupFeedback"].forEach(id => {
    const element = $(id);
    if (element) {
      element.textContent = "";
      element.className = "login-feedback";
    }
  });

  function setButtonsEnabled(enabled) {
    [loginButton, signupButton].forEach(button => {
      if (!button) return;
      button.disabled = !enabled;
      button.classList.toggle("is-ready", enabled);
      if (!enabled) button.classList.remove("is-loading");
    });
  }

  async function post(path, body) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(`Cannot reach the ShikshaSetu backend at ${API}. Start FastAPI and try again.`);
    }

    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : data?.message;
      throw new Error(detail || `The server rejected the request (${response.status}).`);
    }
    return data;
  }

  function openWorkspace(data) {
    const profile = data.profile;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: profile.email, startedAt: new Date().toISOString() }));
      sessionStorage.setItem(TOKEN_KEY, data.token);
    } catch {
      feedback("loginFeedback", "Your browser blocked session storage. Enable site storage for localhost to continue.", true);
      return;
    }
    location.assign(profile.role === "SUPER_ADMIN" ? "super-admin.html" :
      profile.role === "INSTITUTION_ADMIN" ? "institution-admin.html" : "dashboard.html");
  }

  function setTab(mode) {
    const isLogin = mode === "login";
    $("loginForm").hidden = !isLogin;
    $("signupForm").hidden = isLogin;
    $("loginTab").classList.toggle("active", isLogin);
    $("signupTab").classList.toggle("active", !isLogin);
    $("loginTab").setAttribute("aria-selected", String(isLogin));
    $("signupTab").setAttribute("aria-selected", String(!isLogin));
    $("loginTitle").textContent = isLogin ? "Welcome back" : "Request student access";
    $("loginSubtitle").textContent = isLogin
      ? "Enter your registered email and institution ID, then verify with Google."
      : "Enter your email and college ID, then verify your Google account to request student access.";
    clear();
  }

  function signupDetails() {
    const email = $("signupEmail").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    const fullName = $("signupFullName").value.trim();
    const age = Number($("signupAge").value);
    const aiMentorName = $("signupAiMentorName").value.trim();
    const institutionCode = $("signupInstitutionCode").value.trim().toUpperCase();
    if (fullName.length < 2) throw new Error("Enter your full name.");
    if (!Number.isInteger(age) || age < 13 || age > 100) throw new Error("Enter an age between 13 and 100.");
    if (aiMentorName.length < 2) throw new Error("Give your AI Mentor a name of at least 2 characters.");
    if (institutionCode.length < 4) throw new Error("Enter the Institution / Organization ID provided by your college.");
    if (!$("signupConsent").checked || !$("signupPrivacyConsent").checked) {
      throw new Error("Please accept the academic-support and privacy notices.");
    }
    return {
      email, fullName, age, aiMentorName, institutionCode,
      privacyNoticeAccepted: true,
      chatMonitoringConsent: $("signupChatMonitoringConsent").checked
    };
  }

  function friendlyAuthError(error) {
    const messages = {
      "auth/popup-closed-by-user": "The Google sign-in window was closed before sign-in finished. Try again when ready.",
      "auth/popup-blocked": "Your browser blocked the Google sign-in popup. Allow popups for localhost and try again.",
      "auth/unauthorized-domain": "This site is not authorised in Firebase. Add localhost (and 127.0.0.1 if used) under Authentication → Settings → Authorized domains.",
      "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase Authentication. Enable the Google provider in Firebase Console.",
      "auth/invalid-api-key": "The Firebase Web API key is invalid. Copy the API key from your Firebase Web App settings into backend-fastapi/.env.",
      "auth/configuration-not-found": "Firebase Authentication is not configured for this project. Enable Google sign-in in Firebase Console.",
      "auth/network-request-failed": "The connection to Firebase failed. Check your internet connection and try again.",
      "auth/cancelled-popup-request": "Another Google sign-in window is already open. Finish that window first."
    };
    return messages[error?.code] || error?.message || "Google sign-in failed. Please try again.";
  }

  async function handleSignIn(mode) {
    if (activeRequest) return;
    const isSignup = mode === "signup";
    const feedbackId = isSignup ? "signupFeedback" : "loginFeedback";
    let details = {};
    let emailHint = "";

    try {
      if (!authReady || !auth || !firebaseSdk) {
        throw new Error("Google sign-in is not ready yet. Check the Firebase setup message above and refresh the page after configuration.");
      }
      if (isSignup) {
        details = signupDetails();
        emailHint = details.email;
      } else {
        emailHint = $("loginEmail").value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailHint)) throw new Error("Enter your registered email address.");
        const institutionCode = $("loginInstitutionCode").value.trim().toUpperCase();
        details = { email: emailHint, institutionCode: institutionCode || null };
      }
    } catch (error) {
      feedback(feedbackId, error.message, true);
      return;
    }

    activeRequest = true;
    setButtonsEnabled(false);
    [loginButton, signupButton].forEach(button => button?.classList.add("is-loading"));
    feedback(feedbackId, "Opening secure Google sign-in…");

    try {
      const provider = new firebaseSdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account", login_hint: emailHint });
      provider.addScope("email");
      provider.addScope("profile");
      const credential = await firebaseSdk.signInWithPopup(auth, provider);
      const user = credential.user;
      const verifiedEmail = (user.email || "").trim().toLowerCase();

      if (verifiedEmail !== emailHint) {
        await firebaseSdk.signOut(auth);
        throw new Error(`You selected ${user.email || "a different Google account"}. Please sign in with ${emailHint}.`);
      }

      const idToken = await user.getIdToken(true);
      feedback(feedbackId, "Google verified. Checking your email and institution access…");
      const result = await post("/api/auth/firebase", { idToken, ...details });

      if (result.needsEnrollment) {
        $("signupEmail").value = result.googleProfile.email;
        $("signupFullName").value = $("signupFullName").value.trim() || result.googleProfile?.fullName || user.displayName || "";
        $("signupInstitutionCode").value = $("signupInstitutionCode").value.trim() || $("loginInstitutionCode").value.trim();
        $("googleVerifiedNote").textContent = `Email verified with Google: ${result.googleProfile.email}. Complete the details below and continue with the same Google account.`;
        setTab("signup");
        feedback("signupFeedback", "Your Google account is verified. Complete the enrollment details below.");
        return;
      }

      if (result.enrollmentSubmitted) {
        $("loginEmail").value = emailHint;
        $("loginInstitutionCode").value = details.institutionCode || "";
        setTab("login");
        feedback("loginFeedback", result.message || "Your enrollment request was submitted. Your institution will review it before access is granted.");
        return;
      }

      if (result.token && result.profile) {
        openWorkspace(result);
        return;
      }
      throw new Error("ShikshaSetu returned an unexpected sign-in response. Please try again.");
    } catch (error) {
      feedback(feedbackId, friendlyAuthError(error), true);
    } finally {
      activeRequest = false;
      [loginButton, signupButton].forEach(button => button?.classList.remove("is-loading"));
      setButtonsEnabled(authReady);
    }
  }

  loginButton.addEventListener("click", () => handleSignIn("login"));
  signupButton.addEventListener("click", () => handleSignIn("signup"));
  $("loginThemeToggle").addEventListener("click", () => {
    if (window.ShikshaSetuTheme) window.ShikshaSetuTheme.toggle();
    else {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("shikshasetu-theme", next);
    }
  });
  $("loginTab").addEventListener("click", () => setTab("login"));
  $("signupTab").addEventListener("click", () => setTab("signup"));
  $("retryFirebaseCheck").addEventListener("click", () => initialiseFirebase());
  setTab("login");

  async function initialiseFirebase() {
    if (firebaseCheckInProgress) return;
    firebaseCheckInProgress = true;
    const retryButton = $("retryFirebaseCheck");
    if (retryButton) retryButton.disabled = true;
    setButtonsEnabled(false);
    try {
      setButtonsEnabled(false);
      setSetupStatus("Checking Google sign-in configuration…", "loading");

      let response;
      let config;
      try {
        response = await fetch(`${API}/api/auth/firebase/config`, {
          headers: { "Accept": "application/json" },
          cache: "no-store"
        });
        config = await response.json();
      } catch (error) {
        setSetupStatus(`Cannot reach the FastAPI server at ${API}. Start the backend in VS Code, then refresh this page.`, "error");
        feedback("loginFeedback", "The backend is not responding. Start FastAPI and confirm http://localhost:8000/api/health opens.", true);
        return;
      }

      if (!response.ok) {
        setSetupStatus(`FastAPI returned an error while checking Firebase readiness (${response.status}). Check the backend terminal.`, "error");
        return;
      }

      if (!config.enabled || !config.firebase) {
        const friendlyLabels = {
          FIREBASE_API_KEY: "Firebase Web API key",
          FIREBASE_AUTH_DOMAIN: "Firebase Auth domain",
          FIREBASE_PROJECT_ID: "Firebase Project ID",
          FIREBASE_APP_ID: "Firebase Web App ID",
          "FIREBASE_SERVICE_ACCOUNT_PATH (Firebase Admin credentials)": "Firebase Admin service-account JSON",
          "firebase-admin package": "Firebase Admin SDK package"
        };
        const missingItems = Array.isArray(config.missing)
          ? config.missing.map(item => friendlyLabels[item] || item)
          : [];
        const missing = missingItems.length ? ` Still needed: ${missingItems.join(", ")}.` : "";
        const message = config.message || "Firebase is not fully configured.";
        setSetupStatus(`${message}${missing} In a VS Code terminal opened at the project folder, run .\\backend-fastapi\\configure-firebase.ps1. The setup wizard will guide you. Restart FastAPI and click Check again.`, "error");
        feedback("loginFeedback", "Google sign-in is paused until Firebase is configured. Your existing account data has not been changed.", true);
        return;
      }

      try {
        const version = "13.2.0";
        const [appSdk, authSdk] = await Promise.all([
          import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
          import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`)
        ]);
        const firebaseApp = appSdk.initializeApp(config.firebase);
        auth = authSdk.getAuth(firebaseApp);
        await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
        firebaseSdk = authSdk;
        authReady = true;
        setButtonsEnabled(true);
        setSetupStatus("Google sign-in is ready. Enter your registered email and Institution / Organization ID, then continue.", "success");
      } catch (error) {
        auth = null;
        firebaseSdk = null;
        authReady = false;
        setButtonsEnabled(false);
        const message = /Failed to fetch|NetworkError|Importing a module script failed/i.test(error?.message || "")
          ? "The Firebase JavaScript SDK could not be loaded. Check your internet connection, allow gstatic.com, and refresh."
          : `Firebase could not initialise: ${friendlyAuthError(error)}`;
        setSetupStatus(message, "error");
      }
    } finally {
      firebaseCheckInProgress = false;
      if (retryButton) retryButton.disabled = false;
    }
  }

  initialiseFirebase();
});
