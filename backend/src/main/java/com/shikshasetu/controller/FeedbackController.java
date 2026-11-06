package com.shikshasetu.controller;

import com.shikshasetu.dto.FollowUpOutcomeRequest;
import com.shikshasetu.model.MentorFeedback;
import com.shikshasetu.repo.MentorFeedbackRepository;
import com.shikshasetu.repo.StudentRepository;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;

@RestController
@RequestMapping("/api/students/{studentId}/feedback")
public class FeedbackController {
    private static final Set<String> ALLOWED_STATUSES = Set.of(
        "Completed · improvement noted",
        "Completed · no clear change yet",
        "Further support needed",
        "Student not reached"
    );

    private final StudentRepository students;
    private final MentorFeedbackRepository feedback;

    public FeedbackController(StudentRepository students, MentorFeedbackRepository feedback) {
        this.students = students;
        this.feedback = feedback;
    }

    @PostMapping
    @Transactional
    public MentorFeedback add(@PathVariable Long studentId, @Valid @RequestBody MentorFeedback body) {
        requireStudent(studentId);
        body.setId(null);
        body.setStudentId(studentId);
        body.setFollowUpStatus("Scheduled");
        body.setOutcomeNote(null);
        body.setCompletedAt(null);
        return feedback.save(body);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<MentorFeedback> list(@PathVariable Long studentId) {
        requireStudent(studentId);
        return feedback.findByStudentIdOrderByCreatedAtDesc(studentId);
    }

    @PatchMapping("/{feedbackId}/outcome")
    @Transactional
    public MentorFeedback updateOutcome(
        @PathVariable Long studentId,
        @PathVariable Long feedbackId,
        @Valid @RequestBody FollowUpOutcomeRequest request
    ) {
        requireStudent(studentId);
        MentorFeedback item = feedback.findById(feedbackId)
            .filter(value -> value.getStudentId().equals(studentId))
            .orElseThrow(() -> new NoSuchElementException("Follow-up not found for this student"));
        if (!ALLOWED_STATUSES.contains(request.status())) {
            throw new IllegalArgumentException("Unsupported follow-up outcome status");
        }
        item.setFollowUpStatus(request.status());
        item.setOutcomeNote(request.outcomeNote() == null ? "" : request.outcomeNote().trim());
        item.setCompletedAt(LocalDateTime.now());
        return feedback.save(item);
    }

    private void requireStudent(Long studentId) {
        if (!students.existsById(studentId)) throw new NoSuchElementException("Student not found");
    }
}
