package com.shikshasetu.model;
import jakarta.persistence.*; import java.time.LocalDateTime;
@Entity @Table(name="student_progress_checkins",indexes={@Index(name="idx_progress_tenant_date",columnList="institution_id, created_at"),@Index(name="idx_progress_student",columnList="student_id, created_at")})
public class StudentProgress {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id; @Column(name="institution_id",nullable=false) private Long institutionId; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="institution_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_progress_institution")) private Institution institution;
 @Column(name="student_id",nullable=false) private Long studentId; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="student_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_progress_student")) private Student student; @Column(name="user_id",nullable=false) private Long userId; @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="user_id",insertable=false,updatable=false,foreignKey=@ForeignKey(name="fk_progress_user")) private PortalUser user;
 @Column(nullable=false) private double attendance; @Column(name="assignments_done",nullable=false) private int assignmentsDone;
 @Column(name="assignments_total",nullable=false) private int assignmentsTotal; @Column(nullable=false) private int problems;
 @Column(nullable=false) private double hours; @Column(length=500) private String note;
 @Column(name="created_at",nullable=false,updatable=false) private LocalDateTime createdAt=LocalDateTime.now();
 public StudentProgress(){} public StudentProgress(Long tenant,Long student,Long user,double attendance,int done,int total,int problems,double hours,String note){institutionId=tenant;studentId=student;userId=user;this.attendance=attendance;assignmentsDone=done;assignmentsTotal=total;this.problems=problems;this.hours=hours;this.note=note;}
 public Long getId(){return id;} public Long getInstitutionId(){return institutionId;} public Long getStudentId(){return studentId;} public Long getUserId(){return userId;} public double getAttendance(){return attendance;} public int getAssignmentsDone(){return assignmentsDone;} public int getAssignmentsTotal(){return assignmentsTotal;} public int getProblems(){return problems;} public double getHours(){return hours;} public String getNote(){return note;} public LocalDateTime getCreatedAt(){return createdAt;}
}
