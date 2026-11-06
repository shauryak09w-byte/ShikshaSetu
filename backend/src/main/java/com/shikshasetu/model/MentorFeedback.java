package com.shikshasetu.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

@Entity
@Table(name = "mentor_feedback", indexes = {
    @Index(name = "idx_feedback_student_created", columnList = "student_id, created_at"),
    @Index(name = "idx_feedback_follow_up", columnList = "follow_up_date, follow_up_status")
})
public class MentorFeedback {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "student_id", nullable = false)
    private Long studentId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_feedback_student"))
    private Student student;

    @NotBlank(message = "Mentor name is required")
    @Size(max = 120, message = "Mentor name must be at most 120 characters")
    @Column(length = 120)
    private String mentorName;

    @NotBlank(message = "Conversation summary is required")
    @Size(max = 3000, message = "Observation must be at most 3000 characters")
    @Column(length = 3000)
    private String observation;

    @Size(max = 2000, message = "Action must be at most 2000 characters")
    @Column(length = 2000)
    private String actionTaken;

    @Size(max = 500, message = "Weekly target must be at most 500 characters")
    @Column(length = 500)
    private String weeklyTarget;

    private LocalDateTime followUpDate;

    @Column(name = "follow_up_status", length = 80)
    private String followUpStatus = "Scheduled";

    @Size(max = 2000, message = "Outcome note must be at most 2000 characters")
    @Column(length = 2000)
    private String outcomeNote;

    private LocalDateTime completedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public MentorFeedback() {}

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = LocalDateTime.now();
        if (followUpStatus == null || followUpStatus.isBlank()) followUpStatus = "Scheduled";
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getStudentId() { return studentId; }
    public void setStudentId(Long studentId) { this.studentId = studentId; }
    public String getMentorName() { return mentorName; }
    public void setMentorName(String mentorName) { this.mentorName = mentorName; }
    public String getObservation() { return observation; }
    public void setObservation(String observation) { this.observation = observation; }
    public String getActionTaken() { return actionTaken; }
    public void setActionTaken(String actionTaken) { this.actionTaken = actionTaken; }
    public String getWeeklyTarget() { return weeklyTarget; }
    public void setWeeklyTarget(String weeklyTarget) { this.weeklyTarget = weeklyTarget; }
    public LocalDateTime getFollowUpDate() { return followUpDate; }
    public void setFollowUpDate(LocalDateTime followUpDate) { this.followUpDate = followUpDate; }
    public String getFollowUpStatus() { return followUpStatus; }
    public void setFollowUpStatus(String followUpStatus) { this.followUpStatus = followUpStatus; }
    public String getOutcomeNote() { return outcomeNote; }
    public void setOutcomeNote(String outcomeNote) { this.outcomeNote = outcomeNote; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
