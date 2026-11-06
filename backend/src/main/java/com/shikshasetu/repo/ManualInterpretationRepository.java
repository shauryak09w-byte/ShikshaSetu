package com.shikshasetu.repo;

import com.shikshasetu.model.ManualInterpretation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ManualInterpretationRepository extends JpaRepository<ManualInterpretation, Long> {
    List<ManualInterpretation> findAllByOrderByCreatedAtDesc();
    List<ManualInterpretation> findByStudentIdOrderByCreatedAtDesc(Long studentId);
    long countByStudentId(Long studentId);
    void deleteByStudentId(Long studentId);
}
