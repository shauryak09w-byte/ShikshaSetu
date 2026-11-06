package com.shikshasetu.dto;

import java.time.LocalDate;

public record EarlyWarningView(
    String category,
    String priority,
    String title,
    String explanation,
    String subject,
    LocalDate observedOn
) {}
