# ShikshaSetu — Firebase Google Authentication

This project uses **Firebase Authentication with the Google provider** for browser sign-in. FastAPI verifies Firebase ID tokens using the Firebase Admin SDK before looking up the ShikshaSetu account.

## What stays intact

- Existing Super Admin, Institution Admin and student records remain in the current SQL database.
- Existing roles, institution IDs, student links, approval states, progress, academic records, and chatbot consent are not recreated or reset.
- On the first successful login, a pre-existing user is linked to a Firebase UID only when the verified Google email matches the existing ShikshaSetu email.
- After linking, the Firebase UID is fixed to that record. A different Firebase identity cannot take over the same account email.
- New student enrollment still requires an institution code, privacy acknowledgement, and institution-admin approval.
- Password login and registration endpoints remain disabled. Google via Firebase is the only sign-in path.

## One-time Firebase setup

1. Open the [Firebase Console](https://console.firebase.google.com/) and create or select the ShikshaSetu project.
2. In **Project settings → General**, add a **Web app** and copy its web configuration values: `apiKey`, `authDomain`, `projectId`, and `appId`.
3. Open **Authentication → Sign-in method** (or **Sign-in providers**, depending on the console layout), enable **Google**, choose a project support email, and save.
4. Open **Authentication → Settings → Authorized domains**. Make sure `localhost` is present. Add `127.0.0.1` if you will open the frontend using that host.
5. Open **Project settings → Service accounts** and generate a private key for the Firebase Admin SDK. Save the downloaded JSON somewhere on your computer. Do not share it, upload it to chat, or commit it to Git.
6. In VS Code, open a PowerShell terminal at the project root and run:

   ```powershell
   .\backend-fastapi\configure-firebase.ps1
   ```

   The wizard asks for the four Web App values, the path to the downloaded service-account JSON, and the initial Super Admin email. It validates the JSON and checks that both Firebase configurations belong to the same project. It creates or updates `backend-fastapi/.env` and copies the private JSON into `backend-fastapi/`.
7. Stop FastAPI with **Ctrl+C**, then restart it:

   ```powershell
   .\backend-fastapi\run-fastapi.ps1
   ```

   Refresh `http://localhost:5500/index.html` and click **Check again** if the page was already open.
   The launcher now reloads `.env` values even if an earlier run left placeholder values in the same PowerShell session. You can run `.\backend-fastapi\check-firebase-config.ps1` from the project root to check the saved settings without displaying any secret values.

The Google buttons intentionally remain unavailable until **both** sides are configured: the Firebase Web App values and the Firebase Admin service-account credentials used by FastAPI. The login card shows what is missing. The included PowerShell wizard (`.\backend-fastapi\configure-firebase.ps1`) is the recommended way to complete the setup. The private key is never sent to the browser.

The web API key and app ID are browser configuration values. The service-account JSON is a private server credential and must remain only on the backend machine or secret manager.

## Login and account matching

- Every user enters their registered email address and continues with the matching Google account. The email typed into the form is compared with the verified Firebase email.
- Students and Institution Admins must also enter the Institution / Organization ID (the institution access code). FastAPI verifies that this code belongs to the same institution assigned to the account.
- The platform Super Admin is not attached to an institution and therefore does not need an Institution / Organization ID.
- When the Super Admin provisions a new institution, the first Institution Admin is created without a password. That administrator uses the provisioned Google email plus the generated Institution / Organization ID.
- Existing students sign in with the Google account matching their existing account email. Their institution approval status is still enforced.
- A legacy user with no Firebase UID is linked to the UID in the first successful Google sign-in. Existing data is kept in place.
- A user whose email is not already registered can submit a new student enrollment with their institution access code. The request remains pending until the institution administrator approves it.
- Google sign-in alone never creates an administrator or bypasses institution approval. The role is retrieved from the existing ShikshaSetu database; users cannot choose their own role at sign-in.
- Only Firebase tokens whose sign-in provider is `google.com` and whose email is verified are accepted.

## Running locally

Start the backend from the project root:

```powershell
.\backend-fastapi\run-fastapi.ps1
```

In a second terminal from the project root:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500/index.html`.

Check backend health at `http://localhost:8000/api/health` and the Firebase client config at `http://localhost:8000/api/auth/firebase/config`.

## Troubleshooting

- **Google button is disabled:** run `.\backend-fastapi\configure-firebase.ps1` from the project root in VS Code. The wizard guides you through the real Firebase values and service-account JSON, then restart FastAPI and refresh the page. The `/api/auth/firebase/config` endpoint reports readiness without exposing private credentials.
- **Firebase is not configured:** copy `backend-fastapi/.env.example` to `backend-fastapi/.env`, replace the four `FIREBASE_*` values with the real Web App settings, then restart FastAPI.
- **Server cannot verify the token:** check that `backend-fastapi/firebase-service-account.json` exists, is a valid Firebase Admin service-account JSON, and belongs to the same project as `FIREBASE_PROJECT_ID`; then restart.
- **The Firebase SDK cannot load in the browser:** check the internet connection and ensure `www.gstatic.com` is not blocked. The login page displays this as a setup error instead of silently leaving the buttons disabled.
- **This domain is not authorised:** add `localhost` (and `127.0.0.1` if used) under Firebase Authentication → Settings → Authorized domains.
- **Google sign-in is disabled:** enable Google in Firebase Authentication → Sign-in method.
- **Wrong account or account already linked:** sign in with the Google identity matching the original ShikshaSetu email. Contact the institution administrator if the existing account was linked to another Firebase UID.

For a hosted deployment, use HTTPS, add the real domain under Firebase Authorized domains, set the exact frontend origin in `CORS_ORIGINS`, protect the service-account credential with a secret manager, and configure a managed database and protected backups.
