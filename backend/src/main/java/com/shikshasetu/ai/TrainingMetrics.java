package com.shikshasetu.ai;
import java.io.Serializable;
public record TrainingMetrics(int totalRows,int uniqueStudents,int trainRows,int testRows,int truePositives,int trueNegatives,int falsePositives,int falseNegatives,double accuracy,double precision,double recall,double f1,double rocAuc,String validationMethod) implements Serializable {}
