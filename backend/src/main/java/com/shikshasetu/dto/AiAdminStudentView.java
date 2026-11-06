package com.shikshasetu.dto;

import com.shikshasetu.model.Student;
import java.util.List;

public record AiAdminStudentView(
    Student student,
    RiskAssessmentView latestAssessment,
    long academicRecordCount,
    long mentorFeedbackCount,
    long manualInterpretationCount,
    List<EarlyWarningView> earlyWarnings
) {}
