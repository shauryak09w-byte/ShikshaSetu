package com.shikshasetu.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "institutions", uniqueConstraints = @UniqueConstraint(name = "uk_institution_access_code", columnNames = "access_code"))
public class Institution {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, length = 160) private String name;
    @Column(name = "access_code", nullable = false, unique = true, length = 20) private String accessCode;
    @Column(nullable = false) private boolean active = true;
    @Column(name = "enrollment_open", nullable = false) private boolean enrollmentOpen = true;
    @Column(name = "settings_json", length = 4000) private String settingsJson = "{}";
    @Column(name = "created_by_user_id") private Long createdByUserId;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "created_by_user_id", insertable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_institution_creator")) private PortalUser createdBy;
    @Column(nullable = false, updatable = false) private LocalDateTime createdAt = LocalDateTime.now();
    public Institution() {}
    public Long getId(){return id;} public String getName(){return name;} public void setName(String v){name=v;}
    public String getAccessCode(){return accessCode;} public void setAccessCode(String v){accessCode=v;}
    public boolean isActive(){return active;} public void setActive(boolean v){active=v;}
    public boolean isEnrollmentOpen(){return enrollmentOpen;} public void setEnrollmentOpen(boolean v){enrollmentOpen=v;}
    public String getSettingsJson(){return settingsJson;} public void setSettingsJson(String v){settingsJson=v;}
    public Long getCreatedByUserId(){return createdByUserId;} public void setCreatedByUserId(Long v){createdByUserId=v;}
    public LocalDateTime getCreatedAt(){return createdAt;}
}
