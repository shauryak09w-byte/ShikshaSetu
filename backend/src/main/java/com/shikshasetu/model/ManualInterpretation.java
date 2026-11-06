package com.shikshasetu.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * Stores a contextual review alongside an assessment snapshot.
 * It intentionally does not modify the student's source data or risk score.
 */
@Entity
@Table(
    name = "manual_interpretations",
    indexes = {
        @Index(name = "idx_manual_interpretation_student_created", columnList = "student_id, created_at"),
        @Index(name = "idx_manual_interpretation_status", columnList = "review_status")
    }
)
public class ManualInterpretation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "student_id", nullable = false)
    private Long studentId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_interpretation_student"))
    private Student student;

    @Column(name = "student_code_snapshot", length = 30)
    private String studentCodeSnapshot;

    @Column(name = "student_name_snapshot", length = 120)
    private String studentNameSnapshot;

    @Column(name = "review_status", nullable = false, length = 80)
    private String reviewStatus;

    @Column(nullable = false, length = 3000)
    private String interpretation;

    @Column(length = 1600)
    private String evidence;

    @Column(name = "next_action", length = 1600)
    private String nextAction;

    // Immutable snapshot of the latest assessment when this review was saved.
    @Column(name = "assessment_id_snapshot")
    private Long assessmentIdSnapshot;

    @Column(name = "risk_score_snapshot")
    private Integer riskScoreSnapshot;

    @Column(name = "risk_band_snapshot", length = 12)
    private String riskBandSnapshot;

    @Column(name = "assessment_at_snapshot")
    private LocalDateTime assessmentAtSnapshot;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt = LocalDateTime.now();

    public ManualInterpretation() {}

    @PrePersist
    protected void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        normalize();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
        normalize();
    }

    private void normalize() {
        if (studentCodeSnapshot != null) studentCodeSnapshot = studentCodeSnapshot.trim();
        if (studentNameSnapshot != null) studentNameSnapshot = studentNameSnapshot.trim();
        if (reviewStatus != null) reviewStatus = reviewStatus.trim();
        if (interpretation != null) interpretation = interpretation.trim();
        if (evidence != null) evidence = evidence.trim();
        if (nextAction != null) nextAction = nextAction.trim();
    }

    public Long getId() { return id; }
    public Long getStudentId() { return studentId; }
    public void setStudentId(Long studentId) { this.studentId = studentId; }
    public String getStudentCodeSnapshot() { return studentCodeSnapshot; }
    public void setStudentCodeSnapshot(String value) { this.studentCodeSnapshot = value; }
    public String getStudentNameSnapshot() { return studentNameSnapshot; }
    public void setStudentNameSnapshot(String value) { this.studentNameSnapshot = value; }
    public String getReviewStatus() { return reviewStatus; }
    public void setReviewStatus(String reviewStatus) { this.reviewStatus = reviewStatus; }
    public String getInterpretation() { return interpretation; }
    public void setInterpretation(String interpretation) { this.interpretation = interpretation; }
    public String getEvidence() { return evidence; }
    public void setEvidence(String evidence) { this.evidence = evidence; }
    public String getNextAction() { return nextAction; }
    public void setNextAction(String nextAction) { this.nextAction = nextAction; }
    public Long getAssessmentIdSnapshot() { return assessmentIdSnapshot; }
    public void setAssessmentIdSnapshot(Long assessmentIdSnapshot) { this.assessmentIdSnapshot = assessmentIdSnapshot; }
    public Integer getRiskScoreSnapshot() { return riskScoreSnapshot; }
    public void setRiskScoreSnapshot(Integer riskScoreSnapshot) { this.riskScoreSnapshot = riskScoreSnapshot; }
    public String getRiskBandSnapshot() { return riskBandSnapshot; }
    public void setRiskBandSnapshot(String riskBandSnapshot) { this.riskBandSnapshot = riskBandSnapshot; }
    public LocalDateTime getAssessmentAtSnapshot() { return assessmentAtSnapshot; }
    public void setAssessmentAtSnapshot(LocalDateTime assessmentAtSnapshot) { this.assessmentAtSnapshot = assessmentAtSnapshot; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
