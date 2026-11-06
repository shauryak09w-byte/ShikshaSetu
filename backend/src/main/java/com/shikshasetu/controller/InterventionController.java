package com.shikshasetu.controller;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController @RequestMapping("/api/interventions")
public class InterventionController {
 @GetMapping public List<Map<String,Object>> all(){
  return List.of(
   Map.of("id","I1","name","Academic mentoring","description","Weekly one-to-one review of coursework and study plan","forIndicators",List.of("Low internal marks","Previous course failures")),
   Map.of("id","I2","name","Attendance support","description","Check-in with student, identify barriers and agree an attendance plan","forIndicators",List.of("Low attendance","High absence count")),
   Map.of("id","I3","name","Assignment catch-up","description","Break pending assignments into small milestones with tutor support","forIndicators",List.of("Incomplete assignments")),
   Map.of("id","I4","name","Peer learning group","description","Offer optional peer study sessions and subject-specific help","forIndicators",List.of("Low internal marks","Incomplete assignments"))
  );
 }
}
