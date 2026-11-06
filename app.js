/* ShikshaSetu frontend — server-backed institutional workspace; no local demo substitution */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";
  const API = localStorage.getItem("shikshasetu-api") || "http://localhost:8000";
  const $ = id => document.getElementById(id);
  const state = { students: [], risks: {}, feedback: [], interventions: [], academicTrends: {}, aiAdminReviews: [], demo: false, offline: false, page: "overview", accountProfile: null, modelStatus: null };
  async function request(path,options={}) {
    const token=sessionStorage.getItem("shikshasetu-session-token-v1");
    const headers={...(options.headers||{})};
    if(token)headers.Authorization=`Bearer ${token}`;
    const res=await fetch(API+path,{...options,headers});
    const text=await res.text();
    let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok)throw new Error(data?.error||data?.message||`Request failed (${res.status})`);
    return data;
  }
  function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
  function initials(name){return String(name||"S").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
  function toast(message,type="success"){const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=message;$("toastRegion").append(el);setTimeout(()=>el.remove(),3400)}
  function scoreStudent(s){
    const parts=[
      ["Low attendance",s.attendance<60?30:s.attendance<75?18:0],
      ["Low internal marks",s.internalMarks<40?25:s.internalMarks<55?15:0],
      ["Incomplete assignments",s.assignmentsCompleted<50?20:s.assignmentsCompleted<75?10:0],
      ["Previous course failures",Math.min(15,(s.previousFailures||0)*5)],
      ["High absence count",Math.min(10,(s.absences||0)*2)]
    ];
    const score=parts.reduce((a,p)=>a+p[1],0),band=score>=60?"HIGH":score>=30?"MEDIUM":"LOW";
    return {id:`demo-${s.id}`,studentId:s.id,assessmentType:"RULE_BASED_SUPPORT_SCREENING",riskScore:score,riskBand:band,explanation:"Baseline indicator contributions (points): "+(parts.filter(p=>p[1]>0).map(p=>`${p[0]} +${p[1]}`).join("; ")||"No elevated indicators in the supplied fields.")+`. Score ${score}/100. This is an assistive screening estimate, not a causal explanation or permanent label.`,assessedAt:new Date().toISOString(),parts};
  }
  function parseStoredJson(value, fallback){
    if(value && typeof value === "object") return value;
    try{return value?JSON.parse(value):fallback}catch{return fallback}
  }
  function mapMlAssessment(item, studentIdFallback){
    const probability=Number(item.deteriorationProbability ?? item.deterioration_probability ?? 0);
    const features=parseStoredJson(item.observedFeatures ?? item.featuresJson ?? item.features_json,{});
    const signals=parseStoredJson(item.observedSignals ?? item.signalsJson ?? item.signals_json,[]);
    const suggestions=parseStoredJson(item.supportSuggestions ?? item.support_suggestions ?? item.suggestionsJson ?? item.suggestions_json,[]);
    const priority=item.supportPriority ?? item.support_priority ?? "LOW";
    return {
      id:item.assessmentId ?? item.id ?? `ml-${Date.now()}`,
      studentId:item.studentId ?? item.student_id ?? studentIdFallback,
      assessmentType:"ACADEMIC_DETERIORATION_PROBABILITY",
      riskScore:Math.round(probability*100),
      riskBand:priority,
      assessedAt:item.assessedAt ?? item.assessed_at ?? new Date().toISOString(),
      explanation:item.interpretation ?? "scikit-learn Random Forest estimate for the defined next-period academic deterioration outcome.",
      modelEngine:"scikit-learn Random Forest",
      modelVersion:item.modelVersion ?? item.model_version ?? "unknown",
      deteriorationProbability:probability,
      observedFeatures:features,
      observedSignals:Array.isArray(signals)?signals:[],
      supportSuggestions:Array.isArray(suggestions)?suggestions:[],
      dataQualityWarnings:item.dataQualityWarnings ?? item.data_quality_warnings ?? [],
      requiresHumanReview:item.requiresHumanReview ?? true
    };
  }
  async function performAssessment(studentId){
    if(state.demo) return scoreStudent(state.students.find(s=>String(s.id)===String(studentId))||{});
    if(state.modelStatus?.status === "TRAINED_PROTOTYPE"){
      const modelResult=await request(`/api/ai/students/${studentId}/assessment`,{method:"POST"});
      return mapMlAssessment(modelResult,studentId);
    }
    return request(`/api/students/${studentId}/assess`,{method:"POST"});
  }
  function latestRisk(id){return state.risks[id]?.[0]||null}
  function bandClass(band){return band==="HIGH"?"high":band==="MEDIUM"?"medium":band==="LOW"?"low":"none"}
  function bandLabel(band){return band==="HIGH"?"Higher support":band==="MEDIUM"?"Watch list":band==="LOW"?"On track":"Not assessed"}
  function renderStatus(){
    const el=$("apiStatus");el.className="api-status "+(state.offline?"offline":"online");
    el.querySelector("span").textContent=state.offline?"Server unavailable":"Backend connected";
    $("studentNavCount").textContent=state.students.length;
  }
  function mapManualInterpretation(item){
    return {id:String(item.id),studentId:item.studentId,studentName:item.studentNameSnapshot||"Student",status:item.reviewStatus||"Needs mentor context",interpretation:item.interpretation||"",evidence:item.evidence||"",nextAction:item.nextAction||"",createdAt:item.createdAt||new Date().toISOString(),modelScore:item.riskScoreSnapshot??null,modelBand:item.riskBandSnapshot||"NOT_ASSESSED"};
  }
  function mapSupportTrendsFromRecords(records){
    const groups=new Map();
    (Array.isArray(records)?records:[]).forEach(record=>{
      const name=String(record.assessmentName||"");
      const match=name.match(/^ShikshaSetu Support Loop (.+) \| (PREVIOUS|LATEST)$/);
      if(!match)return;
      const entry=groups.get(match[1])||{};
      const row={date:record.recordDate,mark:record.maxMarks?Number(record.marksObtained)/Number(record.maxMarks)*100:null,attendance:record.attendancePercent,consecutiveAbsences:record.consecutiveAbsences,repeatedFailures:record.repeatedFailures,createdAt:record.createdAt};
      entry[match[2].toLowerCase()]=row;entry.subject=record.subject;groups.set(match[1],entry);
    });
    return [...groups.values()].filter(x=>x.previous&&x.latest).map(x=>({subject:x.subject,previousMark:x.previous.mark,latestMark:x.latest.mark,previousAttendance:x.previous.attendance??"",consecutiveAbsences:x.latest.consecutiveAbsences??0,repeatedFailures:x.latest.repeatedFailures??0,previousRecordDate:x.previous.date,latestRecordDate:x.latest.date,recordedAt:x.latest.createdAt})).sort((a,b)=>String(b.latestRecordDate).localeCompare(String(a.latestRecordDate))).slice(0,20);
  }
  function mapBackendFollowup(item){
    const followDate=String(item.followUpDate||"");
    return {id:String(item.id),backendId:item.id,studentId:item.studentId,studentName:item.studentName||"Student",action:item.actionTaken||"Mentor follow-up",weeklyTarget:item.weeklyTarget||"",followUpDate:followDate?followDate.slice(0,10):"Date not set",status:item.followUpStatus||"Scheduled",outcome:item.outcomeNote||"",createdAt:item.createdAt||new Date().toISOString()};
  }
  async function loadData(){
    try{
      const [students,interventions]=await Promise.all([request("/api/students"),request("/api/interventions")]);
      state.students=students;state.interventions=interventions;state.demo=false;state.offline=false;state.risks={};state.feedback=[];state.academicTrends={};
      try{state.modelStatus=await request("/api/ai/model/status")}catch{state.modelStatus=null}
      try{
        const reviews=await request("/api/ai-admin/interpretations");
        state.aiAdminReviews=(Array.isArray(reviews)?reviews:[]).map(mapManualInterpretation);
      }catch{state.aiAdminReviews=[]}
      await Promise.all(students.map(async s=>{
        let baseline=[],mlHistory=[],academic=[],feedback=[];
        try{baseline=await request(`/api/students/${s.id}/risk-history`)}catch{}
        try{mlHistory=await request(`/api/ai/students/${s.id}/history`)}catch{}
        try{academic=await request(`/api/students/${s.id}/academic-records`)}catch{}
        try{feedback=await request(`/api/students/${s.id}/feedback`)}catch{}
        const mapped=(Array.isArray(mlHistory)?mlHistory:[]).map(x=>mapMlAssessment(x,s.id));
        const baselineMapped=(Array.isArray(baseline)?baseline:[]).map(x=>({...x,assessmentType:"RULE_BASED_SUPPORT_SCREENING"}));
        state.risks[s.id]=[...baselineMapped,...mapped].sort((a,b)=>new Date(b.assessedAt||0)-new Date(a.assessedAt||0));
        state.academicTrends[s.id]=mapSupportTrendsFromRecords(academic);
        (Array.isArray(feedback)?feedback:[]).forEach(item=>state.feedback.push({...item,studentName:s.fullName}));
      }));
      renderStatus();
    }catch(err){
      state.students=[];state.risks={};state.feedback=[];state.interventions=[];state.demo=false;state.offline=true;state.modelStatus=null;state.aiAdminReviews=[];state.academicTrends={};renderStatus();
      toast("Live institutional data is unavailable. Check the ShikshaSetu server connection; demo records are not substituted.", "error");
    }
    renderAll();
  }
  function renderAll(){renderOverview();renderExecutiveDashboard();renderStudents();renderStudentSelect();renderInterventions();renderFeedback();renderSupportPage();renderAiAdminPage();if(state.page==="fairness")loadFairness()}
  function counts(){
    const assessed=state.students.map(s=>latestRisk(s.id)).filter(Boolean);
    return {total:state.students.length,high:assessed.filter(r=>r.riskBand==="HIGH").length,medium:assessed.filter(r=>r.riskBand==="MEDIUM").length,low:assessed.filter(r=>r.riskBand==="LOW").length,assessed:assessed.length};
  }
  function renderOverview(){
    const c=counts();$("statTotal").textContent=c.total;$("statHigh").textContent=c.high;$("statMedium").textContent=c.medium;$("statLow").textContent=c.low;
    const rows=state.students.filter(s=>latestRisk(s.id)).sort((a,b)=>latestRisk(b.id).riskScore-latestRisk(a.id).riskScore).slice(0,5);
    $("overviewStudents").innerHTML=rows.length?rows.map(s=>studentRow(s,true)).join(""):`<tr><td colspan="5" class="empty-cell">No assessments yet. Open Students and assess a record to get started.</td></tr>`;
    drawChart(c.high,c.medium,c.low);
  }
  function studentRow(s,overview=false){
    const r=latestRisk(s.id),band=r?.riskBand;
    return `<tr><td><div class="student-cell"><div class="student-avatar">${escapeHTML(initials(s.fullName))}</div><div><b>${escapeHTML(s.fullName)}</b><small>${escapeHTML(s.studentCode)}${s.email?" · "+escapeHTML(s.email):""}</small></div></div></td><td>${Number(s.attendance).toFixed(1)}%</td>${overview?"":`<td>${Number(s.internalMarks).toFixed(1)}%</td>`}<td>${r?`<span class="band ${bandClass(band)}">${bandLabel(band)}</span>`:`<span class="band none">Not assessed</span>`}</td>${overview?`<td>${r?new Date(r.assessedAt).toLocaleDateString():"—"}</td>`:`<td>${r?`${r.riskScore}/100`:"—"}</td>`}<td><button class="row-action" data-detail="${s.id}">View →</button></td></tr>`;
  }
  function renderStudents(){
    const q=$("studentSearch").value.trim().toLowerCase(),filter=$("riskFilter").value;
    const list=state.students.filter(s=>{
      const hay=[s.fullName,s.studentCode,s.email].join(" ").toLowerCase(),r=latestRisk(s.id);
      const matchesBand=filter==="ALL"||(filter==="NONE"?!r:r?.riskBand===filter);
      return hay.includes(q)&&matchesBand;
    });
    $("studentsTable").innerHTML=list.length?list.map(s=>studentRow(s,false)).join(""):`<tr><td colspan="6" class="empty-cell">No students match these filters.</td></tr>`;
    $("filteredCount").textContent=`${list.length} student${list.length===1?"":"s"}`;
    $("studentCountLabel").textContent=`Showing ${list.length} of ${state.students.length} student records`;
  }
  function drawChart(high,medium,low){
    const canvas=$("riskChart");if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),w=Math.max(260,rect.width||400),h=210,dpr=window.devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    const vals=[high,medium,low],colors=["#d77b72","#d8a44d","#4eaa83"],labels=["Higher support","Watch list","On track"],max=Math.max(1,...vals),left=22,base=164,barW=Math.min(64,(w-100)/3),gap=(w-2*left-3*barW)/2;
    ctx.font="11px DM Sans";ctx.textAlign="center";
    vals.forEach((v,i)=>{const x=left+i*(barW+gap),bh=(v/max)*112;ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--border-soft");roundRect(ctx,x,base-112,barW,112,8);ctx.fill();ctx.fillStyle=colors[i];roundRect(ctx,x,base-bh,barW,Math.max(4,bh),8);ctx.fill();ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--text");ctx.font="700 13px DM Sans";ctx.fillText(v,x+barW/2,base-bh-9);ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--muted");ctx.font="10px DM Sans";ctx.fillText(labels[i],x+barW/2,base+20)});
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--border-soft");ctx.beginPath();ctx.moveTo(10,base);ctx.lineTo(w-10,base);ctx.stroke();
  }
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function renderStudentSelect(){
    const options=state.students.map(s=>`<option value="${s.id}">${escapeHTML(s.fullName)} (${escapeHTML(s.studentCode)})</option>`).join("");
    $("feedbackStudent").innerHTML='<option value="">Choose a student</option>'+options;
    const chatSelect=$("studentChatContext");
    if(chatSelect){
      const previous=chatSelect.value;
      chatSelect.innerHTML='<option value="">No student selected</option>'+options;
      if(previous&&state.students.some(s=>String(s.id)===String(previous)))chatSelect.value=previous;
    }
  }
  function renderInterventions(){
    $("interventionGrid").innerHTML=state.interventions.map((x,i)=>`<article class="panel glass intervention-card"><div class="intervention-icon">${["✦","◷","✓","♧"][i%4]}</div><h3>${escapeHTML(x.name)}</h3><p>${escapeHTML(x.description)}</p><div class="tag-row">${(x.forIndicators||[]).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join("")}</div></article>`).join("")||'<div class="panel glass loading-card">No intervention options available.</div>';
  }
  async function loadFeedbackFor(studentId){
    if(state.demo)return state.feedback.filter(f=>String(f.studentId)===String(studentId));
    return request(`/api/students/${studentId}/feedback`);
  }
  async function renderFeedback(){
    const all=[];
    for(const s of state.students){try{const fs=await loadFeedbackFor(s.id);fs.forEach(f=>all.push({...f,studentName:s.fullName}))}catch{}}
    if(state.demo)state.feedback=all.map(({studentName,...f})=>f);
    all.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    $("feedbackHistory").innerHTML=all.length?all.slice(0,10).map(f=>`<article class="feedback-entry"><div class="feedback-entry-head"><div><b>${escapeHTML(f.studentName||"Student")}</b><br><small>${escapeHTML(f.mentorName||"Mentor")} · ${f.createdAt?new Date(f.createdAt).toLocaleString():"Just now"}</small></div>${f.followUpDate?`<span class="soft-pill">Follow-up ${new Date(f.followUpDate).toLocaleDateString()}</span>`:""}</div><p>${escapeHTML(f.observation)}</p>${f.actionTaken?`<p class="action-note"><b>Agreed support:</b> ${escapeHTML(f.actionTaken)}</p>`:""}</article>`).join(""):'<div class="empty-state">No mentor notes yet. Log a student check-in to begin.</div>';
  }
  async function loadFairness(){
    if(state.demo){
      const groups={};state.students.forEach(s=>{if(!s.auditGroup)return;const r=latestRisk(s.id);if(!r)return;groups[s.auditGroup]??=[];groups[s.auditGroup].push(r)});
      renderFairness({groups:Object.fromEntries(Object.entries(groups).map(([k,rs])=>[k,{assessedCount:rs.length,highRiskCount:rs.filter(r=>r.riskBand==="HIGH").length,highRiskRate:rs.filter(r=>r.riskBand==="HIGH").length/rs.length}]))});
      return;
    }
    try{renderFairness(await request("/api/fairness/audit"))}catch(e){$("fairnessResults").innerHTML=`<div class="empty-state">${escapeHTML(e.message)}</div>`}
  }
  function renderFairness(data){
    const groups=data.groups||{},entries=Object.entries(groups);
    $("fairnessResults").innerHTML=entries.length?`<div class="fairness-group head"><span>AUDIT GROUP</span><span>ASSESSED</span><span>HIGHER SUPPORT RATE</span></div>`+entries.map(([name,g])=>`<div class="fairness-group"><strong>${escapeHTML(name)}</strong><span>${g.assessedCount}</span><div><b>${(g.highRiskRate*100).toFixed(1)}%</b><div class="rate-track"><span style="width:${Math.min(100,g.highRiskRate*100)}%"></span></div></div></div>`).join("")+`<p class="fairness-table-note">${escapeHTML(data.notice||"Descriptive comparison only. Review sample sizes and context before drawing conclusions.")}</p>`:'<div class="empty-state">No grouped assessments found. Add an optional audit group to student records and run assessments.</div>';
  }

  /* =========================================================
     AI MENTOR SUPPORT LOOP — FRONTEND MODULE
     Shares the existing student list, assessments, interventions,
     and mentor feedback state. Academic trends, mentor follow-ups,
     and manual AI interpretations sync with the FastAPI APIs;
     voluntary mood check-ins remain browser-local by design.
     ========================================================= */
  const supportStoreKey = "shikshasetu-support-loop-v1";
  let supportSelectedStudentId = null;
  let supportSelectedIntervention = null;
  let supportCycleRunning = false;
  const supportAutoCycleCompleted = new Set();

  function readSupportStore(){
    try{
      const value=JSON.parse(localStorage.getItem(supportStoreKey)||"null");
      return value&&typeof value==="object"?value:{trends:{},followups:[],moods:[]};
    }catch{return {trends:{},followups:[],moods:[]}}
  }
  function writeSupportStore(value){
    try{localStorage.setItem(supportStoreKey,JSON.stringify(value));}
    catch{toast("Browser storage is unavailable; this support entry was not saved.","error")}
  }
  function currentSupportStudent(){
    return state.students.find(s=>String(s.id)===String(supportSelectedStudentId))||null;
  }
  function supportSetStage(stage){
    document.querySelectorAll(".support-process-step").forEach((step,index)=>{
      step.classList.toggle("active",index+1<=stage);
    });
  }
  function supportStudentOptions(){
    const select=$("supportStudentSelect");
    if(!select)return;
    const previous=supportSelectedStudentId;
    select.innerHTML='<option value="">Choose a student</option>'+state.students.map(s=>
      `<option value="${escapeHTML(s.id)}">${escapeHTML(s.fullName)} · ${escapeHTML(s.studentCode)}</option>`
    ).join("");
    if(previous&&state.students.some(s=>String(s.id)===String(previous)))select.value=String(previous);
    else if(state.students.length){supportSelectedStudentId=state.students[0].id;select.value=String(supportSelectedStudentId)}
    else{supportSelectedStudentId=null;select.value=""}
  }
  function supportMetric(label,value){
    return `<div class="support-stat"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`;
  }
  function supportBand(score){
    return score>=60?"HIGH":score>=30?"MEDIUM":"LOW";
  }
  function supportRenderSnapshot(student){
    const box=$("supportStudentSnapshot"),hint=$("supportAssessmentHint"),button=$("supportRunAssessment");
    if(!student){
      box.innerHTML='<div class="empty-state">No student records are available. Add a student from the Students page first.</div>';
      hint.textContent="A student record is required.";
      button.disabled=true;
      return;
    }
    const risk=latestRisk(student.id);
    box.innerHTML=[
      supportMetric("Attendance",`${Number(student.attendance||0).toFixed(1)}%`),
      supportMetric("Internal marks",`${Number(student.internalMarks||0).toFixed(1)}%`),
      supportMetric("Assignments",`${Number(student.assignmentsCompleted||0).toFixed(1)}%`),
      supportMetric("Previous failures",String(student.previousFailures||0)),
      supportMetric("Absence count",String(student.absences||0)),
      supportMetric("Support priority",risk?`${risk.riskBand} · ${risk.riskScore}/100`:"Not assessed")
    ].join("");
    hint.textContent=risk?`Last assessed ${risk.assessedAt?new Date(risk.assessedAt).toLocaleString():"date unavailable"}.`:"Run an assessment to begin tracking snapshots.";
    button.disabled=false;
  }
  function supportGetTrends(studentId){
    if(!state.demo)return state.academicTrends?.[String(studentId)]||[];
    const store=readSupportStore();
    return Array.isArray(store.trends?.[String(studentId)])?store.trends[String(studentId)]:[];
  }
  function supportRenderEarlySignals(student){
    const box=$("supportEarlySignals");
    if(!student){box.innerHTML='<div class="empty-state">Select a student to view available indicators.</div>';return}
    const trends=supportGetTrends(student.id);
    const latest=trends[0];
    const items=[
      {icon:"▤",title:"Academic performance monitoring",detail:`Internal marks are ${Number(student.internalMarks||0).toFixed(1)}%; previous course failures recorded: ${Number(student.previousFailures||0)}.`,status:student.internalMarks<55||student.previousFailures>0?"Review":"No flag"},
      {icon:"◷",title:"Attendance monitoring",detail:`Current attendance is ${Number(student.attendance||0).toFixed(1)}%; recorded absences: ${Number(student.absences||0)}.`,status:student.attendance<60?"Review":student.attendance<75?"Watch":"No flag"},
      {icon:"✓",title:"Assignment completion",detail:`${Number(student.assignmentsCompleted||0).toFixed(1)}% of assignments completed in the current record.`,status:student.assignmentsCompleted<50?"Review":student.assignmentsCompleted<75?"Watch":"No flag"}
    ];
    if(latest){
      const drop=Number(latest.previousMark)-Number(latest.latestMark);
      if(drop>=10)items.push({icon:"↘",title:`Sudden mark drop · ${latest.subject}`,detail:`Recorded change from ${latest.previousMark}% to ${latest.latestMark}% (${drop.toFixed(1)} percentage points).`,status:"Review"});
      if(Number(latest.consecutiveAbsences)>=3)items.push({icon:"!",title:"Consecutive absences",detail:`${latest.consecutiveAbsences} consecutive absences recorded in the latest dated snapshot.`,status:"Review"});
      if(Number(latest.repeatedFailures)>0)items.push({icon:"!",title:`Repeated subject difficulties · ${latest.subject}`,detail:`${latest.repeatedFailures} repeated failure(s) entered in the dated snapshot.`,status:"Review"});
      if(latest.previousAttendance!==""&&latest.previousAttendance!=null){
        const attendanceDrop=Number(latest.previousAttendance)-Number(student.attendance);
        if(attendanceDrop>=8)items.push({icon:"↘",title:"Declining attendance",detail:`Attendance changed from ${latest.previousAttendance}% to ${student.attendance}% in the supplied records.`,status:"Watch"});
      }
    }
    box.innerHTML=items.map(item=>`<div class="support-signal"><span class="support-signal-icon">${item.icon}</span><div><b>${escapeHTML(item.title)}</b><p>${escapeHTML(item.detail)}</p></div><em>${escapeHTML(item.status)}</em></div>`).join("");
  }
  function supportRenderTrendHistory(student){
    const trends=student?supportGetTrends(student.id):[];
    const list=$("supportTrendHistory"),signals=$("supportTrendSignals"),badge=$("supportTrendBadge");
    if(!student||!trends.length){
      badge.textContent="No trend data";
      signals.innerHTML='<div class="support-empty-hint">Save a dated subject or attendance snapshot to see trend signals.</div>';
      list.innerHTML="";
      return;
    }
    const item=trends[0],drop=Number(item.previousMark)-Number(item.latestMark);
    const attendanceDrop=item.previousAttendance===""?0:Number(item.previousAttendance)-Number(student.attendance);
    const alerts=[];
    if(drop>=10)alerts.push(`Mark drop of ${drop.toFixed(1)} points in ${item.subject}`);
    if(Number(item.consecutiveAbsences)>=3)alerts.push(`${item.consecutiveAbsences} consecutive absences`);
    if(Number(item.repeatedFailures)>0)alerts.push(`${item.repeatedFailures} repeated subject failure(s)`);
    if(attendanceDrop>=8)alerts.push(`Attendance declined by ${attendanceDrop.toFixed(1)} points`);
    badge.textContent=alerts.length?`${alerts.length} signal(s) to review`:"No threshold crossed";
    signals.innerHTML=alerts.length?alerts.map(a=>`<div class="support-trend-item"><b>Review this signal</b><p>${escapeHTML(a)}. Discuss the student's context before deciding on support.</p></div>`).join(""):'<div class="support-trend-item"><b>No configured trend threshold crossed</b><p>Continue monitoring and review the next dated snapshot.</p></div>';
    list.innerHTML=trends.slice(0,4).map(t=>`<div class="support-trend-item"><b>${escapeHTML(t.subject)} · ${Number(t.latestMark).toFixed(1)}%</b><p>${escapeHTML(t.recordedAt?new Date(t.recordedAt).toLocaleDateString():"Date unavailable")} · previous ${Number(t.previousMark).toFixed(1)}% · ${Number(t.consecutiveAbsences||0)} consecutive absence(s) · ${Number(t.repeatedFailures||0)} repeated failure(s)</p></div>`).join("");
  }
  function supportRenderExplanation(student){
    const box=$("supportRiskExplanation"),badge=$("supportRiskBand");
    if(!student){badge.textContent="Not assessed";box.innerHTML='<div class="empty-state">Select a student first.</div>';return}
    const record=latestRisk(student.id);
    if(!record){badge.textContent="Not assessed";box.innerHTML='<div class="empty-state">Run an assessment to see the available explanation.</div>';return}
    badge.textContent=`${bandLabel(record.riskBand)} · ${record.riskScore}/100`;
    badge.className=`band ${bandClass(record.riskBand)}`;
    if(record.modelEngine){
      const featureLabels={attendance_percent:"Attendance",internal_marks_percent:"Internal marks",assignment_completion_percent:"Assignment completion",previous_failures:"Previous failures",absence_count:"Absence count",consecutive_absences:"Consecutive absences",recent_mark_drop:"Recent mark drop",repeated_low_results:"Repeated low results"};
      const featureRows=Object.entries(record.observedFeatures||{}).map(([key,value])=>`<div class="support-explain-row"><span>${escapeHTML(featureLabels[key]||key.replaceAll("_"," "))}</span><b>${value==null?"Missing":escapeHTML(String(value)+(key.endsWith("percent")||key==="recent_mark_drop"?"%":""))}</b></div>`).join("");
      const signals=(record.observedSignals||[]).map(x=>`<div class="support-trend-item"><b>Observed signal</b><p>${escapeHTML(x)}</p></div>`).join("");
      const suggestions=(record.supportSuggestions||[]).map(x=>`<div class="support-trend-item"><b>${escapeHTML(x.title||"Support option")}</b><p>${escapeHTML(x.reason||"")}</p><p>${escapeHTML(x.suggestedAction||"")}</p><small>${escapeHTML(x.weeklyTarget||"")}${x.resourceType?` · Resource: ${escapeHTML(x.resourceType)}`:""}</small></div>`).join("");
      const warnings=(record.dataQualityWarnings||[]).map(x=>`<div class="support-trend-item"><b>Data-quality note</b><p>${escapeHTML(x)}</p></div>`).join("");
      box.innerHTML=`<div class="support-trend-item"><b>scikit-learn Random Forest · ${escapeHTML(record.modelVersion||"model version unavailable")}</b><p>Estimated probability of the defined next-period academic deterioration outcome: <strong>${(Number(record.deteriorationProbability||0)*100).toFixed(1)}%</strong>. This is not a diagnosis or a causal explanation.</p></div><div class="support-explain-heading">Input snapshot · not feature contributions</div>${featureRows}${signals?`<div class="support-explain-heading">Early signals</div>${signals}`:""}${suggestions?`<div class="support-explain-heading">Personalised support suggestions · mentor review required</div>${suggestions}`:""}${warnings}`;
      return;
    }
    const parts=Array.isArray(record.parts)?record.parts:parseExplanation(record.explanation||"");
    box.innerHTML=(parts.length?parts:[["Explanation unavailable",0]]).map(p=>
      `<div class="support-explain-row"><span>${escapeHTML(p[0])}</span><b>${Number(p[1])>0?`+${Number(p[1])} points`:"No added points"}</b></div>`
    ).join("")+`<p class="support-muted">This is the existing baseline scoring explanation. It describes indicator contributions, not causes. Audit group, age and mood are not used in the individual score.</p>`;
  }

  function supportBuildPlan(student){
    const modelRisk=student?latestRisk(student.id):null;
    if(modelRisk?.modelEngine && Array.isArray(modelRisk.supportSuggestions) && modelRisk.supportSuggestions.length){
      return {
        gaps:modelRisk.supportSuggestions.map(x=>[x.title||"Support need",x.reason||"Review this signal with the student."]),
        resources:modelRisk.supportSuggestions.map(x=>[x.resourceType||"Mentor-approved resource",x.suggestedAction||"Discuss and select an appropriate support action."]),
        targets:modelRisk.supportSuggestions.map(x=>[x.title||"Weekly target",x.weeklyTarget||"Agree a manageable goal with the student."])
      };
    }
    const gaps=[],resources=[],targets=[];
    if(student.attendance<75){
      gaps.push(["Attendance consistency","Current attendance is below the 75% review threshold in this prototype. Ask about transport, timetable, health or other barriers without assuming the cause."]);
      targets.push(["Attendance goal","Agree on a realistic attendance target for the next week and identify one barrier the mentor can help address."]);
      resources.push(["Attendance planning sheet","A weekly calendar to plan classes, note barriers and review progress with a mentor."]);
    }
    if(student.internalMarks<55||Number(student.previousFailures)>0){
      gaps.push(["Subject understanding","The available marks or previous-failure count suggest a subject-level conversation may be useful. The current dataset does not identify specific concepts."]);
      targets.push(["Focused subject practice","Choose one difficult topic and complete two short practice sessions with feedback this week."]);
      resources.push(["Topic practice set","A mentor-selected worksheet, guided example or subject-specific revision resource."]);
    }
    if(student.assignmentsCompleted<75){
      gaps.push(["Assignment completion","The recorded completion percentage suggests that workload planning or assignment support may help."]);
      targets.push(["Assignment milestone","Break one pending assignment into two small milestones with a mutually agreed due date."]);
      resources.push(["Assignment planner","A short checklist with subtasks, due dates and a review point."]);
    }
    if(!gaps.length){
      gaps.push(["Maintain positive momentum","No elevated gap is evident from the fields currently available. Continue to ask the student what support is useful."]);
      targets.push(["Extension goal","Choose one achievable learning goal and review it at the next mentor check-in."]);
      resources.push(["Enrichment resource","A subject extension activity, practice quiz or peer-learning session chosen with the student."]);
    }
    return {gaps,resources,targets};
  }
  function supportRenderPlan(student){
    const gaps=$("supportLearningGaps"),resources=$("supportLearningResources"),targets=$("supportWeeklyTargets");
    if(!student){
      [gaps,resources,targets].forEach(x=>x.innerHTML='<div class="empty-state">Select a student to see suggestions.</div>');
      return;
    }
    const plan=supportBuildPlan(student);
    gaps.innerHTML=plan.gaps.map(([title,desc])=>`<article class="support-gap-item"><b>${escapeHTML(title)}</b><p>${escapeHTML(desc)}</p></article>`).join("");
    resources.innerHTML=plan.resources.map(([title,desc])=>`<article class="support-resource-item"><b>${escapeHTML(title)}</b><p>${escapeHTML(desc)}</p></article>`).join("");
    targets.innerHTML=plan.targets.map(([title,desc])=>`<article class="support-target-item"><b>${escapeHTML(title)}</b><p>${escapeHTML(desc)}</p><button type="button" class="support-choice-button" data-support-target="${escapeHTML(title)}">Use this weekly target</button></article>`).join("");
  }
  function supportInterventionMatch(intervention,student){
    const name=String(intervention.name||"").toLowerCase();
    if(name.includes("attendance")&&student.attendance<75)return "Attendance signal";
    if((name.includes("academic")||name.includes("mentor"))&&(student.internalMarks<55||student.previousFailures>0))return "Academic signal";
    if(name.includes("assignment")&&student.assignmentsCompleted<75)return "Assignment signal";
    return "Optional support";
  }
  function supportRenderRecommendations(student){
    const box=$("supportRecommendations");
    if(!student){box.innerHTML='<div class="empty-state">Select a student to view intervention options.</div>';return}
    const list=state.interventions.length?state.interventions:[];
    if(!list.length){box.innerHTML='<div class="empty-state">No intervention catalogue is available. Add interventions through the existing backend.</div>';return}
    box.innerHTML=list.map((x,i)=>`<article class="support-recommendation"><div class="support-recommendation-top"><h4>${escapeHTML(x.name||"Support option")}</h4><button class="support-choice-button" data-support-choice="${escapeHTML(x.id??i)}" type="button">Select</button></div><p>${escapeHTML(x.description||"Discuss this option with the student.")}</p><small class="support-muted">${escapeHTML(supportInterventionMatch(x,student))}</small></article>`).join("");
    if(supportSelectedIntervention){
      $("supportSelectedRecommendation").textContent=`Selected support: ${supportSelectedIntervention.name||"Support option"}`;
      $("supportMentorAction").value=`${supportSelectedIntervention.name||"Support option"} — `;
    }else{
      $("supportSelectedRecommendation").textContent="No support option selected. Choose an intervention to add it to the mentor action.";
    }
  }
  function supportGetFollowups(){
    if(!state.demo)return state.feedback.map(mapBackendFollowup).filter(item=>item.followUpDate!=="Date not set");
    const store=readSupportStore();return Array.isArray(store.followups)?store.followups:[];
  }
  function supportRenderFollowups(student){
    const items=student?supportGetFollowups().filter(x=>String(x.studentId)===String(student.id)):[];
    const list=$("supportFollowupList"),select=$("supportFollowupSelect");
    if(!items.length){
      list.innerHTML='<div class="empty-state">No follow-ups recorded for this student yet.</div>';
      select.innerHTML='<option value="">Choose a follow-up</option>';
      return;
    }
    list.innerHTML=items.slice(0,5).map(item=>`<article class="support-followup-item"><b>${escapeHTML(item.action||"Mentor follow-up")}</b><small>${escapeHTML(item.followUpDate)} · ${escapeHTML(item.status||"Scheduled")}</small>${item.weeklyTarget?`<small>Weekly target: ${escapeHTML(item.weeklyTarget)}</small>`:""}${item.outcome?`<p>${escapeHTML(item.outcome)}</p>`:""}</article>`).join("");
    select.innerHTML='<option value="">Choose a follow-up</option>'+items.filter(x=>x.status==="Scheduled").map(x=>`<option value="${escapeHTML(x.id)}">${escapeHTML(x.followUpDate)} · ${escapeHTML(x.action||"Support action").slice(0,48)}</option>`).join("");
  }
  function supportRenderRiskComparison(student){
    const box=$("supportRiskCompare");
    if(!student){box.innerHTML='<div class="empty-state">Select a student to review changes.</div>';return}
    const history=state.risks[student.id]||[];
    const newest=history[0];
    const comparable=history.filter(item=>(item.assessmentType||"RULE_BASED_SUPPORT_SCREENING")===(newest?.assessmentType||"RULE_BASED_SUPPORT_SCREENING"));
    if(comparable.length<2){box.innerHTML='<div class="empty-state">Two snapshots from the same assessment engine are required. Rule-based scores and Random Forest probabilities are not mixed in one comparison.</div>';return}
    const previous=comparable[1],delta=Number(newest.riskScore)-Number(previous.riskScore);
    const label=delta<0?`${Math.abs(delta)} point decrease`:delta>0?`${delta} point increase`:"No score change";
    box.innerHTML=`<div class="support-compare-head"><b>${delta<0?"↓":delta>0?"↑":"→"} ${Math.abs(delta)} pts</b><span>${escapeHTML(label)}</span></div><div class="support-trend-item"><b>Previous · ${Number(previous.riskScore)}/100 · ${escapeHTML(previous.riskBand)}</b><p>${escapeHTML(previous.assessedAt?new Date(previous.assessedAt).toLocaleString():"Date unavailable")}</p></div><div class="support-trend-item"><b>Latest · ${Number(newest.riskScore)}/100 · ${escapeHTML(newest.riskBand)}</b><p>${escapeHTML(newest.assessedAt?new Date(newest.assessedAt).toLocaleString():"Date unavailable")}</p></div><p class="support-muted">A score change does not prove that an intervention caused the change. Consider dates, context and other factors.</p>`;
  }
  function supportRenderMood(){
    const store=readSupportStore(),entries=Array.isArray(store.moods)?store.moods:[];
    $("supportMoodHistory").innerHTML=entries.slice(-6).reverse().map(x=>`<span>${x.emoji} ${escapeHTML(x.date)}</span>`).join("");
    const pattern=$("supportMoodPattern");
    if(entries.length<2){pattern.textContent="Your check-ins are voluntary and are not included in academic risk estimates. Add a few entries to see a simple reflection.";return}
    const last=entries.slice(-3),average=last.reduce((sum,x)=>sum+Number(x.value),0)/last.length;
    if(average<=2)pattern.textContent="Your recent check-ins have been on the lower side. Consider talking with someone you trust or asking for a private mentor check-in. This is not a diagnosis.";
    else if(average>=4)pattern.textContent="Your recent check-ins have been more positive. Notice which routines or support may be helping.";
    else pattern.textContent="Your recent check-ins vary. Consider what kind of support or routine feels useful.";
  }
  function supportRenderPage(){
    if(!$("page-support"))return;
    supportStudentOptions();
    const student=currentSupportStudent();
    if($("supportStudentSelect").value!==String(student?.id??""))$("supportStudentSelect").value=student?String(student.id):"";
    supportRenderSnapshot(student);
    supportRenderEarlySignals(student);
    supportRenderTrendHistory(student);
    supportRenderExplanation(student);
    supportRenderPlan(student);
    supportRenderRecommendations(student);
    supportRenderFollowups(student);
    supportRenderRiskComparison(student);
    supportRenderMood();
    const autoEnabled=$("supportAutoRunEnabled")?.checked!==false;
    const pageVisible=$("page-support").classList.contains("active");
    if(pageVisible&&student&&autoEnabled&&!supportCycleRunning&&!supportAutoCycleCompleted.has(String(student.id))){
      supportAutoCycleCompleted.add(String(student.id));
      window.setTimeout(()=>supportRunAiCycle({automatic:true}),120);
    }
  }
  async function supportRunAssessment(options={}){
    const student=currentSupportStudent();
    if(!student){if(!options.quiet)toast("Choose a student first.","error");return null}
    const button=$("supportRunAssessment");
    button.disabled=true;button.textContent="Assessing…";
    try{
      const result=await performAssessment(student.id);
      state.risks[student.id]??=[];
      state.risks[student.id].unshift(result);
      if(state.demo)saveDemo();
      renderOverview();renderExecutiveDashboard();renderStudents();renderAiAdminPage();supportRenderPage();
      supportSetStage(2);
      if(!options.quiet)toast("Assessment saved. Review the explanation with the student.");
      return result;
    }catch(error){
      if(!options.quiet)toast(error.message||"Assessment failed.","error");
      const status=$("supportAiCycleStatus");
      if(status&&options.quiet){status.classList.add("is-error");status.querySelector("span").textContent=error.message||"Assessment failed."}
      return null;
    }finally{button.disabled=false;button.textContent="Run / refresh assessment ↗"}
  }
  function supportSetAiCycleStatus(message,kind=""){
    const status=$("supportAiCycleStatus");
    if(!status)return;
    status.className=`support-auto-run-status${kind?` ${kind}`:""}`;
    status.querySelector("span").textContent=message;
  }
  function supportChooseAutomaticIntervention(student){
    const available=state.interventions||[];
    const preferred=[];
    if(Number(student.attendance)<75)preferred.push(/attendance/i);
    if(Number(student.internalMarks)<55||Number(student.previousFailures)>0)preferred.push(/academic|mentor|tutor|subject/i);
    if(Number(student.assignmentsCompleted)<75)preferred.push(/assignment|peer|catch/i);
    for(const matcher of preferred){
      const match=available.find(item=>matcher.test(String(item.name||item.title||"")));
      if(match)return match;
    }
    return available[0]||null;
  }
  function supportLocalDatePlusDays(days){
    const date=new Date();date.setDate(date.getDate()+days);
    const offset=date.getTimezoneOffset();
    return new Date(date.getTime()-offset*60000).toISOString().slice(0,10);
  }
  async function supportRunAiCycle(options={}){
    const student=currentSupportStudent();
    if(!student){supportSetAiCycleStatus("Choose a student before running the AI support cycle.","is-error");return}
    if(supportCycleRunning)return;
    supportCycleRunning=true;
    const button=$("supportRunAiCycle");
    if(button){button.disabled=true;button.textContent="AI Mentor is reviewing…"}
    supportSetAiCycleStatus(`Reviewing ${student.fullName}: checking available student values and the latest evidence…`, "is-working");
    supportSetStage(1);
    try{
      const assessment=await supportRunAssessment({quiet:true});
      if(!assessment){supportSetAiCycleStatus("The assessment could not be completed. Check the FastAPI connection and try again.","is-error");return}
      supportSetStage(2);
      supportRenderEarlySignals(student);
      supportRenderTrendHistory(student);
      supportRenderExplanation(student);
      const plan=supportBuildPlan(student);
      const recommendation=supportChooseAutomaticIntervention(student);
      supportSelectedIntervention=recommendation;
      supportRenderRecommendations(student);
      supportRenderPlan(student);
      const risk=latestRisk(student.id);
      const contributors=assessment.modelEngine
        ?(assessment.observedSignals||[]).map(item=>String(item))
        :(Array.isArray(risk?.parts)?risk.parts:parseExplanation(risk?.explanation||""))
          .filter(item=>Number(item[1])>0)
          .map(item=>`${item[0]} (+${item[1]})`);
      const evidence=[
        `Attendance: ${Number(student.attendance||0).toFixed(1)}%`,
        `Internal marks: ${Number(student.internalMarks||0).toFixed(1)}%`,
        `Assignments completed: ${Number(student.assignmentsCompleted||0).toFixed(1)}%`,
        `Previous failures: ${Number(student.previousFailures||0)}`,
        `Recorded absences: ${Number(student.absences||0)}`
      ];
      const trend=supportGetTrends(student.id)[0];
      if(trend)evidence.push(`Latest dated trend snapshot: ${trend.subject}, ${trend.previousMark}% to ${trend.latestMark}%`);
      const contributorSummary=contributors.length?`${assessment.modelEngine?"Model-observed signals":"Baseline indicator contributions"}: ${contributors.join(", ")}`:"No elevated signals were recorded.";
      const observation=`AI-generated review brief (prototype): ${evidence.join("; ")}. ${contributorSummary} These are recorded indicators, not explanations of cause. Ask the student about their own perspective and any relevant context before deciding on support.`;
      const weeklyTarget=plan.targets[0];
      const interventionName=recommendation?.name||"Mentor-led learning check-in";
      const recommendedAction=recommendation?.description||"Discuss the student's priorities and agree one realistic support step.";
      $("supportSelectedRecommendation").textContent=`AI-selected draft: ${interventionName}. Review and adjust with the student before saving.`;
      $("supportMentorObservation").value=observation;
      $("supportMentorAction").value=`${interventionName} — ${recommendedAction}`;
      $("supportMentorWeeklyTarget").value=weeklyTarget?`${weeklyTarget[0]}: ${weeklyTarget[1]}`:"Agree one manageable weekly learning goal with the student.";
      $("supportMentorFollowupDate").value=supportLocalDatePlusDays(7);
      const profile=getAccountProfile();
      if(profile?.role==="Mentor"&&profile.fullName&&!$("supportMentorName").value.trim())$("supportMentorName").value=profile.fullName;
      supportSetStage(3);
      const store=readSupportStore();store.automationRuns??=[];
      store.automationRuns.unshift({id:String(Date.now()),studentId:student.id,studentName:student.fullName,assessmentId:assessment.id,score:assessment.riskScore,band:assessment.riskBand,recommendation:interventionName,createdAt:new Date().toISOString(),status:"Awaiting mentor review"});
      store.automationRuns=store.automationRuns.slice(0,100);writeSupportStore(store);
      const source=state.demo?"local demonstration rules":assessment.modelEngine?"connected scikit-learn Random Forest prototype":"connected FastAPI rule-based baseline";
      supportSetAiCycleStatus(`Automated review complete for ${student.fullName}: ${assessment.riskBand} (${assessment.riskScore}/100). Explanation, ${interventionName} and a weekly target have been drafted using ${source}. Mentor approval is still required before action or student contact.`);
      if(!options.automatic)toast("AI support cycle completed. Review the drafted action before saving.");
    }finally{
      supportCycleRunning=false;
      if(button){button.disabled=false;button.innerHTML='Run complete AI cycle <span>✦</span>'}
    }
  }
  async function supportSaveTrend(event){
    event.preventDefault();
    const student=currentSupportStudent();
    if(!student){toast("Choose a student before saving a trend snapshot.","error");return}
    const subject=$("supportTrendSubject").value.trim();
    const previousMark=Number($("supportTrendPreviousMark").value);
    const latestMark=Number($("supportTrendLatestMark").value);
    const previousAttendance=$("supportTrendPreviousAttendance").value.trim();
    const previousRecordDate=$("supportTrendPreviousDate").value;
    const latestRecordDate=$("supportTrendLatestDate").value;
    const consecutiveAbsences=Number($("supportTrendAbsences").value||0);
    const repeatedFailures=Number($("supportTrendFailures").value||0);
    if(!subject||!previousRecordDate||!latestRecordDate||!Number.isFinite(previousMark)||!Number.isFinite(latestMark)||previousMark<0||previousMark>100||latestMark<0||latestMark>100){
      toast("Enter a subject, two real result dates and valid marks between 0 and 100.","error");return;
    }
    if(previousRecordDate>=latestRecordDate){toast("The previous result date must be earlier than the latest result date.","error");return}
    if(previousAttendance!==""&&(Number(previousAttendance)<0||Number(previousAttendance)>100)){
      toast("Previous attendance must be between 0 and 100.","error");return;
    }
    const trend={id:Date.now(),subject,previousMark,latestMark,previousAttendance,consecutiveAbsences,repeatedFailures,previousRecordDate,latestRecordDate,recordedAt:new Date().toISOString()};
    try{
      if(state.demo){
        const store=readSupportStore();store.trends??={};const key=String(student.id);store.trends[key]??=[];
        store.trends[key].unshift(trend);store.trends[key]=store.trends[key].slice(0,20);writeSupportStore(store);
      }else{
        const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
        await request(`/api/students/${student.id}/academic-trends`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,previousRecordDate,latestRecordDate,previousMark,latestMark,previousAttendance:previousAttendance===""?null:Number(previousAttendance),consecutiveAbsences,repeatedFailures,reference:id})});
        const records=await request(`/api/students/${student.id}/academic-records`);
        state.academicTrends[String(student.id)]=mapSupportTrendsFromRecords(records);
      }
      $("supportTrendForm").reset();$("supportTrendAbsences").value=0;$("supportTrendFailures").value=0;
      supportRenderEarlySignals(student);supportRenderTrendHistory(student);
      toast(state.demo?"Dated trend snapshot saved in this browser.":"Dated academic snapshots saved to the backend.");
    }catch(error){toast(error.message||"Could not save the dated academic trend.","error")}
  }
  function supportSelectChoice(event){
    const btn=event.target.closest("[data-support-choice]");
    if(btn){
      const chosen=state.interventions.find((x,i)=>String(x.id??i)===String(btn.dataset.supportChoice));
      if(!chosen)return;
      supportSelectedIntervention=chosen;
      $("supportSelectedRecommendation").textContent=`Selected support: ${chosen.name}`;
      $("supportMentorAction").value=`${chosen.name} — `;
      supportSetStage(3);
      return;
    }
    const target=event.target.closest("[data-support-target]");
    if(target){
      $("supportMentorWeeklyTarget").value=target.dataset.supportTarget;
      supportSetStage(3);
    }
  }
  async function supportSaveMentorAction(event){
    event.preventDefault();
    const student=currentSupportStudent();
    if(!student){toast("Choose a student first.","error");return}
    const mentorName=$("supportMentorName").value.trim();
    const observation=$("supportMentorObservation").value.trim();
    const action=$("supportMentorAction").value.trim();
    const weeklyTarget=$("supportMentorWeeklyTarget").value.trim();
    const date=$("supportMentorFollowupDate").value;
    if(!mentorName||!observation||!action||!date){toast("Complete mentor name, conversation, action and follow-up date.","error");return}
    if(new Date(date+"T23:59:59")<new Date()){toast("Choose a follow-up date that is today or later.","error");return}
    const payload={mentorName,observation,actionTaken:action,weeklyTarget,followUpDate:`${date}T09:00:00`};
    try{
      if(state.demo){
        state.feedback.unshift({id:Date.now(),studentId:Number(student.id),...payload,createdAt:new Date().toISOString(),followUpStatus:"Scheduled"});
        saveDemo();
      }else{
        const saved=await request(`/api/students/${student.id}/feedback`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        state.feedback.unshift({...saved,studentName:student.fullName});
      }
      if(state.demo){
        const store=readSupportStore();store.followups??=[];
        store.followups.unshift({id:String(Date.now()),studentId:student.id,studentName:student.fullName,action,weeklyTarget,followUpDate:date,status:"Scheduled",createdAt:new Date().toISOString()});
        writeSupportStore(store);
      }
      $("supportMentorObservation").value="";$("supportMentorAction").value="";$("supportMentorWeeklyTarget").value="";$("supportMentorFollowupDate").value="";
      supportSelectedIntervention=null;
      await renderFeedback();
      supportRenderFollowups(student);supportRenderRecommendations(student);
      supportSetStage(4);
      toast("Mentor action recorded and follow-up scheduled.");
    }catch(error){toast(error.message||"Could not save mentor action.","error")}
  }
  async function supportSaveFollowupOutcome(event){
    event.preventDefault();
    const id=$("supportFollowupSelect").value;
    if(!id){toast("Choose a scheduled follow-up first.","error");return}
    const status=$("supportFollowupOutcome").value;
    const outcome=$("supportFollowupOutcomeNote").value.trim();
    try{
      if(state.demo){
        const store=readSupportStore();const item=store.followups.find(x=>String(x.id)===String(id));
        if(!item){toast("That follow-up could not be found.","error");return}
        item.status=status;item.outcome=outcome;item.completedAt=new Date().toISOString();writeSupportStore(store);
      }else{
        const item=state.feedback.find(x=>String(x.id)===String(id));
        if(!item){toast("That follow-up could not be found. Refresh the page and try again.","error");return}
        const updated=await request(`/api/students/${item.studentId}/feedback/${item.id}/outcome`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,outcomeNote:outcome})});
        state.feedback=state.feedback.map(x=>String(x.id)===String(updated.id)?{...updated,studentName:item.studentName}:x);
      }
      $("supportFollowupOutcomeNote").value="";
      supportRenderFollowups(currentSupportStudent());
      supportSetStage(5);
      toast(state.demo?"Follow-up outcome saved in this browser.":"Follow-up outcome saved to the backend.");
    }catch(error){toast(error.message||"Could not save follow-up outcome.","error")}
  }
  function supportSaveMood(event){
    event.preventDefault();
    const selected=document.querySelector('input[name="supportMood"]:checked');
    if(!selected){toast("Choose a mood before saving.","error");return}
    const value=Number(selected.value),emoji=({1:"😟",2:"😕",3:"😐",4:"🙂",5:"😊"})[value];
    const store=readSupportStore();store.moods??=[];
    // Deliberately do not persist the optional text note; only the selected mood and date are saved locally.
    store.moods.push({value,emoji,date:new Date().toLocaleDateString(undefined,{month:"short",day:"numeric"})});
    store.moods=store.moods.slice(-30);writeSupportStore(store);
    $("supportMoodForm").reset();supportRenderMood();
    toast("Voluntary mood check-in saved in this browser.");
  }
  function supportCallTrustedContact(event){
    event.preventDefault();
    const name=$("supportTrustedName").value.trim();
    const phone=$("supportTrustedPhone").value.trim().replace(/[^\d+]/g,"");
    if(name.length<2||!/^\+?\d{7,15}$/.test(phone)){toast("Enter a contact name and valid phone number.","error");return}
    // Explicit user action only: opens the device dialler.
    window.location.href=`tel:${phone}`;
  }
  function supportHumanGuidance(){
    $("supportHumanHelpGuidance").classList.add("show");
    $("supportHumanHelpGuidance").textContent="This frontend prototype cannot notify or connect a trained responder. Please contact your institution's trained counsellor, mentor or designated safeguarding person directly. If there is immediate danger, contact local emergency services now.";
  }


  /* =========================================================
     AI ADMIN CONSOLE
     The AI is represented as a platform capability, not a human
     login. The console displays all existing student values and
     supports manual human interpretation without overwriting
     model outputs or making consequential decisions automatically.
     ========================================================= */
  const aiAdminReviewKey="shikshasetu-ai-admin-manual-reviews-v1";
  let aiAdminSelectedId=null;

  function readAiAdminReviews(){
    if(!state.demo)return Array.isArray(state.aiAdminReviews)?state.aiAdminReviews:[];
    try{
      const saved=JSON.parse(localStorage.getItem(aiAdminReviewKey)||"[]");
      return Array.isArray(saved)?saved:[];
    }catch{return []}
  }
  function saveAiAdminReviews(items){
    try{localStorage.setItem(aiAdminReviewKey,JSON.stringify(items))}
    catch{toast("Browser storage is unavailable; the manual interpretation was not saved.","error")}
  }
  function aiAdminStudent(id){return state.students.find(s=>String(s.id)===String(id))||null}
  function aiAdminLatestReview(studentId){
    return readAiAdminReviews().filter(x=>String(x.studentId)===String(studentId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0]||null;
  }
  function aiAdminRenderOptions(){
    const options=state.students.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.fullName)} · ${escapeHTML(s.studentCode)}</option>`).join("");
    ["aiAdminStudentSelect","aiAdminInterpretStudent"].forEach(id=>{
      const el=$(id);if(!el)return;
      const current=el.value;
      el.innerHTML='<option value="">Choose a student</option>'+options;
      if(current&&state.students.some(s=>String(s.id)===String(current)))el.value=current;
    });
    if(!aiAdminSelectedId&&state.students.length)aiAdminSelectedId=state.students[0].id;
    if(aiAdminSelectedId&&state.students.some(s=>String(s.id)===String(aiAdminSelectedId))){
      $("aiAdminStudentSelect").value=String(aiAdminSelectedId);
      $("aiAdminInterpretStudent").value=String(aiAdminSelectedId);
    }
  }
  function aiAdminRenderRegistry(){
    const body=$("aiAdminStudentRows");
    if(!state.students.length){
      body.innerHTML='<tr><td colspan="9" class="empty-cell">No student records are available. Add records in the Students section.</td></tr>';
      return;
    }
    body.innerHTML=state.students.map(student=>{
      const risk=latestRisk(student.id);
      const band=risk?.riskBand||"NONE";
      const score=risk?`${Number(risk.riskScore||0)}/100`:"—";
      return `<tr>
        <td><div class="student-cell"><div class="student-avatar">${escapeHTML(initials(student.fullName))}</div><div><b>${escapeHTML(student.fullName)}</b><small>${escapeHTML(student.studentCode||"No ID")}</small></div></div></td>
        <td>${Number(student.attendance||0).toFixed(1)}%</td>
        <td>${Number(student.internalMarks||0).toFixed(1)}%</td>
        <td>${Number(student.assignmentsCompleted||0).toFixed(1)}%</td>
        <td>${Number(student.previousFailures||0)}</td>
        <td>${Number(student.absences||0)}</td>
        <td><span class="band ${bandClass(band)}">${escapeHTML(score)} · ${escapeHTML(band==="NONE"?"Pending":band)}</span></td>
        <td>${escapeHTML(student.auditGroup||"—")}</td>
        <td><button type="button" class="row-action" data-ai-admin-select="${escapeHTML(student.id)}">Inspect</button></td>
      </tr>`;
    }).join("");
    $("aiAdminRegistryCount").textContent=`${state.students.length} record${state.students.length===1?"":"s"}`;
  }
  function aiAdminRenderInspector(){
    const student=aiAdminStudent(aiAdminSelectedId);
    const box=$("aiAdminValueInspector"),explain=$("aiAdminFeatureExplanation"),badge=$("aiAdminRiskBand");
    if(!student){
      box.innerHTML='<div class="empty-state">Select a student from the registry.</div>';
      explain.innerHTML='<div class="empty-state">Assessment contributors will appear here.</div>';
      badge.textContent="Not assessed";
      return;
    }
    const values=[
      ["Student ID",student.studentCode||"—"],
      ["Full name",student.fullName||"—"],
      ["Email",student.email||"Not supplied"],
      ["Attendance",`${Number(student.attendance||0).toFixed(1)}%`],
      ["Internal marks",`${Number(student.internalMarks||0).toFixed(1)}%`],
      ["Assignments completed",`${Number(student.assignmentsCompleted||0).toFixed(1)}%`],
      ["Previous course failures",String(Number(student.previousFailures||0))],
      ["Absence count",String(Number(student.absences||0))],
      ["Optional audit group",student.auditGroup||"Not supplied"]
    ];
    box.innerHTML=values.map(([label,value])=>`<div class="ai-admin-value"><span>${escapeHTML(label)}</span><b>${escapeHTML(value)}</b></div>`).join("");
    const risk=latestRisk(student.id);
    if(!risk){
      badge.textContent="Not assessed";
      badge.className="soft-pill";
      explain.innerHTML='<div class="empty-state">This student has no assessment snapshot yet. Use the Students page to run an assessment.</div>';
    }else{
      badge.textContent=`${bandLabel(risk.riskBand)} · ${risk.riskScore}/100`;
      badge.className=`band ${bandClass(risk.riskBand)}`;
      if(risk.modelEngine){
        const observed=Object.entries(risk.observedFeatures||{}).map(([key,value])=>`<div class="support-explain-row"><span>${escapeHTML(key.replaceAll("_"," "))}</span><b>${value==null?"Missing":escapeHTML(String(value))}</b></div>`).join("");
        const signals=(risk.observedSignals||[]).map(x=>`<div class="support-trend-item"><b>Observed signal</b><p>${escapeHTML(x)}</p></div>`).join("");
        explain.innerHTML=`<div class="support-trend-item"><b>${escapeHTML(risk.modelEngine)} · ${escapeHTML(risk.modelVersion||"")}</b><p>Estimated next-period deterioration probability: ${(Number(risk.deteriorationProbability||0)*100).toFixed(1)}%.</p></div><div class="support-explain-heading">Observed input values (not feature importance)</div>${observed}${signals}<p class="ai-admin-footnote">Assessment date: ${risk.assessedAt?escapeHTML(new Date(risk.assessedAt).toLocaleString()):"not supplied"}. This result does not explain causes; human interpretation is required.</p>`;
      }else{
        const parts=Array.isArray(risk.parts)?risk.parts:parseExplanation(risk.explanation||"");
        explain.innerHTML=(parts.length?parts:[["Explanation unavailable",0]]).map(part=>
          `<div class="support-explain-row"><span>${escapeHTML(part[0])}</span><b>${Number(part[1])>0?`+${Number(part[1])} points`:"No added points"}</b></div>`
        ).join("")+`<p class="ai-admin-footnote">Assessment date: ${risk.assessedAt?escapeHTML(new Date(risk.assessedAt).toLocaleString()):"not supplied"}. These are feature contributions from the current baseline; they do not establish causation.</p>`;
      }
    }
    const review=aiAdminLatestReview(student.id);
    $("aiAdminInterpretStudent").value=String(student.id);
    if(review){
      $("aiAdminReviewStatus").value=review.status||"Needs mentor context";
      $("aiAdminManualInterpretation").value=review.interpretation||"";
      $("aiAdminEvidence").value=review.evidence||"";
      $("aiAdminNextAction").value=review.nextAction||"";
    }else{
      $("aiAdminReviewStatus").value="Needs mentor context";
      $("aiAdminManualInterpretation").value="";
      $("aiAdminEvidence").value="";
      $("aiAdminNextAction").value="";
    }
  }
  function aiAdminRenderReviews(){
    const reviews=readAiAdminReviews().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $("aiAdminManual").textContent=reviews.length;
    $("aiAdminReviewCount").textContent=`${reviews.length} entr${reviews.length===1?"y":"ies"}`;
    const box=$("aiAdminReviewHistory");
    if(!reviews.length){
      box.innerHTML='<div class="empty-state">No manual interpretations saved yet. Select a student and add contextual review notes.</div>';
      return;
    }
    box.innerHTML=reviews.slice(0,12).map(item=>{
      const student=aiAdminStudent(item.studentId);
      return `<article class="ai-admin-review-entry">
        <div class="ai-admin-review-head"><div><b>${escapeHTML(student?.fullName||item.studentName||"Student record")}</b><small>${escapeHTML(item.createdAt?new Date(item.createdAt).toLocaleString():"Date unavailable")}</small></div><span class="soft-pill">${escapeHTML(item.status||"Needs mentor context")}</span></div>
        <p>${escapeHTML(item.interpretation)}</p>
        ${item.evidence?`<small><b>Evidence:</b> ${escapeHTML(item.evidence)}</small>`:""}
        ${item.nextAction?`<small><b>Next action:</b> ${escapeHTML(item.nextAction)}</small>`:""}
      </article>`;
    }).join("");
  }
  function renderAiAdminPage(){
    if(!$("page-ai-admin"))return;
    const reviews=readAiAdminReviews();
    const assessed=state.students.map(s=>latestRisk(s.id)).filter(Boolean);
    $("aiAdminTotal").textContent=state.students.length;
    $("aiAdminAssessed").textContent=assessed.length;
    $("aiAdminHigh").textContent=assessed.filter(r=>r.riskBand==="HIGH").length;
    const model=state.modelStatus;
    const trained=model?.status==="TRAINED_PROTOTYPE";
    $("aiAdminModelState").textContent=state.offline?"Server unavailable · no local student data":trained?`scikit-learn Random Forest · ${model.modelVersion||"trained prototype"}`:"Rule-based baseline active · ML model not trained";
    $("aiModelStateLabel").textContent=state.offline?"Server offline":trained?"Trained prototype":"Not trained";
    const supportNotice=$("supportAiNoticeCopy");
    if(supportNotice){
      supportNotice.innerHTML=state.demo
        ?"<b>Demo mode:</b> the local screening rules draft signals and support ideas. Connect FastAPI to use saved academic history, backend follow-ups and model training. Mentor review remains required."
        :trained
          ?"<b>scikit-learn Random Forest is connected.</b> The trained prototype estimates the defined next-period deterioration outcome; observed inputs are not causal explanations. Support drafts remain advisory and mentor review is required."
          :"<b>Rule-based baseline active; ML model not trained.</b> The backend stores dated academic snapshots and runs the transparent baseline until approved labelled longitudinal data trains the separate model. Mentor review remains required.";
    }
    const persistenceNote=$("aiAdminPersistenceNote");
    if(persistenceNote)persistenceNote.textContent=state.offline?"The server is unavailable. No student data is stored locally.":"Manual interpretations are stored in the backend with a separate snapshot of the related baseline assessment. They never overwrite student values or model outputs.";
    $("aiModelTrainingBadge").textContent=state.offline?"Server offline":trained?"Trained prototype":"Not trained";
    $("aiModelTrainingBadge").className=`soft-pill${trained?" model-ready":""}`;
    const portalProfile=(()=>{try{return JSON.parse(localStorage.getItem("shikshasetu-account-profile-v1")||"{}")}catch{return {}}})();
    const canTrainPlatformModel=portalProfile.role==="SUPER_ADMIN"&&!state.offline;
    $("aiModelTrainButton").disabled=!canTrainPlatformModel;
    $("aiModelTrainingFile").disabled=!canTrainPlatformModel;
    const modelBadge=$("modelStatus");
    if(modelBadge)modelBadge.querySelector("small").textContent=trained?"Trained prototype":"Baseline / untrained";
    const trainingStatus=$("aiModelTrainingStatus");
    if(trainingStatus && !trainingStatus.dataset.busy){
      trainingStatus.textContent=state.offline?"Connect the FastAPI backend to inspect the institutional academic model.":trained?`Model ${model.modelVersion} loaded. Trained ${model.trainedAt?new Date(model.trainedAt).toLocaleString():"date unavailable"}. Predictions use the separate ML assessment endpoint.`:"No trained model artifact is installed. The old transparent baseline remains available until approved labelled data is uploaded.";
    }
    const metricBox=$("aiModelMetrics");
    if(metricBox){
      const m=model?.metrics;
      metricBox.innerHTML=m?`<div class="ai-model-metrics-grid">${[["Rows",m.totalRows],["Students",m.uniqueStudents],["Accuracy",`${(Number(m.accuracy)*100).toFixed(1)}%`],["Precision",`${(Number(m.precision)*100).toFixed(1)}%`],["Recall",`${(Number(m.recall)*100).toFixed(1)}%`],["F1",`${(Number(m.f1)*100).toFixed(1)}%`],["ROC AUC",Number(m.rocAuc).toFixed(3)],["Holdout",m.testRows]].map(([k,v])=>`<div><small>${escapeHTML(k)}</small><b>${escapeHTML(String(v))}</b></div>`).join("")}</div><p class="ai-admin-footnote">${escapeHTML(m.validationMethod||"Grouped holdout; further temporal validation required.")}</p>`:'<div class="empty-state">No training metrics available yet.</div>';
    }
    aiAdminRenderOptions();
    aiAdminRenderRegistry();
    aiAdminRenderInspector();
    aiAdminRenderReviews();
    const activity=$("aiAdminActivity");
    const latest=reviews[0];
    if(latest){
      const student=aiAdminStudent(latest.studentId);
      activity.innerHTML=`<div class="ai-admin-activity-item"><b>Manual interpretation saved</b><span>${escapeHTML(student?.fullName||"Student")} · ${escapeHTML(latest.status||"Review pending")}</span><small>${escapeHTML(new Date(latest.createdAt).toLocaleString())}</small></div>`;
    }else{
      activity.innerHTML=`<div class="ai-admin-activity-item"><b>${assessed.length} assessment snapshot(s)</b><span>${state.students.length} student record(s) available</span><small>${state.offline?"Server unavailable — no local data substituted":"Using institution-scoped backend data"}</small></div>`;
    }
  }
  async function aiModelTrainingSubmit(event){
    event.preventDefault();
    if(state.offline){toast("The backend must be online before uploading a training dataset.","error");return}
    const file=$("aiModelTrainingFile").files?.[0];
    if(!file){toast("Choose an approved labelled CSV first.","error");return}
    if(!file.name.toLowerCase().endsWith(".csv")){toast("The model trainer currently accepts CSV files only.","error");return}
    const button=$("aiModelTrainButton"),status=$("aiModelTrainingStatus");
    button.disabled=true;button.textContent="Training…";status.dataset.busy="1";status.textContent="Validating columns, grouping students, evaluating the holdout set and fitting the model…";
    try{
      const form=new FormData();form.append("file",file);
      const result=await request("/api/ai/model/train",{method:"POST",body:form});
      state.modelStatus=await request("/api/ai/model/status");
      status.textContent=`Training finished: ${result.status} · ${result.modelVersion}. Human review and later-term validation are still required.`;
      delete status.dataset.busy;
      renderAiAdminPage();
      toast("Model artifact saved and loaded. It is a research prototype, not production-approved.");
    }catch(error){
      status.textContent=error.message||"Model training failed. Check the CSV schema and backend log.";
      delete status.dataset.busy;
      toast(status.textContent,"error");
    }finally{
      button.disabled=portalProfile.role!=="SUPER_ADMIN"||state.offline;button.textContent=portalProfile.role==="SUPER_ADMIN"?"Train / replace model":"Platform Super Admin only";
    }
  }
  function aiAdminSelectStudent(id){
    aiAdminSelectedId=id||null;
    $("aiAdminStudentSelect").value=String(aiAdminSelectedId||"");
    $("aiAdminInterpretStudent").value=String(aiAdminSelectedId||"");
    aiAdminRenderInspector();
  }
  async function aiAdminSaveInterpretation(event){
    event.preventDefault();
    const student=aiAdminStudent($("aiAdminInterpretStudent").value);
    const interpretation=$("aiAdminManualInterpretation").value.trim();
    const payload={reviewStatus:$("aiAdminReviewStatus").value,interpretation,evidence:$("aiAdminEvidence").value.trim(),nextAction:$("aiAdminNextAction").value.trim()};
    if(!student){toast("Choose a student before saving an interpretation.","error");return}
    if(interpretation.length<12){toast("Please add a little more context to the manual interpretation.","error");return}
    try{
      let saved;
      if(state.demo){
        const items=readAiAdminReviews();
        saved={id:String(Date.now()),studentId:student.id,studentName:student.fullName,status:payload.reviewStatus,...payload,createdAt:new Date().toISOString(),modelScore:latestRisk(student.id)?.riskScore??null,modelBand:latestRisk(student.id)?.riskBand??"NOT_ASSESSED"};
        items.unshift(saved);saveAiAdminReviews(items.slice(0,250));
      }else{
        const raw=await request(`/api/ai-admin/students/${student.id}/interpretations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        saved=mapManualInterpretation(raw);state.aiAdminReviews.unshift(saved);
      }
      aiAdminSelectedId=student.id;
      aiAdminRenderReviews();
      $("aiAdminActivity").innerHTML=`<div class="ai-admin-activity-item"><b>Manual interpretation saved</b><span>${escapeHTML(student.fullName)} · ${escapeHTML(payload.reviewStatus)}</span><small>Just now · Original assessment snapshot preserved</small></div>`;
      toast(state.demo?"Manual interpretation saved locally.":"Manual interpretation saved to the backend. The original AI estimate was not changed.");
    }catch(error){toast(error.message||"Could not save manual interpretation.","error")}
  }
  function aiAdminClearInterpretation(){
    $("aiAdminManualInterpretation").value="";
    $("aiAdminEvidence").value="";
    $("aiAdminNextAction").value="";
    $("aiAdminReviewStatus").value="Needs mentor context";
  }

  /* =========================================================
     STUDENT CHATBOT UI
     Server-backed student companion UI. Student messages are sent
     to the authenticated campus chat endpoint; no browser history is persisted.
     ========================================================= */
  function studentChatAppend(role,message){
    const container=$("studentAiChatMessages");
    const article=document.createElement("article");
    article.className=`chat-message ${role}`;
    const avatar=document.createElement("span");
    avatar.className="chat-avatar";
    avatar.textContent=role==="assistant"?"✦":"You";
    const body=document.createElement("div");
    const title=document.createElement("b");
    title.textContent=role==="assistant"?getAiMentorName():"You";
    const text=document.createElement("p");
    text.textContent=message;
    const time=document.createElement("small");
    time.textContent="Just now";
    body.append(title,text,time);
    article.append(avatar,body);
    container.append(article);
    container.scrollTop=container.scrollHeight;
  }
  // Local, privacy-conscious conversational helpers. No external AI API or keys required.
  const mentorChatMemoryKey="shikshasetu-mentor-chat-v2";
  let mentorChatHistory=[];
  let mentorChatContext="";
  function mentorSaveHistory(){
    try{sessionStorage.setItem(mentorChatMemoryKey,JSON.stringify({context:mentorChatContext,history:mentorChatHistory.slice(-36)}));}catch{}
  }
  function mentorReadHistory(){
    try{
      const saved=JSON.parse(sessionStorage.getItem(mentorChatMemoryKey)||"null");
      mentorChatContext=String(saved?.context||"");
      mentorChatHistory=Array.isArray(saved?.history)?saved.history.filter(x=>["user","assistant"].includes(x.role)&&typeof x.message==="string").slice(-36):[];
    }catch{mentorChatHistory=[];}
  }
  function mentorProgress(student){
    if(!student)return null;
    const all=window.ShikshaSetuProgress||{};
    const rows=all[String(student.id)];
    return Array.isArray(rows)&&rows.length?rows:null;
  }
  function mentorProgressReply(student){
    if(!student)return "Choose a student in the Student context menu to see their saved progress tracker updates. You can still ask me for general study advice.";
    const rows=mentorProgress(student);
    if(!rows)return `There are no saved progress tracker updates for ${student.fullName} in the institutional database yet. Record attendance, assignments, problems solved and study hours in the progress tracker to begin.`;
    const current=rows[0],prior=rows[1];
    const pct=Number(current.Attendance);
    const done=Number(current.AssignmentsDone),total=Number(current.AssignmentsTotal);
    const problems=Number(current.Problems),hours=Number(current.Hours);
    let reply=`Latest progress check-in for ${student.fullName}: attendance ${pct}%, assignments ${done}/${total}, problems solved ${problems}, and ${hours} study hours this week.`;
    if(prior){
      const change=problems-Number(prior.Problems);
      const attendanceChange=pct-Number(prior.Attendance);
      reply+=` Since the previous check-in: ${change>=0?"+":""}${change} problems and ${attendanceChange>=0?"+":""}${attendanceChange.toFixed(1)} percentage points in attendance.`;
    }
    if(current.note)reply+=` Reflection: ${current.note.slice(0,180)}.`;
    return reply+" These figures are self-reported check-ins stored in the institutional database, not independently verified.";
  }
  function mentorStudyPlan(student,q){
    const days=Number((q.match(/\b([1-7])\s*day(?:s)?\b/i)||[])[1]||7);
    const subject=(q.match(/\b(?:for|in)\s+(math(?:s|ematics)?|physics|chemistry|english|java|python|biology|history|economics)\b/i)||[])[1];
    const topic=subject?` for ${subject}`:"";
    const needsAssignment=student&&Number(student.assignmentsCompleted)<75;
    const needsAttendance=student&&Number(student.attendance)<75;
    const steps=[
      `Day 1: List the topics${topic} and choose one achievable goal.`,
      "Day 2: Learn one concept with a worked example; practise 3–5 questions.",
      "Day 3: Review mistakes and ask a teacher about anything unclear.",
      "Day 4: Practise another topic and explain it in your own words.",
      "Day 5: Complete one short assignment milestone.",
      "Day 6: Do a short self-quiz and revisit difficult questions.",
      "Day 7: Review progress, rest and plan the next week."
    ];
    let plan=`Here is a flexible ${days}-day study plan${topic}:\n${steps.slice(0,days).join("\n")}`;
    if(needsAssignment)plan+="\nYour record suggests prioritizing a manageable assignment milestone.";
    if(needsAttendance)plan+="\nAlso discuss any attendance barriers with a mentor.";
    return plan+"\nKeep sessions manageable and take breaks. Tell me your subject and available time if you want a more specific plan.";
  }
  function mentorMath(question){
    const match=question.match(/(?:calculate|what is|solve|evaluate)\s+(-?\d+(?:\.\d+)?)\s*([+\-*\/×÷])\s*(-?\d+(?:\.\d+)?)/i);
    if(!match)return null;
    const a=Number(match[1]),b=Number(match[3]),op=match[2];
    if((op==="/"||op==="÷")&&b===0)return "Division by zero is undefined.";
    const answer=op==="+"?a+b:op==="-"?a-b:op==="*"||op==="×"?a*b:a/b;
    return `${a} ${op} ${b} = ${Number(answer.toPrecision(12))}. ${op==="+"?"Add the two values.":op==="-"?"Subtract the second value from the first.":op==="*"||op==="×"?"Multiply the two values.":"Divide the first value by the second."}`;
  }
  function mentorEnhancedReply(question){
    const q=question.toLowerCase().trim();
    const student=state.students.find(s=>String(s.id)===String($("studentChatContext")?.value));
    if(/\b(progress|tracker|problems solved|study hours|improvement timeline|how am i doing|my improvement)\b/.test(q))return mentorProgressReply(student);
    if(/\b(study plan|schedule|timetable|revision plan|daily routine|weekly plan)\b/.test(q))return mentorStudyPlan(student,q);
    if(/\b(motivat|overwhelm|stress|anxious|worried|frustrat|discourag)\b/.test(q))return "It can help to choose just one small task, take a short break and speak with a trusted teacher or adult about what feels difficult. Your academic results do not define your worth. Would you like a simple study plan or help breaking down an assignment?";
    if(/\b(pomodoro|focus|concentrat|procrastinat|distraction)\b/.test(q))return "Try a 20–25 minute focus session: choose one task, put distractions aside, work on that task, then take a 5-minute break. Repeat only as comfortable, and check what you understood rather than counting hours alone.";
    if(/\b(exam prep|exam preparation|revision|memor|test preparation)\b/.test(q))return "For exam revision: 1) list topics, 2) mark the ones you find difficult, 3) review one worked example, 4) practise without looking at the answer, 5) check mistakes, and 6) revisit the topic later. Tell me the subject and exam date for a more tailored plan.";
    if(/\b(percentage|percent)\b/.test(q)){
      const m=q.match(/(?:what is|calculate|find)\s+(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/);
      if(m)return `${m[1]}% of ${m[2]} = (${m[1]} ÷ 100) × ${m[2]} = ${Number((Number(m[1])/100*Number(m[2])).toPrecision(12))}.`;
    }
    const math=mentorMath(question);if(math)return math;
    if(/\b(what can you do|capabilities|features|help topics)\b/.test(q))return "I can explain attendance, marks and assessment signals; summarize saved progress check-ins; suggest study and assignment plans; explain basic arithmetic; and share focus and revision techniques. This is a local rules-based assistant, not a connected generative AI model.";
    if(/\b(thank|thanks)\b/.test(q))return "You're welcome! You can ask about your next study goal, progress tracker or an assignment plan.";
    if(/\b(what did i ask|previous question|last question)\b/.test(q)){
      const previous=mentorChatHistory.filter(x=>x.role==="user");
      return previous.length>1?`Your previous question was: "${previous[previous.length-2].message.slice(0,180)}"`:"I don't have an earlier question in this chat session yet.";
    }
    return null;
  }
  function studentChatResponse(question){
    const enhanced=mentorEnhancedReply(question);
    if(enhanced)return enhanced;
    const q=question.toLowerCase();
    const id=$("studentChatContext")?.value;
    const student=state.students.find(s=>String(s.id)===String(id));
    if(/\b(hello|hi|hey|good morning|good evening)\b/.test(q)){
      return `Hello! I’m ${getAiMentorName()}, your ShikshaSetu AI Mentor. I’m here to help you think through your learning goals. You can ask about attendance, marks, assignments, your assessment explanation or a realistic weekly plan.`;
    }
    if(!student){
      if(/\b(attendance|absen|present|absent)\b/.test(q)){
        return "A useful first step is to look at attendance across several weeks, then identify practical barriers without assuming their cause. You and your mentor can agree on one realistic attendance goal and review it at the next check-in.";
      }
      if(/\b(mark|grade|score|academic|subject|exam)\b/.test(q)){
        return "Start by identifying the subject or topic that feels most difficult. Break it into smaller concepts, use a worked example, practise a few questions and ask a mentor for feedback. This preview cannot see personal marks unless a student context is selected.";
      }
      if(/\b(assignment|homework|pending|submission)\b/.test(q)){
        return "Try listing pending assignments by due date, then split the next assignment into small steps. Set one achievable milestone for today and ask a mentor or peer to review the work if you get stuck.";
      }
      if(/\b(risk|assessment|band|why|explain)\b/.test(q)){
        return "An assessment estimate is a prompt for a supportive conversation, not a diagnosis or permanent label. Select a student context to see the explanation for a particular demo assessment.";
      }
      if(/\b(plan|improv|study|week|goal|support|help|next step)\b/.test(q)){
        return "A balanced starter plan could be: two short focused study sessions, one small assignment milestone, a quick attendance check and a mentor conversation about any barriers. Keep the goals realistic and adjust them with the student.";
      }
      return "I can discuss study routines, attendance, assignments, academic progress and supportive next steps. Select a student context for a response based on the current demo record. This chat is a frontend prototype; the connected AI language model will be added later.";
    }
    if(/\b(attendance|absen|present|absent)\b/.test(q)){
      return `${student.fullName}'s current attendance value in this workspace is ${Number(student.attendance||0).toFixed(1)}%. This number alone does not explain the reason for absences. A useful next step is to discuss any barriers and agree on a realistic plan with a mentor.`;
    }
    if(/\b(mark|grade|score|academic|subject|exam)\b/.test(q)){
      return `${student.fullName}'s recorded internal marks are ${Number(student.internalMarks||0).toFixed(1)}%, with ${Number(student.previousFailures||0)} previous course failure(s) recorded. The current record does not contain detailed topic-level results, so ask the student which subjects or concepts feel difficult before choosing support.`;
    }
    if(/\b(assignment|homework|pending|submission)\b/.test(q)){
      return `The current record shows ${Number(student.assignmentsCompleted||0).toFixed(1)}% assignment completion for ${student.fullName}. You could break pending work into smaller milestones, agree on one achievable task for this week and review progress together.`;
    }
    if(/\b(risk|assessment|band|why|explain)\b/.test(q)){
      const risk=latestRisk(student.id);
      if(!risk)return `There is no assessment snapshot for ${student.fullName} yet. The Students page can run an assessment. An estimate is a prompt for supportive review—not a diagnosis, a cause or a permanent label.`;
      const parts=Array.isArray(risk.parts)?risk.parts:parseExplanation(risk.explanation||"");
      const contributors=parts.filter(p=>Number(p[1])>0).map(p=>`${p[0]} (+${p[1]})`).join(", ")||"No elevated contributors in the current baseline";
      return `The latest baseline estimate for ${student.fullName} is ${risk.riskScore}/100 (${bandLabel(risk.riskBand)}). The recorded contributors are: ${contributors}. These values describe the current rule-based estimate only. They do not prove why a student is experiencing difficulty.`;
    }
    if(/\b(plan|improv|study|week|goal|support|help|next step)\b/.test(q)){
      const ideas=[];
      if(student.attendance<75)ideas.push("discuss one attendance barrier and set a manageable attendance goal");
      if(student.internalMarks<55||student.previousFailures>0)ideas.push("choose one subject topic for two short guided practice sessions");
      if(student.assignmentsCompleted<75)ideas.push("split one pending assignment into two small milestones");
      if(!ideas.length)ideas.push("choose one extension goal and review it at the next mentor check-in");
      return `A possible plan for ${student.fullName} is to ${ideas.join("; then ")}. Please agree the goal with the student and adapt it to their circumstances. This is a demo suggestion, not a trained model output.`;
    }
    return "Thanks for sharing that. I can respond to a few demonstration topics using the selected workspace record: attendance, internal marks, assignments, assessment explanations and weekly study planning. For a fuller conversation, the ShikshaSetu language model and secure student context will be connected in the next development phase.";
  }
  async function studentChatSend(event){
    event.preventDefault();
    const input=$("studentAiChatInput"),button=$("studentAiChatSend");
    const message=input.value.trim(); if(!message)return;
    if(getAccountProfile()?.chatMonitoringConsent===false){studentChatAppend("assistant","Chat companion access is paused because chatbot monitoring consent is off. Open My profile to review or re-enable the institutional privacy setting.");return;}
    studentChatAppend("user",message); input.value=""; button.disabled=true;
    try{
      const result=await request("/api/chat/interactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});
      studentChatAppend("assistant",result.reply||"I’m here with you. Let’s take the next step together.");
      loadStudentChatAnalytics();
    }catch(error){studentChatAppend("assistant",`I could not reach the secure campus companion just now. Your message was not saved. Please try again when the connection is restored. (${error.message||"connection error"})`);}
    finally{button.disabled=false;}
  }
  function studentChatClear(){
    mentorChatHistory=[];mentorChatContext=$("studentChatContext")?.value||"";
    try{sessionStorage.removeItem(mentorChatMemoryKey);}catch{}
    $("studentAiChatMessages").innerHTML=`<article class="chat-message assistant"><span class="chat-avatar">✦</span><div><b>${escapeHTML(getAiMentorName())}</b><p>Hello again. I’m ${escapeHTML(getAiMentorName())}, your learning companion. Share what is on your mind or ask about a class topic, assignment or study plan. We can work through one manageable step at a time. Your messages are processed by the institutional companion under the privacy notice.</p><small>Just now</small></div></article>`;
  }
  const accountProfileKey="shikshasetu-account-profile-v1";
  function getAccountProfile(){
    if(state.accountProfile)return state.accountProfile;
    try{state.accountProfile=JSON.parse(localStorage.getItem(accountProfileKey)||"null")}catch{state.accountProfile=null}
    return state.accountProfile;
  }
  function getAiMentorName(){return getAccountProfile()?.aiMentorName||"ShikshaSetu AI"}
  function applyAiMentorName(){
    const name=getAiMentorName();
    const heading=$("studentAiChatName");if(heading)heading.textContent=`${name} · AI Mentor`;
    const greeting=$("studentAiChatGreetingName");if(greeting)greeting.textContent=name;
    const toolbar=document.querySelector(".student-ai-chat-toolbar b");if(toolbar)toolbar.textContent=name;
  }
  function openAccountSetup(){
    const profile=getAccountProfile();
    const consentLabel=$("accountChatMonitoringConsent")?.closest("label");
    if(consentLabel)consentLabel.hidden=profile?.role!=="STUDENT";
    if(profile){
      $("accountFullName").value=profile.fullName||"";
      $("accountEmail").value=profile.email||"";
      $("accountAge").value=profile.age||"";
      $("accountRole").value=profile.role||"Student";
      $("aiMentorDisplayName").value=profile.aiMentorName||"";
      $("accountChatMonitoringConsent").checked=profile.chatMonitoringConsent!==false;
    }
    $("accountSetupMessage").textContent="";$("accountSetupMessage").className="account-setup-message";
    openModal("accountSetupModal");
  }
  async function saveAccountProfile(event){
    event.preventDefault();
    const fullName=$("accountFullName").value.trim();
    const aiMentorName=$("aiMentorDisplayName").value.trim();
    if(fullName.length<2||aiMentorName.length<2){const message=$("accountSetupMessage");message.textContent="Enter a valid name and AI Mentor name.";message.className="account-setup-message show";return;}
    try{
      const updated=await request("/api/auth/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({fullName,aiMentorName})});
      let privacy={chatMonitoringConsent:updated.chatMonitoringConsent};
      if(getAccountProfile()?.role==="STUDENT"){privacy=await request("/api/my/privacy-consent",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({chatMonitoringConsent:$("accountChatMonitoringConsent").checked})});}
      const profile={...getAccountProfile(),...updated,...privacy,updatedAt:new Date().toISOString()};
      localStorage.setItem(accountProfileKey,JSON.stringify(profile));state.accountProfile=profile;
      applyAiMentorName();const profileName=document.querySelector(".profile-mini strong"),profileMeta=document.querySelector(".profile-mini small");
      if(profileName)profileName.textContent=updated.fullName;if(profileMeta)profileMeta.textContent=`${updated.role} · ${updated.institutionName} · AI Mentor: ${updated.aiMentorName}`;
      const message=$("accountSetupMessage");message.textContent="Your profile has been updated in the institutional database.";message.className="account-setup-message show";toast("Account profile updated.");window.setTimeout(closeModals,700);
    }catch(error){const message=$("accountSetupMessage");message.textContent=`Profile was not saved: ${error.message}`;message.className="account-setup-message show";}
  }
  async function loadStudentChatAnalytics(){
    const panel=$("studentChatAnalytics");if(!panel)return;const profile=getAccountProfile();if(profile?.role!=="STUDENT"){panel.hidden=true;const note=$("studentChatAnalyticsNote");if(note)note.hidden=true;return;}
    try{const data=await request("/api/chat/my-analytics");$("studentChatCount").textContent=data.interactionCount;$("studentChatActiveDays").textContent=data.activeDays;$("studentChatTopics").textContent=data.distinctTopics;$("studentChatActivityBand").textContent=String(data.activityBand||"INSUFFICIENT_COHORT_DATA").replaceAll("_"," ").toLowerCase();const note=$("studentChatAnalyticsNote");if(note)note.textContent=`Last 30 days: ${(Object.entries(data.topics||{}).map(([topic,count])=>`${topic.toLowerCase().replaceAll("_"," ")} (${count})`).join(" · "))||"no topics yet"}. ${data.notice}`;}catch(error){const note=$("studentChatAnalyticsNote");if(note)note.textContent="Your usage summary is unavailable while the institutional server is offline.";}
  }
  function initStudentChat(){
    if(!$("studentAiChatForm"))return;
    try{sessionStorage.removeItem(mentorChatMemoryKey);}catch{}
    mentorChatHistory=[];mentorChatContext=$("studentChatContext")?.value||"";
    $("studentChatContext")?.addEventListener("change",()=>studentChatClear());
    $("studentAiChatForm").addEventListener("submit",studentChatSend);
    $("studentAiChatInput").addEventListener("keydown",event=>{
      if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("studentAiChatForm").requestSubmit()}
    });
    $("studentAiChatClear").addEventListener("click",studentChatClear);
    loadStudentChatAnalytics();
    document.querySelectorAll("[data-chat-prompt]").forEach(button=>{
      button.addEventListener("click",()=>{
        $("studentAiChatInput").value=button.dataset.chatPrompt;
        $("studentAiChatForm").requestSubmit();
      });
    });
  }


  /* =========================================================
     EXECUTIVE DASHBOARD — additive page, powered by existing state.
     It does not replace or alter the existing Overview renderer.
     ========================================================= */
  function renderExecutiveDashboard(){
    if(!$('edashTotal')) return;
    const c=counts();
    const avg=(key)=>state.students.length?state.students.reduce((sum,s)=>sum+Number(s[key]||0),0)/state.students.length:0;
    $('edashTotal').textContent=c.total;
    $('edashAssessed').textContent=c.assessed;
    $('edashHigh').textContent=c.high;
    $('edashAttendance').textContent=state.students.length?`${avg('attendance').toFixed(1)}%`:'—';
    $('edashDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    $('edashUpdated').textContent=state.offline?'Server unavailable — local data is not substituted':`Updated ${new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
    const total=Math.max(c.assessed,1);
    const bandRows=[['Higher support',c.high,'high'],['Watch list',c.medium,'medium'],['On track',c.low,'low']];
    $('edashRiskDistribution').innerHTML=bandRows.map(([label,value,cls])=>
      `<div class="edash-risk-row ${cls}"><span>${label}</span><div class="edash-risk-track"><span style="width:${Math.max(value?3:0,(value/total)*100)}%"></span></div><b>${value}</b></div>`
    ).join('')+`<small class="edash-updated">${c.assessed} of ${c.total} students have an assessment snapshot.</small>`;

    const signals=[];
    state.students.forEach(s=>{
      const r=latestRisk(s.id);
      if(s.attendance<75) signals.push({priority:s.attendance<60?3:2,title:`Attendance needs a conversation · ${s.fullName}`,detail:`Recorded attendance ${Number(s.attendance).toFixed(1)}%. Ask about barriers before choosing a support action.`});
      if(s.internalMarks<55||Number(s.previousFailures)>0) signals.push({priority:s.internalMarks<40?3:2,title:`Academic support may help · ${s.fullName}`,detail:`Internal marks ${Number(s.internalMarks).toFixed(1)}%; previous failures ${Number(s.previousFailures||0)}.`});
      if(s.assignmentsCompleted<75) signals.push({priority:2,title:`Assignment planning · ${s.fullName}`,detail:`Recorded assignment completion ${Number(s.assignmentsCompleted).toFixed(1)}%. Consider smaller milestones.`});
      if(r?.riskBand==='HIGH') signals.push({priority:4,title:`Higher support estimate · ${s.fullName}`,detail:`Latest baseline estimate ${r.riskScore}/100. Review feature contributors with the student.`});
    });
    signals.sort((a,b)=>b.priority-a.priority);
    $('edashInsightList').innerHTML=signals.length?signals.slice(0,5).map(x=>`<article class="edash-insight"><b>${escapeHTML(x.title)}</b><p>${escapeHTML(x.detail)}</p></article>`).join(''):'<div class="empty-state">No elevated prompts from the available fields. Continue routine supportive check-ins.</div>';

    const pulse=[['Attendance',avg('attendance')],['Internal marks',avg('internalMarks')],['Assignments',avg('assignmentsCompleted')]];
    $('edashLearningPulse').innerHTML=state.students.length?pulse.map(([label,value])=>`<div class="edash-pulse-row"><span>${label}</span><div class="edash-pulse-track"><span style="width:${Math.max(0,Math.min(100,value))}%"></span></div><b>${value.toFixed(1)}%</b></div>`).join(''):'<div class="empty-state">No student records are available.</div>';

    const ranked=[...state.students].map(s=>({s,r:latestRisk(s.id)})).sort((a,b)=>{
      const as=a.r?.riskScore??(a.s.attendance<60?35:0),bs=b.r?.riskScore??(b.s.attendance<60?35:0);
      return bs-as;
    }).slice(0,5);
    $('edashPriorityList').innerHTML=ranked.length?ranked.map(({s,r})=>`<div class="edash-priority-item"><div><b>${escapeHTML(s.fullName)}</b><small>${escapeHTML(s.studentCode||'No student ID')} · ${r?`${r.riskScore}/100 · ${bandLabel(r.riskBand)}`:'Not assessed'}</small></div><button type="button" data-detail="${s.id}">Review →</button></div>`).join(''):'<div class="empty-state">No student records are loaded.</div>';
  }

  function navigate(page){
    state.page=page;document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
    document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    const names={overview:"Overview",dashboard:"Dashboard",students:"Students",interventions:"Interventions",support:"AI Mentor Support Loop","ai-admin":"AI Admin Console",mentors:"Mentor feedback",fairness:"Fairness & audit"};
    $("crumbCurrent").textContent=names[page]||"Overview";$("sidebar").classList.remove("open");
    if(page==="fairness")loadFairness();if(page==="mentors")renderFeedback();if(page==="support")supportRenderPage();if(page==="ai-admin")renderAiAdminPage();if(page==="dashboard")renderExecutiveDashboard();window.scrollTo({top:0,behavior:"smooth"});
  }
  function openModal(id){$(id).classList.add("show");$(id).setAttribute("aria-hidden","false");document.body.style.overflow="hidden"}
  function closeModals(){document.querySelectorAll(".modal-backdrop").forEach(m=>{m.classList.remove("show");m.setAttribute("aria-hidden","true")});document.body.style.overflow=""}
  function resetStudentForm(){ $("studentForm").reset();$("editStudentId").value="";$("studentModalTitle").textContent="Add a student";$("previousFailures").value=0;$("absences").value=0 }
  function openStudentForm(s=null){
    resetStudentForm();
    if(s){$("studentModalTitle").textContent="Edit student";$("editStudentId").value=s.id;["studentCode","fullName","email","auditGroup","attendance","internalMarks","assignmentsCompleted","previousFailures","absences"].forEach(k=>$(k).value=s[k]??"")}
    openModal("studentModal");
  }
  async function saveStudent(e){
    e.preventDefault();
    const id=$("editStudentId").value;
    const payload={studentCode:$("studentCode").value.trim(),fullName:$("fullName").value.trim(),email:$("email").value.trim(),auditGroup:$("auditGroup").value.trim()||null,attendance:+$("attendance").value,internalMarks:+$("internalMarks").value,assignmentsCompleted:+$("assignmentsCompleted").value,previousFailures:+$("previousFailures").value,absences:+$("absences").value};
    try{
      if(state.demo){
        if(id){const i=state.students.findIndex(s=>s.id==id);state.students[i]={...state.students[i],...payload}}
        else{payload.id=Math.max(0,...state.students.map(s=>s.id))+1;state.students.push(payload)}
        saveDemo();
      }else{
        await request(id?`/api/students/${id}`:"/api/students",{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      }
      closeModals();toast(id?"Student updated":"Student added");await loadData();
    }catch(err){toast(err.message,"error")}
  }
  async function assessStudent(id){
    const student=state.students.find(x=>String(x.id)===String(id));if(!student)return;
    try{
      const result=await performAssessment(id);
      state.risks[id]??=[];state.risks[id].unshift(result);
      if(state.demo)saveDemo();
      toast("Assessment saved. Review the explanation with the student.");renderAll();openDetail(id);
    }catch(error){toast(error.message||"Assessment failed.","error")}
  }
  function openDetail(id){
    const s=state.students.find(x=>x.id==id);if(!s)return;
    const r=latestRisk(id);$("detailName").textContent=s.fullName;$("detailMeta").textContent=`${s.studentCode} · ${s.email||"No email recorded"}`;
    const parts=r?.parts||parseExplanation(r?.explanation||"");
    $("detailBody").innerHTML=`<div class="detail-top"><div class="detail-score">${r?`${r.riskScore}/100`:"—"}</div><div><span class="band ${bandClass(r?.riskBand)}">${bandLabel(r?.riskBand)}</span><p>${r?`Last assessed ${new Date(r.assessedAt).toLocaleString()}`:"No assessment yet. Run one to view the indicators."}</p></div></div>
      <div class="detail-section"><h3>Academic snapshot</h3><div class="explain-list"><div class="explain-item"><span>Attendance</span><b>${s.attendance}%</b></div><div class="explain-item"><span>Internal marks</span><b>${s.internalMarks}%</b></div><div class="explain-item"><span>Assignments completed</span><b>${s.assignmentsCompleted}%</b></div><div class="explain-item"><span>Previous failures</span><b>${s.previousFailures}</b></div><div class="explain-item"><span>Absences</span><b>${s.absences}</b></div></div></div>
      <div class="detail-section"><h3>Why this estimate?</h3>${r?`<div class="explain-list">${parts.map(p=>`<div class="explain-item"><span>${escapeHTML(p[0])}</span><b>${p[1]>0?`+${p[1]} points`:"No added points"}</b></div>`).join("")}</div><p class="fairness-table-note">${escapeHTML(r.explanation||"")}</p>`:'<p class="fairness-table-note">No estimate is available yet.</p>'}</div>
      <div class="detail-section"><h3>Risk history</h3><div class="explain-list">${(state.risks[id]||[]).slice(0,5).map(x=>`<div class="explain-item"><span>${new Date(x.assessedAt).toLocaleString()}</span><b>${x.riskScore}/100 · ${x.riskBand}</b></div>`).join("")||'<span class="fairness-table-note">No previous snapshots.</span>'}</div></div>
      <div class="detail-actions"><button class="primary-button" data-assess="${id}">↻ Run new assessment</button><button class="secondary-button" data-edit="${id}">Edit student</button><button class="secondary-button" data-feedback="${id}">Add mentor note</button></div>
      <p class="form-hint">This score is a supportive screening signal, not a diagnosis or permanent label. Discuss context with the student before choosing an intervention.</p>`;
    openModal("detailModal");
  }
  function parseExplanation(str){
    const out=[];const match=str.match(/contributions.*?:\s*(.*?)(?:\. Score|$)/i);
    if(match){match[1].split(";").forEach(x=>{const m=x.trim().match(/(.+?)\s+\+(\d+)/);if(m)out.push([m[1],+m[2]])})}
    return out.length?out:[["See explanation",0]];
  }
  async function saveFeedback(e){
    e.preventDefault();const studentId=$("feedbackStudent").value;
    const payload={mentorName:$("mentorName").value.trim(),observation:$("mentorObservation").value.trim(),actionTaken:$("mentorAction").value.trim(),followUpDate:$("followUpDate").value?new Date($("followUpDate").value).toISOString().slice(0,19):null};
    try{
      if(state.demo){state.feedback.unshift({id:Date.now(),studentId:+studentId,...payload,createdAt:new Date().toISOString()});saveDemo()}
      else await request(`/api/students/${studentId}/feedback`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      $("feedbackForm").reset();toast("Mentor feedback saved");await renderFeedback();
    }catch(err){toast(err.message,"error")}
  }
  async function importCsv(file){
    if(!file)return;
    if(state.demo){toast("CSV import requires the running FastAPI backend.","error");return}
    const fd=new FormData();fd.append("file",file);
    try{const result=await request("/api/import/students",{method:"POST",body:fd});toast(`Imported ${result.imported}; skipped ${result.skipped}`);await loadData()}
    catch(e){toast(e.message,"error")}
    $("csvInput").value="";
  }
  function toggleTheme(){
    if(window.ShikshaSetuTheme){
      window.ShikshaSetuTheme.toggle();
      return; // the shared theme-change event redraws the dashboard chart once
    }
    const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
    document.documentElement.dataset.theme=next;
    try{localStorage.setItem("shikshasetu-theme",next)}catch(_){}
    drawChart(counts().high,counts().medium,counts().low);
  }
  window.addEventListener("shikshasetu:themechange",()=>{
    const c=counts();
    if(typeof drawChart==="function") drawChart(c.high,c.medium,c.low);
  });
  const DEFAULT_GLASS_TRANSPARENCY = 28;
  const GLASS_TRANSPARENCY_KEY = "shikshasetu-glass-transparency";
  function applyGlassTransparency(value, persist=true){
    const range=$("glassRange");
    const output=$("glassValue");
    const transparency=Math.min(85,Math.max(15,Math.round(Number(value)||DEFAULT_GLASS_TRANSPARENCY)));
    // The slider expresses transparency. CSS alpha expresses the remaining fill opacity.
    const opacity=Number((1-transparency/100).toFixed(2));
    const root=document.documentElement;
    root.style.setProperty("--glass-alpha",String(opacity));
    root.dataset.glassTransparency=String(transparency);
    if(range)range.value=String(transparency);
    if(output){
      output.textContent=`${transparency}% transparent · ${Math.round(opacity*100)}% glass fill`;
      output.value=output.textContent;
    }
    if(persist){
      try{
        localStorage.setItem(GLASS_TRANSPARENCY_KEY,String(transparency));
        // Keep the former opacity key in sync for compatibility with older builds.
        localStorage.setItem("shikshasetu-glass",String(opacity));
      }catch(error){toast("The glass setting changed, but browser storage is unavailable.","error")}
    }
  }
  function initAppearance(){
    const theme=localStorage.getItem("shikshasetu-theme");
    if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme;

    let transparency=DEFAULT_GLASS_TRANSPARENCY;
    const savedTransparency=localStorage.getItem(GLASS_TRANSPARENCY_KEY);
    if(savedTransparency!==null && Number.isFinite(Number(savedTransparency))){
      transparency=Number(savedTransparency);
    }else{
      // Older releases saved the fill opacity (e.g. .72), not transparency.
      const legacyOpacity=localStorage.getItem("shikshasetu-glass");
      if(legacyOpacity!==null && Number.isFinite(Number(legacyOpacity))){
        transparency=Math.round((1-Math.min(.85,Math.max(.15,Number(legacyOpacity))))*100);
      }
    }
    applyGlassTransparency(transparency,false);

    $("glowToggle").checked=localStorage.getItem("shikshasetu-glow")!=="false";
    document.body.classList.toggle("no-glow",!$("glowToggle").checked);
  }
  // AI Mentor Support Loop events — added alongside existing dashboard handlers.
  $("supportStudentSelect").addEventListener("change",e=>{
    supportSelectedStudentId=e.target.value||null;
    supportSelectedIntervention=null;
    $("supportSelectedRecommendation").textContent="No support option selected.";
    supportRenderPage();
  });
  $("supportRunAssessment").addEventListener("click",()=>supportRunAssessment());
  $("supportRunAiCycle").addEventListener("click",()=>supportRunAiCycle({automatic:false}));
  $("supportAutoRunEnabled").addEventListener("change",event=>{
    if(event.target.checked){supportAutoCycleCompleted.delete(String(supportSelectedStudentId));supportRenderPage()}
    else supportSetAiCycleStatus("Automatic run is paused. Use Run complete AI cycle whenever you are ready.");
  });
  $("supportTrendForm").addEventListener("submit",supportSaveTrend);
  $("supportRecommendations").addEventListener("click",supportSelectChoice);
  $("supportWeeklyTargets").addEventListener("click",supportSelectChoice);
  $("supportMentorActionForm").addEventListener("submit",supportSaveMentorAction);
  $("supportFollowupOutcomeForm").addEventListener("submit",supportSaveFollowupOutcome);
  $("supportMoodForm").addEventListener("submit",supportSaveMood);
  $("supportTrustedContactForm").addEventListener("submit",supportCallTrustedContact);
  $("supportHumanHelpButton").addEventListener("click",supportHumanGuidance);

  // AI Admin and student chat controls.
  $("aiAdminStudentSelect").addEventListener("change",e=>aiAdminSelectStudent(e.target.value));
  $("aiAdminInterpretStudent").addEventListener("change",e=>aiAdminSelectStudent(e.target.value));
  $("aiAdminStudentRows").addEventListener("click",e=>{
    const button=e.target.closest("[data-ai-admin-select]");
    if(!button)return;
    aiAdminSelectStudent(button.dataset.aiAdminSelect);
    $("aiAdminStudentSelect").value=String(button.dataset.aiAdminSelect);
    $("aiAdminInterpretStudent").value=String(button.dataset.aiAdminSelect);
    $("aiAdminValueInspector").scrollIntoView({behavior:"smooth",block:"nearest"});
  });
  $("aiAdminInterpretationForm").addEventListener("submit",aiAdminSaveInterpretation);
  $("aiModelTrainingForm").addEventListener("submit",aiModelTrainingSubmit);
  $("aiAdminClearForm").addEventListener("click",aiAdminClearInterpretation);
  initStudentChat();
  $("accountSetupButton").addEventListener("click",openAccountSetup);
  $("accountSetupForm").addEventListener("submit",saveAccountProfile);
  applyAiMentorName();
  if(getAccountProfile())$("accountSetupButton").textContent="♙ My account";

  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-page]");if(nav)navigate(nav.dataset.page);
    const go=e.target.closest("[data-go]");if(go)navigate(go.dataset.go);
    const detail=e.target.closest("[data-detail]");if(detail)openDetail(+detail.dataset.detail);
    const close=e.target.closest("[data-close-modal]");if(close)closeModals();
    const assess=e.target.closest("[data-assess]");if(assess){closeModals();assessStudent(+assess.dataset.assess)}
    const edit=e.target.closest("[data-edit]");if(edit){return;}
    const fb=e.target.closest("[data-feedback]");if(fb){closeModals();navigate("mentors");$("feedbackStudent").value=fb.dataset.feedback}
  });
  document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModals()}));
  $("addStudentButton").addEventListener("click",()=>openStudentForm());$("addStudentTop").addEventListener("click",()=>openStudentForm());$("quickAdd").addEventListener("click",()=>openStudentForm());
  $("studentForm").addEventListener("submit",saveStudent);$("feedbackForm").addEventListener("submit",saveFeedback);
  $("studentSearch").addEventListener("input",renderStudents);$("riskFilter").addEventListener("change",renderStudents);
  $("refreshStudents").addEventListener("click",loadData);$("csvInput").addEventListener("change",e=>importCsv(e.target.files[0]));
  $("themeToggle").addEventListener("click",toggleTheme);$("appearanceTheme").addEventListener("click",toggleTheme);
  $("settingsButton").addEventListener("click",()=>openModal("appearanceModal"));
  $("glassRange").addEventListener("input",e=>applyGlassTransparency(e.target.value,true));
  $("glassRange").addEventListener("change",e=>applyGlassTransparency(e.target.value,true));
  $("glassReset").addEventListener("click",()=>applyGlassTransparency(DEFAULT_GLASS_TRANSPARENCY,true));
  $("glowToggle").addEventListener("change",e=>{document.body.classList.toggle("no-glow",!e.target.checked);localStorage.setItem("shikshasetu-glow",e.target.checked)});
  $("runFairness").addEventListener("click",loadFairness);$("menuButton").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
  window.addEventListener("resize",()=>{const c=counts();drawChart(c.high,c.medium,c.low);renderExecutiveDashboard()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModals()});
  $("todayDate").textContent=new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  initAppearance();loadData();window.addEventListener("focus",loadData);window.setInterval(loadData,60000);
});
