package com.shikshasetu.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shikshasetu.dto.EarlyWarningView;
import com.shikshasetu.dto.RiskAssessmentView;
import com.shikshasetu.model.RiskAssessment;
import com.shikshasetu.model.Student;
import com.shikshasetu.repo.RiskAssessmentRepository;
import com.shikshasetu.repo.StudentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class RiskService {

    private final StudentRepository students;
    private final RiskAssessmentRepository risks;
    private final StudentTrendService trends;
    private final ObjectMapper objectMapper;

    public RiskService(
        StudentRepository students,
        RiskAssessmentRepository risks,
        StudentTrendService trends,
        ObjectMapper objectMapper
    ) {
        this.students = students;
        this.risks = risks;
        this.trends = trends;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public RiskAssessmentView assess(Long studentId) {
        Student student = students.findById(studentId)
            .orElseThrow(() -> new NoSuchElementException("Student not found"));

        Map<String, Integer> contributions = new LinkedHashMap<>();

        // Current profile indicators. Weights are transparent demo defaults.
        add(contributions, "Low attendance", student.getAttendance() < 60 ? 25 : student.getAttendance() < 75 ? 15 : 0);
        add(contributions, "Low internal marks", student.getInternalMarks() < 40 ? 20 : student.getInternalMarks() < 55 ? 12 : 0);
        add(contributions, "Incomplete assignments", student.getAssignmentsCompleted() < 50 ? 15 : student.getAssignmentsCompleted() < 75 ? 8 : 0);
        add(contributions, "Previous course failures", Math.min(15, student.getPreviousFailures() * 5));
        add(contributions, "Absence count", Math.min(10, student.getAbsences() * 2));

        // Longitudinal indicators are considered only when dated records exist.
        List<EarlyWarningView> warnings = trends.findWarnings(studentId);
        long gradeDrops = warnings.stream().filter(w -> "GRADE_DROP".equals(w.category())).count();
        long repeatFails = warnings.stream().filter(w ->
            "REPEATED_LOW_SUBJECT_PERFORMANCE".equals(w.category()) ||
            "REPEATED_FAILURE_COUNT".equals(w.category())
        ).count();
        boolean attendanceDecline = warnings.stream().anyMatch(w -> "ATTENDANCE_DECLINE".equals(w.category()));
        boolean consecutiveAbsences = warnings.stream().anyMatch(w -> "CONSECUTIVE_ABSENCES".equals(w.category()));

        add(contributions, "Recent subject mark drops", (int) Math.min(12, gradeDrops * 6));
        add(contributions, "Repeated low subject results", (int) Math.min(12, repeatFails * 6));
        add(contributions, "Declining attendance trend", attendanceDecline ? 8 : 0);
        add(contributions, "Consecutive absences", consecutiveAbsences ? 8 : 0);

        int rawScore = contributions.values().stream().mapToInt(Integer::intValue).sum();
        int score = Math.min(100, rawScore);
        String band = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

        List<List<Object>> parts = contributions.entrySet().stream()
            .map(entry -> List.<Object>of(entry.getKey(), entry.getValue()))
            .toList();

        String breakdown = contributions.entrySet().stream()
            .map(entry -> entry.getKey() + " +" + entry.getValue())
            .reduce((a, b) -> a + "; " + b)
            .orElse("No elevated indicators in the supplied records");

        String explanation = "Indicator contributions (points): " + breakdown
            + ". Score " + score + "/100 (raw points " + rawScore + "). "
            + "This is a transparent support-priority heuristic, not a validated AI prediction, diagnosis, or causal explanation. "
            + "Review the student's context with them before choosing support.";

        String partsJson;
        try {
            partsJson = objectMapper.writeValueAsString(parts);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not save assessment explanation", ex);
        }

        RiskAssessment saved = risks.save(new RiskAssessment(
            studentId, score, band, explanation, partsJson
        ));

        return toView(saved);
    }

    @Transactional(readOnly = true)
    public List<RiskAssessmentView> history(Long studentId) {
        requireStudent(studentId);
        return risks.findByStudentIdOrderByAssessedAtDesc(studentId)
            .stream()
            .map(this::toView)
            .toList();
    }

    private RiskAssessmentView toView(RiskAssessment assessment) {
        List<List<Object>> parts = List.of();
        if (assessment.getContributionsJson() != null && !assessment.getContributionsJson().isBlank()) {
            try {
                parts = objectMapper.readValue(
                    assessment.getContributionsJson(),
                    new TypeReference<List<List<Object>>>() {}
                );
            } catch (Exception ignored) {
                parts = List.of();
            }
        }
        return new RiskAssessmentView(
            assessment.getId(),
            assessment.getStudentId(),
            assessment.getRiskScore(),
            assessment.getRiskBand(),
            assessment.getExplanation(),
            assessment.getAssessedAt(),
            parts
        );
    }

    private void requireStudent(Long studentId) {
        if (!students.existsById(studentId)) {
            throw new NoSuchElementException("Student not found");
        }
    }

    private void add(Map<String, Integer> values, String label, int points) {
        if (points > 0) values.put(label, points);
    }
}
