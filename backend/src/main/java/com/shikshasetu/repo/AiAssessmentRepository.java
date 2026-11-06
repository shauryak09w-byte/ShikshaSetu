package com.shikshasetu.repo;
import com.shikshasetu.model.AiAssessment;import org.springframework.data.jpa.repository.JpaRepository;import java.util.List;
public interface AiAssessmentRepository extends JpaRepository<AiAssessment,Long>{List<AiAssessment> findByStudentIdOrderByAssessedAtDesc(Long studentId);void deleteByStudentId(Long studentId);}
