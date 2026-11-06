package com.shikshasetu.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.time.Instant;
import java.util.Map;

/** Reports the connected AI and analytics capabilities without overstating their scope. */
@RestController
public class AiStatusController {
    @GetMapping("/api/ai/status")
    public Map<String, Object> status() {
        return Map.of(
            "platformAdministrator", "ROLE_AND_TENANT_SCOPED",
            "riskEngine", "EXISTING_WEKA_ACADEMIC_RISK_PIPELINE",
            "studentChatbot", "AUTHENTICATED_PERSISTED_EMPATHETIC_RULE_BASED_COMPANION",
            "chatActivityAnalytics", "WEKA_SIMPLE_KMEANS_METADATA_CLUSTERING",
            "manualInterpretations", "SPRING_BOOT_DATABASE_PERSISTED",
            "timestamp", Instant.now().toString(),
            "notice", "Chat topic and tone cues are transparent keyword estimates, not diagnoses. Usage clusters are descriptive engagement groups. Human review is required for consequential academic decisions."
        );
    }
}
