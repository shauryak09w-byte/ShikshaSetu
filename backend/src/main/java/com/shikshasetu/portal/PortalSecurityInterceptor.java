package com.shikshasetu.portal;

import com.shikshasetu.model.PortalSession;
import com.shikshasetu.model.PortalUser;
import com.shikshasetu.repo.PortalSessionRepository;
import com.shikshasetu.repo.PortalUserRepository;
import com.shikshasetu.repo.StudentRepository;
import com.shikshasetu.repo.InstitutionRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class PortalSecurityInterceptor implements HandlerInterceptor {
 private final PortalSessionRepository sessions; private final PortalUserRepository users; private final StudentRepository students; private final InstitutionRepository institutions;
 private static final Pattern STUDENT_ROUTE=Pattern.compile("/api/(?:students|ai/students|ai-admin/students)/(\\d+)(?:/.*)?");
 public PortalSecurityInterceptor(PortalSessionRepository s,PortalUserRepository u,StudentRepository students,InstitutionRepository institutions){sessions=s;users=u;this.students=students;this.institutions=institutions;}
 @Override public boolean preHandle(HttpServletRequest req,HttpServletResponse res,Object handler)throws Exception{
  PortalAuthContext.clear();
  String path=req.getRequestURI(); if(!path.startsWith("/api/")||"OPTIONS".equalsIgnoreCase(req.getMethod())||path.equals("/api/health")||path.equals("/api/auth/login")||path.equals("/api/auth/register"))return true;
  String header=req.getHeader("Authorization"); if(header==null||!header.startsWith("Bearer ")){res.sendError(401,"Authentication required");return false;}
  String raw=header.substring(7).trim(); if(raw.length()<32){res.sendError(401,"Invalid session");return false;}
  PortalSession session=sessions.findByTokenHashAndRevokedAtIsNull(sha256(raw)).orElse(null);
  if(session==null||session.getExpiresAt().isBefore(LocalDateTime.now())){res.sendError(401,"Session expired. Please sign in again.");return false;}
  PortalUser user=users.findById(session.getUserId()).orElse(null);
  if(user==null||!"ACTIVE".equals(user.getAccountStatus())){res.sendError(403,"This account is not active");return false;}
  if(user.getInstitutionId()!=null && institutions.findById(user.getInstitutionId()).filter(com.shikshasetu.model.Institution::isActive).isEmpty()){res.sendError(403,"This institution workspace is suspended or unavailable");return false;}
  PortalPrincipal principal=new PortalPrincipal(user,session); PortalAuthContext.set(principal);
  if(!authorizePath(path,req.getMethod(),principal,res))return false;
  return true;
 }
 private boolean authorizePath(String path,String method,PortalPrincipal p,HttpServletResponse res)throws Exception{
  if(path.startsWith("/api/super-admin/")&&!p.isSuperAdmin())return forbidden(res);
  if(path.startsWith("/api/institution-admin/")&&!"INSTITUTION_ADMIN".equals(p.role()))return forbidden(res);
  if((path.startsWith("/api/ai-admin/")||path.startsWith("/api/dashboard")||path.startsWith("/api/fairness/")||path.startsWith("/api/import/"))&&!p.isInstitutionAdmin())return forbidden(res);
  if(path.startsWith("/api/import/")&&!"INSTITUTION_ADMIN".equals(p.role()))return forbidden(res);
  if(path.equals("/api/ai/model/train")&&!p.isSuperAdmin())return forbidden(res);
  if(path.startsWith("/api/my/")&&!p.isStudent())return forbidden(res);
  if(p.isStudent()&&path.equals("/api/students")&&!"GET".equalsIgnoreCase(method))return forbidden(res);
  if(p.isStudent()&&path.matches("/api/students/\\d+")&&!"GET".equalsIgnoreCase(method))return forbidden(res);
  if(p.isStudent()&&path.matches("/api/students/\\d+/(?:academic-records|academic-trends)(?:/.*)?")&&!("GET".equalsIgnoreCase(method)))return forbidden(res);
  if(p.isStudent()&&path.matches("/api/students/\\d+/assess")&&!("POST".equalsIgnoreCase(method)))return forbidden(res);
  if(p.isStudent()&&path.matches("/api/students/\\d+/feedback(?:/.*)?")&&!("GET".equalsIgnoreCase(method)))return forbidden(res);
  Matcher m=STUDENT_ROUTE.matcher(path);
  if(m.matches()){
   Long id=Long.valueOf(m.group(1)); var student=students.findById(id).orElse(null);
   if(student==null)return notFound(res);
   if(!p.isSuperAdmin()&&!java.util.Objects.equals(student.getInstitutionId(),p.institutionId()))return notFound(res);
   if(p.isStudent()&&!java.util.Objects.equals(id,p.studentId()))return notFound(res);
  }
  if(path.startsWith("/api/ai/model/train")&&!p.isSuperAdmin())return forbidden(res);
  return true;
 }
 private boolean forbidden(HttpServletResponse r)throws Exception{PortalAuthContext.clear();r.sendError(403,"Your role does not have permission to access this resource");return false;}
 private boolean notFound(HttpServletResponse r)throws Exception{PortalAuthContext.clear();r.sendError(404,"Record not found");return false;}
 private String sha256(String value)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
 @Override public void afterCompletion(HttpServletRequest req,HttpServletResponse res,Object handler,Exception ex){PortalAuthContext.clear();}
}
