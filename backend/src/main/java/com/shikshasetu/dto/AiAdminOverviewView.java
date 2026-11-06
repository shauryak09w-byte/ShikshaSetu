package com.shikshasetu.dto;

import java.util.List;

public record AiAdminOverviewView(
    long totalStudents,
    long assessedStudents,
    long unassessedStudents,
    long lowSupport,
    long mediumSupport,
    long highSupport,
    long openFollowUps,
    long manualInterpretations,
    double averageAttendance,
    double averageInternalMarks,
    double averageAssignmentCompletion,
    String modelStatus,
    String notice,
    List<AiAdminStudentView> students
) {}
