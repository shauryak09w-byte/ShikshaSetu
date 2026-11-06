package com.shikshasetu.repo;

import com.shikshasetu.model.MentorFeedback;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MentorFeedbackRepository extends JpaRepository<MentorFeedback, Long> {
    List<MentorFeedback> findByStudentIdOrderByCreatedAtDesc(Long studentId);
    long countByStudentId(Long studentId);
    void deleteByStudentId(Long studentId);
}
