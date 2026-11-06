package com.shikshasetu.service;
import com.shikshasetu.model.PortalAuditLog; import com.shikshasetu.portal.PortalAuthContext; import com.shikshasetu.portal.PortalPrincipal; import com.shikshasetu.repo.PortalAuditLogRepository; import org.springframework.stereotype.Service;
@Service public class PortalAuditService {
 private final PortalAuditLogRepository logs; public PortalAuditService(PortalAuditLogRepository l){logs=l;}
 public void record(String action,Long subject,String details){PortalPrincipal p=PortalAuthContext.get();logs.save(new PortalAuditLog(p==null?null:p.institutionId(),p==null?null:p.userId(),action,subject,details));}
 public void recordFor(Long tenant,Long actor,String action,Long subject,String details){logs.save(new PortalAuditLog(tenant,actor,action,subject,details));}
}
