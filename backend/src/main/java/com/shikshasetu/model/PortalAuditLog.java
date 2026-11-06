package com.shikshasetu.model;
import jakarta.persistence.*; import java.time.LocalDateTime;
@Entity @Table(name="portal_audit_logs", indexes={@Index(name="idx_portal_audit_tenant_time",columnList="institution_id, created_at"),@Index(name="idx_portal_audit_actor",columnList="actor_user_id")})
public class PortalAuditLog {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(name="institution_id") private Long institutionId; @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="institution_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_portal_audit_institution")) private Institution institution; @Column(name="actor_user_id") private Long actorUserId; @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="actor_user_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_portal_audit_actor")) private PortalUser actor;
 @Column(nullable=false,length=60) private String action; @Column(name="subject_user_id") private Long subjectUserId;
 @Column(length=500) private String details; @Column(name="created_at",nullable=false,updatable=false) private LocalDateTime createdAt=LocalDateTime.now();
 public PortalAuditLog(){} public PortalAuditLog(Long tenant,Long actor,String action,Long subject,String details){institutionId=tenant;actorUserId=actor;this.action=action;subjectUserId=subject;this.details=details;}
 public Long getId(){return id;} public Long getInstitutionId(){return institutionId;} public Long getActorUserId(){return actorUserId;} public String getAction(){return action;} public Long getSubjectUserId(){return subjectUserId;} public String getDetails(){return details;} public LocalDateTime getCreatedAt(){return createdAt;}
}
