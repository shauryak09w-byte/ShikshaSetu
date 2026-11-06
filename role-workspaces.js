/* ShikshaSetu role workspaces. The server-issued session determines role and access. */
document.addEventListener("DOMContentLoaded",async()=>{
  "use strict";
  const $=id=>document.getElementById(id);
  const token=sessionStorage.getItem("shikshasetu-session-token-v1");
  let profile=null;
  try{
    if(!token)throw new Error("No authenticated session");
    const response=await fetch((localStorage.getItem("shikshasetu-api")||"http://localhost:8000")+"/api/auth/me",{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
    if(!response.ok)throw new Error("Session verification failed");
    profile=await response.json();
    localStorage.setItem("shikshasetu-account-profile-v1",JSON.stringify(profile));
  }catch(error){location.replace("index.html");return;}
  const admin=["INSTITUTION_ADMIN","SUPER_ADMIN","Mentor","Admin"].includes(profile?.role);
  const pages=admin?["dashboard","overview","admin-students","interventions","support","ai-admin","mentors","fairness"]:["student-home","students","student-progress","student-assess"];
  document.body.dataset.workspaceRole=admin?"admin":"student";
  const labels=admin?{dashboard:"Admin dashboard",overview:"Overview","admin-students":"Students",interventions:"Interventions",support:"AI Mentor Support Loop","ai-admin":"AI Admin Console",mentors:"Mentor feedback",fairness:"Fairness & audit"}:{"student-home":"My dashboard",students:"AI chatbot","student-progress":"Progress tracker","student-assess":"Assessments"};
  const icons={dashboard:"▦",overview:"◫","admin-students":"♙",interventions:"✳",support:"⟳","ai-admin":"✦",mentors:"☷",fairness:"◈","student-home":"◫",students:"✦","student-progress":"◷","student-assess":"◈"};
  const nav=document.querySelector(".nav-list");
  nav.replaceChildren();
  pages.forEach(page=>{
    const button=document.createElement("button");button.type="button";button.className="nav-item";button.dataset.rolePage=page;
    const icon=document.createElement("span");icon.className="nav-icon";icon.textContent=icons[page];
    const label=document.createElement("span");label.textContent=labels[page];button.append(icon,label);nav.appendChild(button);
  });
  function go(page){
    if(!pages.includes(page))return;
    document.querySelectorAll(".page").forEach(el=>el.classList.toggle("active",el.id==="page-"+page));
    nav.querySelectorAll("[data-role-page]").forEach(el=>el.classList.toggle("active",el.dataset.rolePage===page));
    if($("crumbCurrent"))$("crumbCurrent").textContent=labels[page];
    $("sidebar")?.classList.remove("open");
    if(page==="admin-students")renderMentorDirectory();
    if(page==="student-home")refreshHome();
    if(page==="student-assess")refreshAssessment();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  // Prevent cross-workspace navigation, including old data-go links.
  document.addEventListener("click",event=>{
    const link=event.target.closest("[data-role-page],[data-page],[data-go]");
    if(!link)return;
    event.preventDefault();event.stopImmediatePropagation();
    const destination=link.dataset.rolePage||link.dataset.page||link.dataset.go;
    if(pages.includes(destination))go(destination);
  },true);
  // Prevent a profile role change from switching the current workspace in place.
  const roleInput=$("accountRole");
  if(roleInput){roleInput.value=admin?"Mentor":"Student";roleInput.disabled=true;}
  const roleText=document.createElement("span");roleText.className="soft-pill role-label";roleText.textContent=admin?"Institution admin workspace":"Student workspace";
  document.querySelector(".top-actions")?.prepend(roleText);
  // The AI Admin Console is not a student feature; the Student Progress Tracker is.
  if(!admin){
    ["aiAdminStatus","modelStatus"].forEach(id=>{if($(id))$(id).hidden=true;});
    const progressSelect=$("progressStudent");if(progressSelect&&profile?.studentId){progressSelect.value=String(profile.studentId);progressSelect.disabled=true;const label=progressSelect.closest(".progress-tracker-form")?.querySelector("label[for=progressStudent]");if(label)label.textContent="My student record";}
    const studentPage=$("page-students");
    const heading=studentPage?.querySelector(".page-title-row h1");if(heading)heading.textContent="AI learning companion";
    const subtitle=studentPage?.querySelector(".page-subtitle");if(subtitle)subtitle.textContent="Ask for study help, revision plans and explanations.";
  }
  const safe=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function getStudents(){
    const select=$("aiAdminStudentSelect");
    return [...(select?.options||[])].filter(o=>o.value).map(o=>({id:o.value,name:o.textContent}));
  }
  let remoteProgress={};
  function getProgress(){return window.ShikshaSetuProgress||remoteProgress;}
  async function loadCentralProgress(){
    const token=sessionStorage.getItem("shikshasetu-session-token-v1");if(!token)return;
    const endpoint=admin?"/api/institution-admin/progress":"/api/my/progress";
    try{const response=await fetch((localStorage.getItem("shikshasetu-api")||"http://localhost:8000")+endpoint,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});if(!response.ok)throw new Error("Progress service unavailable");const rows=await response.json(),grouped={};(rows||[]).forEach(row=>{const id=String(row.studentId);(grouped[id]??=[]).push({Attendance:Number(row.attendance),AssignmentsDone:Number(row.assignmentsDone),AssignmentsTotal:Number(row.assignmentsTotal),Problems:Number(row.problems),Hours:Number(row.hours),note:row.note||"",at:row.createdAt});});remoteProgress=admin?grouped:{[String(profile.studentId)]:grouped[String(profile.studentId)]||[]};window.ShikshaSetuProgress=remoteProgress;refreshHome();if(mentorSelectedId)showMentorProgress(mentorSelectedId);}catch(error){console.warn("Central progress unavailable",error);}
  }
  function refreshHome(){
    const select=$("progressStudent");
    const entries=getProgress();
    const key=select?.value||getStudents()[0]?.id;
    const current=entries[key]?.[0];
    const values={myAttendance:current?`${current.Attendance}%`:"—",myAssignments:current?`${current.AssignmentsDone}/${current.AssignmentsTotal}`:"—",myProblems:current?String(current.Problems):"—",myHours:current?`${current.Hours}h`:"—"};
    Object.entries(values).forEach(([id,value])=>{if($(id))$(id).textContent=value;});
  }
  function refreshAssessment(){
    const target=$("myAssessmentStudent"),source=$("aiAdminStudentSelect");
    if(!target||!source)return;
    const before=target.value;
    target.replaceChildren(new Option("Choose a student record",""));
    [...source.options].filter(o=>o.value).forEach(o=>target.add(new Option(o.textContent,o.value)));
    if([...target.options].some(o=>o.value===before))target.value=before;
    showAssessment();
  }
  function showAssessment(){
    const id=$("myAssessmentStudent")?.value;
    const rows=document.querySelectorAll("#aiAdminStudentRows tr");
    const matching=[...rows].find(row=>row.querySelector("[data-ai-admin-select]")?.dataset.aiAdminSelect===id);
    const cells=matching?[...matching.querySelectorAll("td")].map(c=>c.textContent.trim()):[];
    const map={myAssessAttendance:cells[2]||"—",myAssessMarks:cells[3]||"—",myAssessAssignments:cells[4]||"—",myAssessBand:cells[5]||"—"};
    Object.entries(map).forEach(([key,value])=>{if($(key))$(key).textContent=value;});
    if($("myAssessNote"))$("myAssessNote").textContent=id?"Academic indicators are for supportive review only. Ask a mentor about any concerns.":"Choose a record to see available academic indicators.";
  }
  $("myAssessmentStudent")?.addEventListener("change",showAssessment);
  $("progressStudent")?.addEventListener("change",refreshHome);
  $("progressSave")?.addEventListener("click",()=>setTimeout(refreshHome,0));
  // Mentor-only directory. Reuses the original app's student rows, so search and
  // assessment data stay consistent with the existing backend/demo state.
  let mentorSelectedId="";
  function mentorSourceRows(){
    return [...($("studentsTable")?.querySelectorAll("tr")||[])].filter(row=>row.querySelector("[data-detail]"));
  }
  function renderMentorDirectory(){
    if(!admin)return;
    const query=($("mentorStudentSearch")?.value||"").trim().toLowerCase();
    const band=$("mentorRiskFilter")?.value||"ALL";
    const source=mentorSourceRows(),target=$("mentorStudentRows");
    if(!target)return;
    target.replaceChildren();
    let count=0;
    source.forEach(row=>{
      const cells=[...row.querySelectorAll("td")];
      const studentId=row.querySelector("[data-detail]")?.dataset.detail;
      if(!studentId||cells.length<6)return;
      const hay=cells[0].textContent.toLowerCase();
      const status=cells[3].textContent.toLowerCase();
      const statusBand=status.includes("higher")?"HIGH":status.includes("watch")?"MEDIUM":status.includes("on track")?"LOW":"NONE";
      if(!hay.includes(query)||(band!=="ALL"&&band!==statusBand))return;
      const tr=document.createElement("tr");
      for(let i=0;i<5;i++){
        const td=document.createElement("td");
        if(i===0){
          const cell=cells[i].querySelector(".student-cell");
          if(cell)td.appendChild(cell.cloneNode(true));else td.textContent=cells[i].textContent;
        }else if(i===3){
          const badge=cells[i].querySelector(".band");
          if(badge)td.appendChild(badge.cloneNode(true));else td.textContent=cells[i].textContent;
        }else td.textContent=cells[i].textContent.trim();
        tr.appendChild(td);
      }
      const td=document.createElement("td"),btn=document.createElement("button");
      btn.type="button";btn.className="row-action";btn.textContent="View progress →";btn.dataset.mentorView=studentId;
      td.appendChild(btn);tr.appendChild(td);target.appendChild(tr);count++;
    });
    if(!count){
      const tr=document.createElement("tr"),td=document.createElement("td");
      td.colSpan=6;td.className="empty-cell";td.textContent="No students match these filters.";
      tr.appendChild(td);target.appendChild(tr);
    }
    if($("mentorStudentCount"))$("mentorStudentCount").textContent=`Showing ${count} of ${source.length} student records`;
    if(mentorSelectedId)showMentorProgress(mentorSelectedId);
  }
  function showMentorProgress(id){
    if(!admin)return;
    mentorSelectedId=String(id);
    const row=mentorSourceRows().find(el=>el.querySelector("[data-detail]")?.dataset.detail===mentorSelectedId);
    const name=row?.querySelector(".student-cell b")?.textContent||"Selected student";
    if($("mentorDetailTitle"))$("mentorDetailTitle").textContent=`${name} — progress`;
    if($("mentorDetailSubtitle"))$("mentorDetailSubtitle").textContent="Latest check-in and recorded improvement timeline";
    const history=getProgress()[mentorSelectedId]||[];
    const current=history[0];
    const values={
      mentorProgressAttendance:current?`${current.Attendance}%`:"—",
      mentorProgressAssignments:current?`${current.AssignmentsDone}/${current.AssignmentsTotal}`:"—",
      mentorProgressProblems:current?String(current.Problems):"—",
      mentorProgressHours:current?`${current.Hours}h`:"—"
    };
    Object.entries(values).forEach(([key,value])=>{if($(key))$(key).textContent=value;});
    const container=$("mentorProgressHistory");if(!container)return;
    container.replaceChildren();
    if(!history.length){
      const p=document.createElement("p");p.className="ai-admin-footnote";
      p.textContent="No progress check-ins are saved for this student in the institutional database yet.";
      container.appendChild(p);
    }else history.slice(0,20).forEach((entry,index)=>{
      const item=document.createElement("article");item.className="progress-history-item";
      const title=document.createElement("strong");
      title.textContent=entry.at?new Date(entry.at).toLocaleString():`Check-in ${index+1}`;
      const summary=document.createElement("p");
      summary.textContent=`Attendance ${entry.Attendance}% · Assignments ${entry.AssignmentsDone}/${entry.AssignmentsTotal} · ${entry.Problems} problems solved · ${entry.Hours} study hours`;
      item.append(title,summary);
      if(entry.note){const note=document.createElement("p");note.textContent=entry.note;item.appendChild(note);}
      container.appendChild(item);
    });
    $("mentorProgressDetail")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  $("mentorStudentSearch")?.addEventListener("input",renderMentorDirectory);
  $("mentorRiskFilter")?.addEventListener("change",renderMentorDirectory);
  $("mentorRefresh")?.addEventListener("click",renderMentorDirectory);
  $("mentorStudentRows")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-mentor-view]");
    if(button)showMentorProgress(button.dataset.mentorView);
  });
  if(admin&&$("studentsTable")){
    const directoryObserver=new MutationObserver(()=>renderMentorDirectory());
    directoryObserver.observe($("studentsTable"),{childList:true,subtree:true});
  }
  function refreshAdmin(){
    if(!admin)return;
    const total=Number($("edashTotal")?.textContent)||0;
    const assessed=Number($("edashAssessed")?.textContent)||0;
    const high=Number($("edashHigh")?.textContent)||0;
    const values={roleAccessed:assessed,roleRemaining:Math.max(0,total-assessed),roleHighRisk:high};
    Object.entries(values).forEach(([id,v])=>{if($(id))$(id).textContent=String(v);});
    const target=$("roleScoreRows"),source=$("aiAdminStudentRows");
    if(!target||!source)return;
    target.replaceChildren();
    const rows=[...source.querySelectorAll("tr")];
    rows.forEach(row=>{
      const cells=[...row.querySelectorAll("td")];
      if(cells.length<5)return;
      const tr=document.createElement("tr");
      [0,2,3,4,5].forEach(i=>{const td=document.createElement("td");td.textContent=cells[i]?.textContent.trim()||"—";tr.appendChild(td);});
      target.appendChild(tr);
    });
    if(!target.children.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="No student assessment records available.";tr.appendChild(td);target.appendChild(tr);}
  }
  // Existing app loads data asynchronously; update summaries as it renders.
  const observer=new MutationObserver(()=>{
    if(admin)refreshAdmin();
    else if($("myAssessmentStudent")?.options.length<=1)refreshAssessment();
  });
  const watch=admin?$("edashTotal"):$("aiAdminStudentSelect");
  if(watch)observer.observe(watch,{childList:true,subtree:true,characterData:true});
  setTimeout(()=>{refreshAdmin();refreshAssessment();refreshHome();},500);
  go(admin?"dashboard":"student-home");
  loadCentralProgress();
  window.addEventListener("focus",loadCentralProgress);
  window.setInterval(loadCentralProgress,60000);
});
