package com.shikshasetu.dto;

import java.time.LocalDateTime;
import java.util.List;

public record RiskAssessmentView(
    Long id,
    Long studentId,
    int riskScore,
    String riskBand,
    String explanation,
    LocalDateTime assessedAt,
    List<List<Object>> parts
) {}
