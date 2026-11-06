package com.shikshasetu.controller;

import com.shikshasetu.model.AcademicRecord;
import com.shikshasetu.repo.AcademicRecordRepository;
import com.shikshasetu.repo.StudentRepository;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/students/{studentId}/academic-records")
public class AcademicRecordController {

    private final StudentRepository students;
    private final AcademicRecordRepository records;

    public AcademicRecordController(StudentRepository students, AcademicRecordRepository records) {
        this.students = students;
        this.records = records;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<AcademicRecord> list(@PathVariable Long studentId) {
        requireStudent(studentId);
        return records.findByStudentIdOrderByRecordDateDescIdDesc(studentId);
    }

    @PostMapping
    @Transactional
    public AcademicRecord create(
        @PathVariable Long studentId,
        @Valid @RequestBody AcademicRecord body
    ) {
        requireStudent(studentId);

        boolean hasMarks = body.getMarksObtained() != null || body.getMaxMarks() != null;
        if (hasMarks && (body.getMarksObtained() == null || body.getMaxMarks() == null)) {
            throw new IllegalArgumentException("Provide both marksObtained and maxMarks, or leave both empty");
        }
        if (hasMarks && body.getMarksObtained() > body.getMaxMarks()) {
            throw new IllegalArgumentException("Marks obtained cannot exceed maximum marks");
        }
        if (body.getAttendancePercent() == null
            && body.getMarksObtained() == null
            && body.getConsecutiveAbsences() == null
            && body.getAbsenceCount() == null
            && body.getRepeatedFailures() == null) {
            throw new IllegalArgumentException("A record must include marks, attendance, or absence information");
        }

        body.setId(null);
        body.setStudentId(studentId);
        return records.save(body);
    }

    @DeleteMapping("/{recordId}")
    @Transactional
    public Map<String, String> delete(
        @PathVariable Long studentId,
        @PathVariable Long recordId
    ) {
        requireStudent(studentId);
        AcademicRecord record = records.findById(recordId)
            .orElseThrow(() -> new NoSuchElementException("Academic record not found"));
        if (!record.getStudentId().equals(studentId)) {
            throw new NoSuchElementException("Academic record not found for this student");
        }
        records.delete(record);
        return Map.of("message", "Academic record deleted");
    }

    private void requireStudent(Long id) {
        if (!students.existsById(id)) {
            throw new NoSuchElementException("Student not found");
        }
    }
}
