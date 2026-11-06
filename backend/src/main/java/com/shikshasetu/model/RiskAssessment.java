package com.shikshasetu.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(
    name = "risk_assessments",
    indexes = @Index(name = "idx_risk_student_assessed", columnList = "student_id, assessed_at")
)
public class RiskAssessment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "student_id", nullable = false)
    private Long studentId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_risk_student"))
    private Student student;

    @Column(nullable = false)
    private int riskScore;

    @Column(nullable = false, length = 12)
    private String riskBand;

    @Column(length = 3000)
    private String explanation;

    @Column(name = "contributions_json", length = 4000)
    private String contributionsJson;

    @Column(name = "assessed_at", nullable = false, updatable = false)
    private LocalDateTime assessedAt = LocalDateTime.now();

    public RiskAssessment() {}

    public RiskAssessment(Long studentId, int riskScore, String riskBand,
                          String explanation, String contributionsJson) {
        this.studentId = studentId;
        this.riskScore = riskScore;
        this.riskBand = riskBand;
        this.explanation = explanation;
        this.contributionsJson = contributionsJson;
    }

    public Long getId() { return id; }
    public Long getStudentId() { return studentId; }
    public int getRiskScore() { return riskScore; }
    public String getRiskBand() { return riskBand; }
    public String getExplanation() { return explanation; }
    public String getContributionsJson() { return contributionsJson; }
    public LocalDateTime getAssessedAt() { return assessedAt; }
}
