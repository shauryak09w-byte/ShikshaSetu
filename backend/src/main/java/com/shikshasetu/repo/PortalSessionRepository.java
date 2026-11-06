package com.shikshasetu.repo;
import com.shikshasetu.model.PortalSession; import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface PortalSessionRepository extends JpaRepository<PortalSession,Long>{Optional<PortalSession> findByTokenHashAndRevokedAtIsNull(String hash); List<PortalSession> findByUserIdAndRevokedAtIsNull(Long userId);}
