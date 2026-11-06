package com.shikshasetu.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record AcademicTrendRequest(
    @NotBlank @Size(max = 100) String subject,
    @NotNull LocalDate previousRecordDate,
    @NotNull LocalDate latestRecordDate,
    @NotNull @DecimalMin("0.0") @DecimalMax("100.0") Double previousMark,
    @NotNull @DecimalMin("0.0") @DecimalMax("100.0") Double latestMark,
    @DecimalMin("0.0") @DecimalMax("100.0") Double previousAttendance,
    @Min(0) Integer consecutiveAbsences,
    @Min(0) Integer repeatedFailures,
    @Size(max = 80) @Pattern(regexp = "[A-Za-z0-9-]*", message = "Reference may contain only letters, numbers and hyphens") String reference
) {}
