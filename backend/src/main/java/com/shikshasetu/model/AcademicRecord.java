package com.shikshasetu.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(
    name = "student_academic_records",
    indexes = {
        @Index(name = "idx_academic_student_date", columnList = "student_id, record_date"),
        @Index(name = "idx_academic_subject", columnList = "student_id, subject")
    }
)
public class AcademicRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "student_id", nullable = false)
    private Long studentId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_academic_student"))
    private Student student;

    @NotBlank(message = "Subject is required")
    @Size(max = 100, message = "Subject must be at most 100 characters")
    @Column(nullable = false, length = 100)
    private String subject;

    @Size(max = 120, message = "Assessment name must be at most 120 characters")
    @Column(length = 120)
    private String assessmentName;

    @NotNull(message = "Record date is required")
    @Column(name = "record_date", nullable = false)
    private LocalDate recordDate;

    @DecimalMin(value = "0.0", message = "Marks obtained cannot be negative")
    private Double marksObtained;

    @DecimalMin(value = "0.01", message = "Maximum marks must be greater than zero")
    private Double maxMarks;

    @DecimalMin(value = "0.0", message = "Attendance cannot be below zero")
    @DecimalMax(value = "100.0", message = "Attendance cannot exceed 100")
    private Double attendancePercent;

    @Min(value = 0, message = "Absence count cannot be negative")
    private Integer absenceCount;

    @Min(value = 0, message = "Consecutive absences cannot be negative")
    private Integer consecutiveAbsences;

    @Min(value = 0, message = "Repeated failures cannot be negative")
    private Integer repeatedFailures;

    @Size(max = 1500, message = "Notes must be at most 1500 characters")
    @Column(length = 1500)
    private String notes;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public AcademicRecord() {}

    @PrePersist
    protected void beforeInsert() {
        if (recordDate == null) recordDate = LocalDate.now();
        if (subject != null) subject = subject.trim();
        if (assessmentName != null) assessmentName = assessmentName.trim();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getStudentId() { return studentId; }
    public void setStudentId(Long studentId) { this.studentId = studentId; }

    public String getSubject() { return subject; }
    public void setSubject(String subject) { this.subject = subject; }

    public String getAssessmentName() { return assessmentName; }
    public void setAssessmentName(String assessmentName) { this.assessmentName = assessmentName; }

    public LocalDate getRecordDate() { return recordDate; }
    public void setRecordDate(LocalDate recordDate) { this.recordDate = recordDate; }

    public Double getMarksObtained() { return marksObtained; }
    public void setMarksObtained(Double marksObtained) { this.marksObtained = marksObtained; }

    public Double getMaxMarks() { return maxMarks; }
    public void setMaxMarks(Double maxMarks) { this.maxMarks = maxMarks; }

    public Double getAttendancePercent() { return attendancePercent; }
    public void setAttendancePercent(Double attendancePercent) { this.attendancePercent = attendancePercent; }

    public Integer getAbsenceCount() { return absenceCount; }
    public void setAbsenceCount(Integer absenceCount) { this.absenceCount = absenceCount; }

    public Integer getConsecutiveAbsences() { return consecutiveAbsences; }
    public void setConsecutiveAbsences(Integer consecutiveAbsences) { this.consecutiveAbsences = consecutiveAbsences; }

    public Integer getRepeatedFailures() { return repeatedFailures; }
    public void setRepeatedFailures(Integer repeatedFailures) { this.repeatedFailures = repeatedFailures; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public LocalDateTime getCreatedAt() { return createdAt; }
}
