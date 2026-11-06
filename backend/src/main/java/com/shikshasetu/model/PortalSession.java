package com.shikshasetu.model;
import jakarta.persistence.*; import java.time.LocalDateTime;
@Entity @Table(name="portal_sessions", indexes=@Index(name="idx_portal_session_user_expiry", columnList="user_id, expires_at"))
public class PortalSession {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(name="user_id",nullable=false) private Long userId;
 @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="user_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_portal_session_user")) private PortalUser user;
 @Column(name="token_hash",nullable=false,unique=true,length=64) private String tokenHash;
 @Column(name="expires_at",nullable=false) private LocalDateTime expiresAt;
 @Column(name="created_at",nullable=false,updatable=false) private LocalDateTime createdAt=LocalDateTime.now();
 @Column(name="revoked_at") private LocalDateTime revokedAt;
 public PortalSession(){} public PortalSession(Long userId,String hash,LocalDateTime expiry){this.userId=userId;tokenHash=hash;expiresAt=expiry;}
 public Long getId(){return id;} public Long getUserId(){return userId;} public String getTokenHash(){return tokenHash;} public LocalDateTime getExpiresAt(){return expiresAt;} public LocalDateTime getRevokedAt(){return revokedAt;} public void revoke(){revokedAt=LocalDateTime.now();}
}
