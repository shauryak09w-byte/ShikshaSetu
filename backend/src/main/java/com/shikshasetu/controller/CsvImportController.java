package com.shikshasetu.controller;

import com.shikshasetu.model.Student;
import com.shikshasetu.repo.StudentRepository;
import com.shikshasetu.portal.PortalAuthContext;
import org.apache.commons.csv.*;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStreamReader;
import java.io.Reader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api/import")
public class CsvImportController {

    private final StudentRepository students;

    public CsvImportController(StudentRepository students) {
        this.students = students;
    }

    @PostMapping(value = "/students", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> importStudents(@RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Upload a non-empty CSV file");
        }

        CSVFormat format = CSVFormat.DEFAULT.builder()
            .setHeader()
            .setSkipHeaderRecord(true)
            .setTrim(true)
            .setIgnoreEmptyLines(true)
            .build();

        int imported = 0;
        int skipped = 0;
        List<String> errors = new ArrayList<>();

        try (Reader reader = new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8);
             CSVParser parser = format.parse(reader)) {

            Set<String> required = Set.of(
                "student_code", "full_name", "attendance", "internal_marks",
                "assignments_completed", "previous_failures", "absences"
            );
            Set<String> headers = parser.getHeaderMap().keySet();
            if (!headers.containsAll(required)) {
                Set<String> missing = new TreeSet<>(required);
                missing.removeAll(headers);
                throw new IllegalArgumentException("CSV is missing required columns: " + String.join(", ", missing));
            }

            for (CSVRecord row : parser) {
                try {
                    String code = requiredValue(row, "student_code");
                    if (students.existsByStudentCodeIgnoreCase(code)) {
                        skipped++;
                        errors.add("Row " + row.getRecordNumber() + ": duplicate student_code " + code);
                        continue;
                    }

                    Student student = new Student();
                    student.setInstitutionId(PortalAuthContext.require().institutionId());
                    student.setStudentCode(code);
                    student.setFullName(requiredValue(row, "full_name"));
                    student.setEmail(optionalValue(row, "email"));
                    student.setAttendance(Double.parseDouble(requiredValue(row, "attendance")));
                    student.setInternalMarks(Double.parseDouble(requiredValue(row, "internal_marks")));
                    student.setAssignmentsCompleted(Double.parseDouble(requiredValue(row, "assignments_completed")));
                    student.setPreviousFailures(Integer.parseInt(requiredValue(row, "previous_failures")));
                    student.setAbsences(Integer.parseInt(requiredValue(row, "absences")));
                    student.setAuditGroup(optionalValue(row, "audit_group"));

                    validateImportStudent(student);
                    students.save(student);
                    imported++;
                } catch (Exception ex) {
                    skipped++;
                    errors.add("Row " + row.getRecordNumber() + ": " + safeMessage(ex));
                }
            }
        }

        return Map.of("imported", imported, "skipped", skipped, "errors", errors);
    }

    private String requiredValue(CSVRecord row, String header) {
        if (!row.isMapped(header) || row.get(header) == null || row.get(header).isBlank()) {
            throw new IllegalArgumentException("Missing value for " + header);
        }
        return row.get(header).trim();
    }

    private String optionalValue(CSVRecord row, String header) {
        return row.isMapped(header) ? row.get(header).trim() : null;
    }

    private void validateImportStudent(Student s) {
        if (s.getFullName().length() > 120) throw new IllegalArgumentException("full_name is too long");
        if (s.getStudentCode().length() > 30) throw new IllegalArgumentException("student_code is too long");
        if (s.getAttendance() < 0 || s.getAttendance() > 100) throw new IllegalArgumentException("attendance must be between 0 and 100");
        if (s.getInternalMarks() < 0 || s.getInternalMarks() > 100) throw new IllegalArgumentException("internal_marks must be between 0 and 100");
        if (s.getAssignmentsCompleted() < 0 || s.getAssignmentsCompleted() > 100) throw new IllegalArgumentException("assignments_completed must be between 0 and 100");
        if (s.getPreviousFailures() < 0 || s.getAbsences() < 0) throw new IllegalArgumentException("Failure and absence counts cannot be negative");
    }

    private String safeMessage(Exception exception) {
        return exception.getMessage() == null ? "Invalid data" : exception.getMessage();
    }
}
