package com.shikshasetu.service;

import com.shikshasetu.dto.EarlyWarningView;
import com.shikshasetu.model.AcademicRecord;
import com.shikshasetu.repo.AcademicRecordRepository;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Rule-based trend checks for transparent early-warning signals.
 * These rules are not a trained ML model and must be reviewed by a mentor.
 */
@Service
public class StudentTrendService {

    private final AcademicRecordRepository records;

    public StudentTrendService(AcademicRecordRepository records) {
        this.records = records;
    }

    public List<EarlyWarningView> findWarnings(Long studentId) {
        List<AcademicRecord> all = records.findByStudentIdOrderByRecordDateDescIdDesc(studentId);
        List<EarlyWarningView> warnings = new ArrayList<>();

        Map<String, List<AcademicRecord>> bySubject = all.stream()
            .filter(r -> r.getMarksObtained() != null && r.getMaxMarks() != null && r.getMaxMarks() > 0)
            .collect(Collectors.groupingBy(
                r -> r.getSubject().trim().toLowerCase(Locale.ROOT),
                TreeMap::new,
                Collectors.toList()
            ));

        for (List<AcademicRecord> subjectRecords : bySubject.values()) {
            subjectRecords.sort(
                Comparator.comparing(AcademicRecord::getRecordDate).reversed()
                    .thenComparing(AcademicRecord::getId, Comparator.reverseOrder())
            );
            AcademicRecord latest = subjectRecords.get(0);
            String subject = latest.getSubject();
            double latestPercent = percentage(latest);

            if (subjectRecords.size() >= 2) {
                AcademicRecord previous = subjectRecords.get(1);
                double previousPercent = percentage(previous);
                double drop = previousPercent - latestPercent;

                if (drop >= 10.0) {
                    String priority = drop >= 20.0 ? "HIGH" : "MEDIUM";
                    warnings.add(new EarlyWarningView(
                        "GRADE_DROP",
                        priority,
                        "Recent marks drop in " + subject,
                        String.format(Locale.ROOT,
                            "The latest recorded result is %.1f%%, down %.1f percentage points from the previous recorded result (%.1f%%). Review the context with the student.",
                            latestPercent, drop, previousPercent),
                        subject,
                        latest.getRecordDate()
                    ));
                }

                if (latestPercent < 40.0 && previousPercent < 40.0) {
                    warnings.add(new EarlyWarningView(
                        "REPEATED_LOW_SUBJECT_PERFORMANCE",
                        "HIGH",
                        "Repeated low results in " + subject,
                        String.format(Locale.ROOT,
                            "The two latest recorded results in %s are below 40%% (%.1f%% and %.1f%%). Check for learning gaps and offer subject-specific support.",
                            subject, latestPercent, previousPercent),
                        subject,
                        latest.getRecordDate()
                    ));
                }
            }
        }

        List<AcademicRecord> attendanceRecords = all.stream()
            .filter(r -> r.getAttendancePercent() != null)
            .sorted(Comparator.comparing(AcademicRecord::getRecordDate).reversed()
                .thenComparing(AcademicRecord::getId, Comparator.reverseOrder()))
            .toList();

        if (attendanceRecords.size() >= 2) {
            AcademicRecord latest = attendanceRecords.get(0);
            AcademicRecord previous = attendanceRecords.get(1);
            double drop = previous.getAttendancePercent() - latest.getAttendancePercent();

            if (drop >= 10.0) {
                warnings.add(new EarlyWarningView(
                    "ATTENDANCE_DECLINE",
                    drop >= 20.0 ? "HIGH" : "MEDIUM",
                    "Attendance is declining",
                    String.format(Locale.ROOT,
                        "Recorded attendance changed from %.1f%% to %.1f%%. Check whether there are barriers the student wants help with.",
                        previous.getAttendancePercent(), latest.getAttendancePercent()),
                    null,
                    latest.getRecordDate()
                ));
            }
        }

        all.stream()
            .filter(r -> r.getRepeatedFailures() != null && r.getRepeatedFailures() > 0)
            .max(Comparator.comparing(AcademicRecord::getRecordDate).thenComparing(AcademicRecord::getId))
            .ifPresent(r -> warnings.add(new EarlyWarningView(
                "REPEATED_FAILURE_COUNT",
                r.getRepeatedFailures() >= 2 ? "HIGH" : "MEDIUM",
                "Repeated subject difficulties recorded",
                r.getRepeatedFailures() + " repeated failure(s) were recorded for " + r.getSubject() + ". Review the assessment history and ask the student what support would help.",
                r.getSubject(),
                r.getRecordDate()
            )));

        all.stream()
            .filter(r -> r.getConsecutiveAbsences() != null && r.getConsecutiveAbsences() >= 3)
            .max(Comparator.comparing(AcademicRecord::getRecordDate).thenComparing(AcademicRecord::getId))
            .ifPresent(r -> warnings.add(new EarlyWarningView(
                "CONSECUTIVE_ABSENCES",
                r.getConsecutiveAbsences() >= 5 ? "HIGH" : "MEDIUM",
                "Consecutive absences recorded",
                r.getConsecutiveAbsences() + " consecutive absences were recorded. Contact the student supportively to understand whether assistance is needed.",
                null,
                r.getRecordDate()
            )));

        warnings.sort(Comparator.comparingInt(warning -> switch (warning.priority()) {
            case "HIGH" -> 0;
            case "MEDIUM" -> 1;
            default -> 2;
        }));
        return warnings;
    }

    private double percentage(AcademicRecord record) {
        return (record.getMarksObtained() / record.getMaxMarks()) * 100.0;
    }
}
