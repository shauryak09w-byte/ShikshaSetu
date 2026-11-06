package com.shikshasetu.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name="portal_users", indexes={@Index(name="idx_portal_user_institution_status", columnList="institution_id, account_status")})
public class PortalUser {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(nullable=false, unique=true, length=180) private String email;
    @Column(name="full_name", nullable=false, length=120) private String fullName;
    @Column(name="password_hash", nullable=false, length=255) private String passwordHash;
    @Column(nullable=false, length=24) private String role;
    @Column(name="account_status", nullable=false, length=20) private String accountStatus;
    @Column(name="institution_id") private Long institutionId;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="institution_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_portal_user_institution")) private Institution institution;
    @Column(name="student_id") private Long studentId;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="student_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_portal_user_student")) private Student student;
    private Integer age;
    @Column(name="ai_mentor_name", length=32) private String aiMentorName;
    @Column(name="chat_monitoring_consent", nullable=false) private boolean chatMonitoringConsent;
    @Column(name="consent_at") private LocalDateTime consentAt;
    @Column(nullable=false, updatable=false) private LocalDateTime createdAt=LocalDateTime.now();
    @Column(nullable=false) private LocalDateTime updatedAt=LocalDateTime.now();
    @PreUpdate protected void update(){updatedAt=LocalDateTime.now();}
    public Long getId(){return id;} public String getEmail(){return email;} public void setEmail(String v){email=v;}
    public String getFullName(){return fullName;} public void setFullName(String v){fullName=v;}
    public String getPasswordHash(){return passwordHash;} public void setPasswordHash(String v){passwordHash=v;}
    public String getRole(){return role;} public void setRole(String v){role=v;}
    public String getAccountStatus(){return accountStatus;} public void setAccountStatus(String v){accountStatus=v;}
    public Long getInstitutionId(){return institutionId;} public void setInstitutionId(Long v){institutionId=v;}
    public Long getStudentId(){return studentId;} public void setStudentId(Long v){studentId=v;}
    public Integer getAge(){return age;} public void setAge(Integer v){age=v;}
    public String getAiMentorName(){return aiMentorName;} public void setAiMentorName(String v){aiMentorName=v;}
    public boolean isChatMonitoringConsent(){return chatMonitoringConsent;} public void setChatMonitoringConsent(boolean v){chatMonitoringConsent=v;}
    public LocalDateTime getConsentAt(){return consentAt;} public void setConsentAt(LocalDateTime v){consentAt=v;}
    public LocalDateTime getCreatedAt(){return createdAt;} public LocalDateTime getUpdatedAt(){return updatedAt;}
}
