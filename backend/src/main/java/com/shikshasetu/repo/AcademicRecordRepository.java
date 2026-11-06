package com.shikshasetu.repo;

import com.shikshasetu.model.AcademicRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AcademicRecordRepository extends JpaRepository<AcademicRecord, Long> {
    List<AcademicRecord> findByStudentIdOrderByRecordDateDescIdDesc(Long studentId);
    long countByStudentId(Long studentId);
    void deleteByStudentId(Long studentId);
}
