package com.shikshasetu.controller;

import com.shikshasetu.dto.AcademicTrendRequest;
import com.shikshasetu.model.AcademicRecord;
import com.shikshasetu.repo.AcademicRecordRepository;
import com.shikshasetu.repo.StudentRepository;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

/** Persists a dated previous/latest subject pair atomically for the support loop. */
@RestController
@RequestMapping("/api/students/{studentId}/academic-trends")
public class AcademicTrendController {
    private final StudentRepository students;
    private final AcademicRecordRepository records;

    public AcademicTrendController(StudentRepository students, AcademicRecordRepository records) {
        this.students = students;
        this.records = records;
    }

    @PostMapping
    @Transactional
    public List<AcademicRecord> save(@PathVariable Long studentId, @Valid @RequestBody AcademicTrendRequest request) {
        if (!students.existsById(studentId)) throw new NoSuchElementException("Student not found");
        if (!request.previousRecordDate().isBefore(request.latestRecordDate())) {
            throw new IllegalArgumentException("The previous result date must be earlier than the latest result date");
        }
        if (request.latestRecordDate().isAfter(LocalDate.now())) {
            throw new IllegalArgumentException("The latest result date cannot be in the future");
        }
        String reference = (request.reference() == null || request.reference().isBlank())
            ? UUID.randomUUID().toString() : request.reference().trim();
        AcademicRecord previous = new AcademicRecord();
        previous.setStudentId(studentId);
        previous.setSubject(request.subject().trim());
        previous.setAssessmentName("ShikshaSetu Support Loop " + reference + " | PREVIOUS");
        previous.setRecordDate(request.previousRecordDate());
        previous.setMarksObtained(request.previousMark());
        previous.setMaxMarks(100.0);
        previous.setAttendancePercent(request.previousAttendance());
        previous.setNotes("Dated academic trend snapshot. Previous period; values supplied by an authorised platform user.");

        AcademicRecord latest = new AcademicRecord();
        latest.setStudentId(studentId);
        latest.setSubject(request.subject().trim());
        latest.setAssessmentName("ShikshaSetu Support Loop " + reference + " | LATEST");
        latest.setRecordDate(request.latestRecordDate());
        latest.setMarksObtained(request.latestMark());
        latest.setMaxMarks(100.0);
        latest.setConsecutiveAbsences(request.consecutiveAbsences());
        latest.setRepeatedFailures(request.repeatedFailures());
        latest.setNotes("Dated academic trend snapshot. Latest period; values supplied by an authorised platform user.");

        return records.saveAll(List.of(previous, latest));
    }
}
