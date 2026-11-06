package com.shikshasetu.controller;

import com.shikshasetu.model.*;
import com.shikshasetu.portal.*;
import com.shikshasetu.repo.*;
import com.shikshasetu.service.PortalAuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;

@RestController @RequestMapping("/api/auth")
public class AuthController {
 private final PortalUserRepository users; private final InstitutionRepository institutions; private final PortalSessionRepository sessions; private final PortalAuditService audit; private final StudentRepository students;
 @Value("${shikshasetu.auth.session-hours:8}") private int sessionHours;
 private static final SecureRandom RANDOM=new SecureRandom();
 public AuthController(PortalUserRepository u,InstitutionRepository i,PortalSessionRepository s,PortalAuditService a,StudentRepository students){users=u;institutions=i;sessions=s;audit=a;this.students=students;}
 public record RegisterRequest(@NotBlank @Size(max=120) String fullName,@Email @NotBlank @Size(max=180) String email,@NotBlank @Size(min=10,max=128) String password,@NotNull @Min(13) @Max(100) Integer age,@NotBlank @Size(min=2,max=32) String aiMentorName,@NotBlank @Size(max=20) String institutionCode,boolean privacyNoticeAccepted,boolean chatMonitoringConsent){}
 public record LoginRequest(@Email @NotBlank @Size(max=180) String email,@NotBlank @Size(max=128) String password){}
 public record ProfileUpdateRequest(@NotBlank @Size(min=2,max=120) String fullName,@NotBlank @Size(min=2,max=32) String aiMentorName){}
 @PostMapping("/register") @Transactional
 public Map<String,Object> register(@Valid @RequestBody RegisterRequest r){
  String email=r.email().trim().toLowerCase(Locale.ROOT); if(users.findByEmailIgnoreCase(email).isPresent())throw new ResponseStatusException(HttpStatus.CONFLICT,"An account already exists for this email");
  if(!r.privacyNoticeAccepted())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Please acknowledge the institutional privacy notice");
  Institution institution=institutions.findByAccessCodeIgnoreCaseAndActiveTrue(r.institutionCode().trim()).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Institution code not found or institution is inactive"));if(!institution.isEnrollmentOpen())throw new ResponseStatusException(HttpStatus.FORBIDDEN,"This institution is not accepting new enrollment requests at the moment");
  PortalUser u=new PortalUser();u.setEmail(email);u.setFullName(r.fullName().trim());u.setPasswordHash(PortalPasswordHasher.hash(r.password()));u.setRole("STUDENT");u.setAccountStatus("PENDING");u.setInstitutionId(institution.getId());u.setAge(r.age());u.setAiMentorName(r.aiMentorName().trim());u.setChatMonitoringConsent(r.chatMonitoringConsent());if(r.chatMonitoringConsent())u.setConsentAt(LocalDateTime.now());users.save(u);
  audit.recordFor(institution.getId(),u.getId(),"STUDENT_ENROLLMENT_REQUEST",u.getId(),"Student requested workspace access");
  return Map.of("status","PENDING","message","Your request was sent to "+institution.getName()+". You can sign in after an institution administrator approves it.");
 }
 @PostMapping("/login") @Transactional
 public Map<String,Object> login(@Valid @RequestBody LoginRequest r){
  PortalUser u=users.findByEmailIgnoreCase(r.email().trim().toLowerCase(Locale.ROOT)).orElseThrow(()->new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Email or password is incorrect"));
  if(!PortalPasswordHasher.matches(r.password(),u.getPasswordHash()))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Email or password is incorrect");
  if(!"ACTIVE".equals(u.getAccountStatus())){String msg="REJECTED".equals(u.getAccountStatus())?"Your enrollment request was not approved. Contact your institution administrator.":"SUSPENDED".equals(u.getAccountStatus())?"Your account has been suspended. Contact your institution administrator.":"Your institution administrator has not approved your access request yet.";throw new ResponseStatusException(HttpStatus.FORBIDDEN,msg);}
  if(u.getInstitutionId()!=null&&institutions.findById(u.getInstitutionId()).filter(Institution::isActive).isEmpty())throw new ResponseStatusException(HttpStatus.FORBIDDEN,"This institution workspace is currently suspended.");
  String token=token();sessions.save(new PortalSession(u.getId(),sha256(token),LocalDateTime.now().plusHours(Math.max(1,Math.min(24,sessionHours)))));
  audit.recordFor(u.getInstitutionId(),u.getId(),"LOGIN",u.getId(),"Portal login successful");
  Institution inst=u.getInstitutionId()==null?null:institutions.findById(u.getInstitutionId()).orElse(null);if(u.getInstitutionId()!=null&&(inst==null||!inst.isActive()))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"This institution workspace is currently suspended.");
  Map<String,Object> profile=new LinkedHashMap<>();profile.put("userId",u.getId());profile.put("fullName",u.getFullName());profile.put("email",u.getEmail());profile.put("role",u.getRole());profile.put("status",u.getAccountStatus());profile.put("institutionId",u.getInstitutionId());profile.put("institutionName",inst==null?"ShikshaSetu Platform":inst.getName());profile.put("studentId",u.getStudentId());profile.put("aiMentorName",u.getAiMentorName());profile.put("age",u.getAge()==null?0:u.getAge());profile.put("chatMonitoringConsent",u.isChatMonitoringConsent());profile.put("consentAt",u.getConsentAt()==null?"":u.getConsentAt().toString());
  return Map.of("token",token,"expiresInHours",Math.max(1,Math.min(24,sessionHours)),"profile",profile);
 }
 @GetMapping("/me") public Map<String,Object> me(){PortalUser u=PortalAuthContext.require().user();Institution i=u.getInstitutionId()==null?null:institutions.findById(u.getInstitutionId()).orElse(null);Map<String,Object> profile=new LinkedHashMap<>();profile.put("userId",u.getId());profile.put("fullName",u.getFullName());profile.put("email",u.getEmail());profile.put("role",u.getRole());profile.put("institutionId",u.getInstitutionId()==null?0:u.getInstitutionId());profile.put("institutionName",i==null?"ShikshaSetu Platform":i.getName());profile.put("studentId",u.getStudentId()==null?0:u.getStudentId());profile.put("aiMentorName",u.getAiMentorName()==null?"ShikshaSetu AI":u.getAiMentorName());profile.put("age",u.getAge()==null?0:u.getAge());profile.put("chatMonitoringConsent",u.isChatMonitoringConsent());profile.put("consentAt",u.getConsentAt()==null?"":u.getConsentAt().toString());return profile;}

 @PutMapping("/profile") @Transactional public Map<String,Object> updateProfile(@Valid @RequestBody ProfileUpdateRequest r){PortalUser u=PortalAuthContext.require().user();u.setFullName(r.fullName().trim());u.setAiMentorName(r.aiMentorName().trim());users.save(u);if(u.getStudentId()!=null){Student s=students.findById(u.getStudentId()).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Student record not found"));s.setFullName(u.getFullName());students.save(s);}audit.record("PROFILE_UPDATED",u.getId(),"Account display profile updated");return me();}
 @PostMapping("/logout") @Transactional public Map<String,String> logout(){PortalPrincipal p=PortalAuthContext.require();p.session().revoke();sessions.save(p.session());audit.record("LOGOUT",p.userId(),"Portal logout");return Map.of("message","Signed out");}
 private static String token(){byte[] b=new byte[48];RANDOM.nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 private static String sha256(String s){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
}
