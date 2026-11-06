/* Server-verified dashboard entry guard. The browser profile is presentation metadata, never an authority source. */
document.addEventListener("DOMContentLoaded", async () => {
  "use strict";
  const API=localStorage.getItem("shikshasetu-api")||"http://localhost:8000";
  const PROFILE_KEY="shikshasetu-account-profile-v1",SESSION_KEY="shikshasetu-auth-session-v1",TOKEN_KEY="shikshasetu-session-token-v1";
  let profile=null,session=null,token=null;
  try{profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||"null");session=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");token=sessionStorage.getItem(TOKEN_KEY);}catch{}
  const leave=()=>{try{sessionStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(TOKEN_KEY);}catch{}location.replace("index.html");};
  if(!profile?.email||!session?.email||!token||String(profile.email).toLowerCase()!==String(session.email).toLowerCase()){leave();return;}
  let verified;
  try{const response=await fetch(API+"/api/auth/me",{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});if(!response.ok)throw new Error("Session not valid");verified=await response.json();}
  catch{leave();return;}
  profile=verified;try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}catch{}
  if(profile.role==="SUPER_ADMIN"){location.replace("super-admin.html");return;}
  const initials=String(profile.fullName||"User").trim().split(/\s+/).slice(0,2).map(part=>part[0]||"").join("").toUpperCase();
  const mini=document.querySelector(".profile-mini");if(mini){const avatar=mini.querySelector(".avatar"),name=mini.querySelector("strong"),detail=mini.querySelector("small");if(avatar)avatar.textContent=initials||"U";if(name)name.textContent=profile.fullName||profile.email;if(detail)detail.textContent=`${profile.role||"Member"} · ${profile.institutionName||"ShikshaSetu"} · AI Mentor: ${profile.aiMentorName||"ShikshaSetu AI"}`;}
  const accountButton=document.getElementById("accountSetupButton");if(accountButton)accountButton.textContent="♙ My profile";
  const topActions=document.querySelector(".top-actions");if(topActions&&!document.getElementById("signOutButton")){const button=document.createElement("button");button.id="signOutButton";button.type="button";button.className="secondary-button compact dashboard-signout";button.textContent="Sign out";topActions.insertBefore(button,document.getElementById("addStudentTop"));button.addEventListener("click",async()=>{try{await fetch(API+"/api/auth/logout",{method:"POST",headers:{Authorization:`Bearer ${token}`}});}catch{}leave();});}
});
