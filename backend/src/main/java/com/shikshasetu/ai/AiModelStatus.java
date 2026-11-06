package com.shikshasetu.ai;
public record AiModelStatus(String engine,String status,String modelVersion,String trainedAt,TrainingMetrics metrics,String targetDefinition,String note) {}
