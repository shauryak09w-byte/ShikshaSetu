package com.shikshasetu.repo;
import com.shikshasetu.model.PortalAuditLog; import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface PortalAuditLogRepository extends JpaRepository<PortalAuditLog,Long>{List<PortalAuditLog> findTop250ByInstitutionIdOrderByCreatedAtDesc(Long tenant);}
