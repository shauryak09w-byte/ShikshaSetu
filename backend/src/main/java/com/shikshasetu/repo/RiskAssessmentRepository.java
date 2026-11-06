package com.shikshasetu.repo;

import com.shikshasetu.model.RiskAssessment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RiskAssessmentRepository extends JpaRepository<RiskAssessment, Long> {
    List<RiskAssessment> findByStudentIdOrderByAssessedAtDesc(Long studentId);
    List<RiskAssessment> findAllByOrderByAssessedAtDesc();
    void deleteByStudentId(Long studentId);
}
