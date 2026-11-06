package com.shikshasetu.repo;
import com.shikshasetu.model.StudentProgress; import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface StudentProgressRepository extends JpaRepository<StudentProgress,Long>{List<StudentProgress> findTop100ByStudentIdOrderByCreatedAtDesc(Long student); List<StudentProgress> findTop500ByInstitutionIdOrderByCreatedAtDesc(Long tenant); void deleteByStudentId(Long studentId);}
