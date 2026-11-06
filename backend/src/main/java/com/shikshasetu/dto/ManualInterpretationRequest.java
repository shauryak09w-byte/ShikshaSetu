package com.shikshasetu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ManualInterpretationRequest(
    @NotBlank(message = "Review status is required")
    @Size(max = 80, message = "Review status must be at most 80 characters")
    String reviewStatus,

    @NotBlank(message = "Manual interpretation is required")
    @Size(min = 12, max = 3000, message = "Interpretation must contain 12 to 3000 characters")
    String interpretation,

    @Size(max = 1600, message = "Evidence must be at most 1600 characters")
    String evidence,

    @Size(max = 1600, message = "Next action must be at most 1600 characters")
    String nextAction
) {}
