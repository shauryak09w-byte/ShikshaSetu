package com.shikshasetu.portal;
import com.shikshasetu.model.PortalSession; import com.shikshasetu.model.PortalUser;
public record PortalPrincipal(PortalUser user, PortalSession session) {
 public Long userId(){return user.getId();} public Long institutionId(){return user.getInstitutionId();}
 public Long studentId(){return user.getStudentId();} public String role(){return user.getRole();}
 public boolean isSuperAdmin(){return "SUPER_ADMIN".equals(role());}
 public boolean isInstitutionAdmin(){return "INSTITUTION_ADMIN".equals(role())||isSuperAdmin();}
 public boolean isStudent(){return "STUDENT".equals(role());}
}
