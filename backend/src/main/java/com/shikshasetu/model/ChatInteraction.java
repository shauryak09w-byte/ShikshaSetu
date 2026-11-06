package com.shikshasetu.model;
import jakarta.persistence.*; import java.time.LocalDateTime;
@Entity @Table(name="chat_interactions", indexes={@Index(name="idx_chat_tenant_time",columnList="institution_id, created_at"),@Index(name="idx_chat_student",columnList="student_id, created_at"),@Index(name="idx_chat_topic",columnList="institution_id, topic")})
public class ChatInteraction {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(name="institution_id",nullable=false) private Long institutionId; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="institution_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_chat_institution")) private Institution institution; @Column(name="user_id",nullable=false) private Long userId; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="user_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_chat_user")) private PortalUser user;
 @Column(name="student_id") private Long studentId; @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="student_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_chat_student")) private Student student; @Column(nullable=false,length=40) private String topic;
 @Column(nullable=false,length=24) private String sentiment; @Lob @Column(name="user_message",nullable=false) private String userMessage;
 @Lob @Column(name="assistant_reply",nullable=false) private String assistantReply;
 @Column(name="created_at",nullable=false,updatable=false) private LocalDateTime createdAt=LocalDateTime.now();
 @Column(name="expires_at",nullable=false) private LocalDateTime expiresAt;
 public ChatInteraction(){} public ChatInteraction(Long tenant,Long user,Long student,String topic,String sentiment,String message,String reply,LocalDateTime expires){institutionId=tenant;userId=user;studentId=student;this.topic=topic;this.sentiment=sentiment;userMessage=message;assistantReply=reply;expiresAt=expires;}
 public Long getId(){return id;} public Long getInstitutionId(){return institutionId;} public Long getUserId(){return userId;} public Long getStudentId(){return studentId;} public String getTopic(){return topic;} public String getSentiment(){return sentiment;} public String getUserMessage(){return userMessage;} public String getAssistantReply(){return assistantReply;} public LocalDateTime getCreatedAt(){return createdAt;} public LocalDateTime getExpiresAt(){return expiresAt;}
}
