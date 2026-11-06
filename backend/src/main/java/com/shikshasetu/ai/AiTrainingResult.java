package com.shikshasetu.ai;
public record AiTrainingResult(String status,String modelVersion,String trainedAt,String targetDefinition,TrainingMetrics metrics,String warning) {}
