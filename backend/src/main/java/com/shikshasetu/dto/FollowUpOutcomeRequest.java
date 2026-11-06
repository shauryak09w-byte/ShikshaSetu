package com.shikshasetu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record FollowUpOutcomeRequest(
    @NotBlank(message = "Follow-up status is required")
    @Size(max = 80, message = "Status must be at most 80 characters")
    String status,
    @Size(max = 2000, message = "Outcome note must be at most 2000 characters")
    String outcomeNote
) {}
