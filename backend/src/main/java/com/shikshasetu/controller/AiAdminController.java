package com.shikshasetu.controller;

import com.shikshasetu.ai.AiModelRuntime;
import com.shikshasetu.dto.AiAdminOverviewView;
import com.shikshasetu.dto.AiAdminStudentView;
import com.shikshasetu.dto.ManualInterpretationRequest;
import com.shikshasetu.dto.RiskAssessmentView;
import com.shikshasetu.model.ManualInterpretation;
import com.shikshasetu.model.MentorFeedback;
import com.shikshasetu.model.RiskAssessment;
import com.shikshasetu.model.Student;
import com.shikshasetu.repo.AcademicRecordRepository;
import com.shikshasetu.repo.ManualInterpretationRepository;
import com.shikshasetu.repo.MentorFeedbackRepository;
import com.shikshasetu.repo.RiskAssessmentRepository;
import com.shikshasetu.repo.StudentRepository;
import com.shikshasetu.service.RiskService;
import com.shikshasetu.service.StudentTrendService;
import com.shikshasetu.portal.PortalAuthContext;
import com.shikshasetu.portal.PortalPrincipal;
import jakarta.validation.Valid;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;

/**
 * Institution-scoped AI administration endpoints. The server-side portal interceptor
 * requires an Institution Admin or Super Admin session and verifies student ownership.
 */
@RestController
@RequestMapping("/api/ai-admin")
public class AiAdminController {

    private static final Set<String> REVIEW_STATUSES = Set.of(
        "Needs mentor context",
        "Reviewed with student",
        "Follow-up planned",
        "Escalate to trained mentor"
    );

    private final StudentRepository students;
    private final RiskAssessmentRepository risks;
    private final AcademicRecordRepository academicRecords;
    private final MentorFeedbackRepository feedback;
    private final ManualInterpretationRepository interpretations;
    private final RiskService riskService;
    private final StudentTrendService trendService;
    private final AiModelRuntime modelRuntime;

    public AiAdminController(
        StudentRepository students,
        RiskAssessmentRepository risks,
        AcademicRecordRepository academicRecords,
        MentorFeedbackRepository feedback,
        ManualInterpretationRepository interpretations,
        RiskService riskService,
        StudentTrendService trendService,
        AiModelRuntime modelRuntime
    ) {
        this.students = students;
        this.risks = risks;
        this.academicRecords = academicRecords;
        this.feedback = feedback;
        this.interpretations = interpretations;
        this.riskService = riskService;
        this.trendService = trendService;
        this.modelRuntime = modelRuntime;
    }

    /** Central metrics plus the full student values currently stored by the backend. */
    @GetMapping("/overview")
    @Transactional(readOnly = true)
    public AiAdminOverviewView overview() {
        List<Student> allStudents = visibleStudents();
        List<AiAdminStudentView> rows = allStudents.stream().map(this::toStudentView).toList();

        long assessed = rows.stream().filter(row -> row.latestAssessment() != null).count();
        long low = rows.stream().filter(row -> row.latestAssessment() != null
            && "LOW".equals(row.latestAssessment().riskBand())).count();
        long medium = rows.stream().filter(row -> row.latestAssessment() != null
            && "MEDIUM".equals(row.latestAssessment().riskBand())).count();
        long high = rows.stream().filter(row -> row.latestAssessment() != null
            && "HIGH".equals(row.latestAssessment().riskBand())).count();

        Set<Long> visibleIds = allStudents.stream().map(Student::getId).collect(java.util.stream.Collectors.toSet());
        List<MentorFeedback> allFeedback = feedback.findAll().stream().filter(item -> visibleIds.contains(item.getStudentId())).toList();
        long openFollowUps = allFeedback.stream()
            .filter(item -> "Scheduled".equalsIgnoreCase(item.getFollowUpStatus()))
            .count();

        double averageAttendance = average(allStudents.stream().mapToDouble(Student::getAttendance).toArray());
        double averageMarks = average(allStudents.stream().mapToDouble(Student::getInternalMarks).toArray());
        double averageAssignments = average(allStudents.stream().mapToDouble(Student::getAssignmentsCompleted).toArray());

        return new AiAdminOverviewView(
            allStudents.size(),
            assessed,
            allStudents.size() - assessed,
            low,
            medium,
            high,
            openFollowUps,
            interpretations.findAll().stream().filter(item -> visibleIds.contains(item.getStudentId())).count(),
            averageAttendance,
            averageMarks,
            averageAssignments,
            modelRuntime.current().map(bundle -> "WEKA_RANDOM_FOREST_TRAINED_PROTOTYPE · " + bundle.getModelVersion())
                .orElse("RULE_BASELINE_ACTIVE · ML_NOT_TRAINED"),
            "Assessments are review prompts, not diagnoses or causes. Manual interpretations are stored separately and never overwrite student values or assessment scores.",
            rows
        );
    }

    /** Central registry for the AI Admin student-value table. */
    @GetMapping("/students")
    @Transactional(readOnly = true)
    public List<AiAdminStudentView> students() {
        return visibleStudents().stream().map(this::toStudentView).toList();
    }

    /** Full inspection view for one student, including source and review history. */
    @GetMapping("/students/{studentId}")
    @Transactional(readOnly = true)
    public Map<String, Object> studentDetail(@PathVariable Long studentId) {
        Student student = requireStudent(studentId);
        return Map.of(
            "student", student,
            "riskHistory", riskService.history(studentId),
            "academicRecords", academicRecords.findByStudentIdOrderByRecordDateDescIdDesc(studentId),
            "earlyWarnings", trendService.findWarnings(studentId),
            "mentorFeedback", feedback.findByStudentIdOrderByCreatedAtDesc(studentId),
            "manualInterpretations", interpretations.findByStudentIdOrderByCreatedAtDesc(studentId),
            "notice", "Audit group is descriptive-only and excluded from individual risk scoring."
        );
    }

    /** List all manual interpretations for the AI Admin review register. */
    @GetMapping("/interpretations")
    @Transactional(readOnly = true)
    public List<ManualInterpretation> allInterpretations() {
        Set<Long> visibleIds = visibleStudents().stream().map(Student::getId).collect(java.util.stream.Collectors.toSet());
        return interpretations.findAllByOrderByCreatedAtDesc().stream().filter(item -> visibleIds.contains(item.getStudentId())).toList();
    }

    @GetMapping("/students/{studentId}/interpretations")
    @Transactional(readOnly = true)
    public List<ManualInterpretation> studentInterpretations(@PathVariable Long studentId) {
        requireStudent(studentId);
        return interpretations.findByStudentIdOrderByCreatedAtDesc(studentId);
    }

    /**
     * Save a contextual manual review with a snapshot of the latest assessment.
     * It does not alter the assessment record or any student profile field.
     */
    @PostMapping("/students/{studentId}/interpretations")
    @Transactional
    public ManualInterpretation createInterpretation(
        @PathVariable Long studentId,
        @Valid @RequestBody ManualInterpretationRequest request
    ) {
        Student student = requireStudent(studentId);
        validateStatus(request.reviewStatus());

        ManualInterpretation item = new ManualInterpretation();
        item.setStudentId(studentId);
        item.setStudentCodeSnapshot(student.getStudentCode());
        item.setStudentNameSnapshot(student.getFullName());
        applyRequest(item, request);
        snapshotLatestAssessment(item, studentId);
        return interpretations.save(item);
    }

    @PutMapping("/students/{studentId}/interpretations/{interpretationId}")
    @Transactional
    public ManualInterpretation updateInterpretation(
        @PathVariable Long studentId,
        @PathVariable Long interpretationId,
        @Valid @RequestBody ManualInterpretationRequest request
    ) {
        requireStudent(studentId);
        validateStatus(request.reviewStatus());
        ManualInterpretation item = interpretations.findById(interpretationId)
            .filter(value -> value.getStudentId().equals(studentId))
            .orElseThrow(() -> new NoSuchElementException("Manual interpretation not found for this student"));
        applyRequest(item, request);
        return interpretations.save(item);
    }

    @DeleteMapping("/students/{studentId}/interpretations/{interpretationId}")
    @Transactional
    public Map<String, String> deleteInterpretation(
        @PathVariable Long studentId,
        @PathVariable Long interpretationId
    ) {
        requireStudent(studentId);
        ManualInterpretation item = interpretations.findById(interpretationId)
            .filter(value -> value.getStudentId().equals(studentId))
            .orElseThrow(() -> new NoSuchElementException("Manual interpretation not found for this student"));
        interpretations.delete(item);
        return Map.of("message", "Manual interpretation deleted");
    }

    private AiAdminStudentView toStudentView(Student student) {
        RiskAssessmentView latest = riskService.history(student.getId()).stream().findFirst().orElse(null);
        return new AiAdminStudentView(
            student,
            latest,
            academicRecords.countByStudentId(student.getId()),
            feedback.countByStudentId(student.getId()),
            interpretations.countByStudentId(student.getId()),
            trendService.findWarnings(student.getId())
        );
    }

    private void snapshotLatestAssessment(ManualInterpretation item, Long studentId) {
        RiskAssessment latest = risks.findByStudentIdOrderByAssessedAtDesc(studentId)
            .stream().findFirst().orElse(null);
        if (latest == null) return;
        item.setAssessmentIdSnapshot(latest.getId());
        item.setRiskScoreSnapshot(latest.getRiskScore());
        item.setRiskBandSnapshot(latest.getRiskBand());
        item.setAssessmentAtSnapshot(latest.getAssessedAt());
    }

    private void applyRequest(ManualInterpretation item, ManualInterpretationRequest request) {
        item.setReviewStatus(request.reviewStatus());
        item.setInterpretation(request.interpretation());
        item.setEvidence(request.evidence());
        item.setNextAction(request.nextAction());
    }

    private void validateStatus(String status) {
        if (!REVIEW_STATUSES.contains(status)) {
            throw new IllegalArgumentException("Unsupported review status");
        }
    }

    private List<Student> visibleStudents() {
        PortalPrincipal principal = PortalAuthContext.require();
        if (principal.isSuperAdmin()) return students.findAll(Sort.by(Sort.Direction.ASC, "fullName"));
        return students.findAllByInstitutionId(principal.institutionId(), Sort.by(Sort.Direction.ASC, "fullName"));
    }

    private Student requireStudent(Long id) {
        PortalPrincipal principal = PortalAuthContext.require();
        return (principal.isSuperAdmin()
            ? students.findById(id)
            : students.findByInstitutionIdAndId(principal.institutionId(), id))
            .orElseThrow(() -> new NoSuchElementException("Student not found"));
    }

    private double average(double[] values) {
        if (values.length == 0) return 0.0;
        double total = 0.0;
        for (double value : values) total += value;
        return Math.round((total / values.length) * 10.0) / 10.0;
    }
}
