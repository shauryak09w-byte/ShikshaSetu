package com.shikshasetu.repo;

import com.shikshasetu.model.Student;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.List;
import org.springframework.data.domain.Sort;

public interface StudentRepository extends JpaRepository<Student, Long> {
    Optional<Student> findByStudentCodeIgnoreCase(String studentCode);
    boolean existsByStudentCodeIgnoreCase(String studentCode);
    List<Student> findAllByInstitutionId(Long institutionId);
    List<Student> findAllByInstitutionId(Long institutionId, Sort sort);
    Optional<Student> findByInstitutionIdAndId(Long institutionId, Long id);
    List<Student> findAllByInstitutionIdIsNull();
}
