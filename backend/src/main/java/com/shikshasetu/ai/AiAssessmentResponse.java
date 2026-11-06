package com.shikshasetu.ai;
import java.time.Instant;import java.util.*;
public record AiAssessmentResponse(Long assessmentId,Long studentId,String engineStatus,String modelVersion,double deteriorationProbability,String supportPriority,Map<String,Double> observedFeatures,List<String> observedSignals,List<SupportSuggestion> supportSuggestions,boolean requiresHumanReview,List<String> dataQualityWarnings,String interpretation,Instant assessedAt){public record SupportSuggestion(String title,String reason,String suggestedAction,String weeklyTarget,String resourceType){}}
