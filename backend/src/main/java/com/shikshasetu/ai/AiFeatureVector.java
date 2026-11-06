package com.shikshasetu.ai;
import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;
public record AiFeatureVector(Double attendancePercent,Double internalMarksPercent,Double assignmentCompletionPercent,Double previousFailures,Double absenceCount,Double consecutiveAbsences,Double recentMarkDrop,Double repeatedLowResults) implements Serializable {
 public double[] toArray(){return new double[]{n(attendancePercent),n(internalMarksPercent),n(assignmentCompletionPercent),n(previousFailures),n(absenceCount),n(consecutiveAbsences),n(recentMarkDrop),n(repeatedLowResults)};}
 private double n(Double v){return v==null?Double.NaN:v;}
 public Map<String,Double> asMap(){Map<String,Double> m=new LinkedHashMap<>();m.put("attendance_percent",attendancePercent);m.put("internal_marks_percent",internalMarksPercent);m.put("assignment_completion_percent",assignmentCompletionPercent);m.put("previous_failures",previousFailures);m.put("absence_count",absenceCount);m.put("consecutive_absences",consecutiveAbsences);m.put("recent_mark_drop",recentMarkDrop);m.put("repeated_low_results",repeatedLowResults);return m;}
}
