package com.shikshasetu.repo;
import com.shikshasetu.model.Institution; import org.springframework.data.jpa.repository.JpaRepository; import java.util.*;
public interface InstitutionRepository extends JpaRepository<Institution,Long>{Optional<Institution> findByAccessCodeIgnoreCaseAndActiveTrue(String code); List<Institution> findAllByOrderByNameAsc(); Optional<Institution> findByAccessCodeIgnoreCase(String code);}
