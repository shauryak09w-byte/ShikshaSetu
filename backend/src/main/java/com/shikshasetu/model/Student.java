package com.shikshasetu.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

@Entity
@Table(
    name = "students",
    uniqueConstraints = @UniqueConstraint(name = "uk_students_student_code", columnNames = "student_code"),
    indexes = {
        @Index(name = "idx_students_full_name", columnList = "full_name"),
        @Index(name = "idx_students_audit_group", columnList = "audit_group")
    }
)
public class Student {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "institution_id")
    private Long institutionId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "institution_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_student_institution"))
    private Institution institution;

    @NotBlank(message = "Student ID is required")
    @Size(max = 30, message = "Student ID must be at most 30 characters")
    @Column(name = "student_code", nullable = false, length = 30)
    private String studentCode;

    @NotBlank(message = "Full name is required")
    @Size(max = 120, message = "Full name must be at most 120 characters")
    @Column(name = "full_name", nullable = false, length = 120)
    private String fullName;

    @Email(message = "Enter a valid email address")
    @Size(max = 160, message = "Email must be at most 160 characters")
    @Column(length = 160)
    private String email;

    @DecimalMin(value = "0.0", message = "Attendance cannot be below 0")
    @DecimalMax(value = "100.0", message = "Attendance cannot exceed 100")
    @Column(nullable = false)
    private double attendance;

    @DecimalMin(value = "0.0", message = "Internal marks cannot be below 0")
    @DecimalMax(value = "100.0", message = "Internal marks cannot exceed 100")
    @Column(name = "internal_marks", nullable = false)
    private double internalMarks;

    @DecimalMin(value = "0.0", message = "Assignment completion cannot be below 0")
    @DecimalMax(value = "100.0", message = "Assignment completion cannot exceed 100")
    @Column(name = "assignments_completed", nullable = false)
    private double assignmentsCompleted;

    @Min(value = 0, message = "Previous failures cannot be negative")
    @Column(nullable = false)
    private int previousFailures;

    @Min(value = 0, message = "Absences cannot be negative")
    @Column(nullable = false)
    private int absences;

    // Optional aggregate audit group. It is never included in individual risk scoring.
    @Size(max = 80, message = "Audit group must be at most 80 characters")
    @Column(name = "audit_group", length = 80)
    private String auditGroup;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now();

    public Student() {}

    @PrePersist
    protected void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        normalizeText();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
        normalizeText();
    }

    private void normalizeText() {
        if (studentCode != null) studentCode = studentCode.trim();
        if (fullName != null) fullName = fullName.trim();
        if (email != null) email = email.trim().toLowerCase();
        if (auditGroup != null) {
            auditGroup = auditGroup.trim();
            if (auditGroup.isBlank()) auditGroup = null;
        }
    }

    public Long getId() { return id; }
    public Long getInstitutionId() { return institutionId; }
    public void setInstitutionId(Long institutionId) { this.institutionId = institutionId; }
    public void setId(Long id) { this.id = id; }

    public String getStudentCode() { return studentCode; }
    public void setStudentCode(String studentCode) { this.studentCode = studentCode; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public double getAttendance() { return attendance; }
    public void setAttendance(double attendance) { this.attendance = attendance; }

    public double getInternalMarks() { return internalMarks; }
    public void setInternalMarks(double internalMarks) { this.internalMarks = internalMarks; }

    public double getAssignmentsCompleted() { return assignmentsCompleted; }
    public void setAssignmentsCompleted(double assignmentsCompleted) { this.assignmentsCompleted = assignmentsCompleted; }

    public int getPreviousFailures() { return previousFailures; }
    public void setPreviousFailures(int previousFailures) { this.previousFailures = previousFailures; }

    public int getAbsences() { return absences; }
    public void setAbsences(int absences) { this.absences = absences; }

    public String getAuditGroup() { return auditGroup; }
    public void setAuditGroup(String auditGroup) { this.auditGroup = auditGroup; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
