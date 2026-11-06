package com.shikshasetu.service;

import org.springframework.stereotype.Service;
import java.util.Locale;

/**
 * Lightweight, transparent student-support response rules. Tone and topic labels are
 * rough language cues only; they are not diagnoses or a trained emotion classifier.
 */
@Service
public class EmpatheticChatService {
    public record Result(String topic, String sentiment, String reply) {}

    public Result respond(String message) {
        String q = message == null ? "" : message.toLowerCase(Locale.ROOT);
        String sentiment = sentiment(q);
        String topic = topic(q);
        String empathy = switch (sentiment) {
            case "STRESSED" -> "It sounds like you have a lot on your plate right now. You do not have to solve everything at once. ";
            case "FRUSTRATED" -> "That sounds frustrating, and it is okay to find this difficult. Let's take it one step at a time. ";
            case "CONFUSED" -> "It is completely okay to feel unsure while learning something new. We can break it into smaller steps. ";
            case "POSITIVE" -> "I’m glad you’re making progress. Give yourself credit for the effort you’re putting in. ";
            default -> "Thanks for sharing that with me. ";
        };
        String guidance = switch (topic) {
            case "MATHEMATICS" -> "Tell me the exact question or the step where you got stuck. I can explain the idea first, then work through an example with you.";
            case "SCIENCE" -> "Share the concept or question you are working on. We can start with the basic idea, connect it to an example, and then practise together.";
            case "PROGRAMMING" -> "Share the code, error message, or concept you are working on. We can trace it carefully and build the solution step by step.";
            case "EXAMS" -> "Start by choosing one topic and a realistic study block. I can help you make a revision plan, practise questions, and review mistakes.";
            case "ASSIGNMENTS" -> "Choose the smallest useful next action, such as reading the prompt or completing one section. We can split the assignment into manageable milestones.";
            case "ATTENDANCE" -> "Attendance can be affected by many circumstances. It may help to identify any practical barriers and discuss support options with someone you trust at your institution.";
            case "STRESS_SUPPORT" -> "Your wellbeing matters more than finishing every task immediately. Consider pausing, taking a few slow breaths, and reaching out to a trusted person, teacher, counsellor, or campus support service. If you feel in immediate danger, contact local emergency support now.";
            default -> "I can help with concepts, revision, study planning, coding, assignments, and understanding academic progress. What would you like to work through first?";
        };
        return new Result(topic, sentiment, empathy + guidance);
    }

    private String sentiment(String q) {
        if (matches(q, "overwhelmed", "stressed", "anxious", "anxiety", "panic", "too much", "can't cope", "cannot cope", "burnt out", "burned out", "worried", "nervous", "scared", "exhausted")) return "STRESSED";
        if (matches(q, "frustrated", "angry", "annoyed", "fed up", "hate this", "giving up", "so difficult", "so hard")) return "FRUSTRATED";
        if (matches(q, "confused", "don't understand", "do not understand", "not getting", "stuck", "unclear", "lost", "makes no sense", "can't figure out")) return "CONFUSED";
        if (matches(q, "thank you", "thanks", "did it", "understood", "got it", "excited", "happy", "great", "proud of myself")) return "POSITIVE";
        return "NEUTRAL";
    }

    private String topic(String q) {
        if (matches(q, "suicid", "self harm", "self-harm", "hurt myself", "end my life", "kill myself", "want to die", "don't want to live", "do not want to live", "end it all", "unsafe", "abuse")) return "STRESS_SUPPORT";
        if (matches(q, "java", "python", "code", "coding", "program", "debug", "compiler", "algorithm", "data structure", "dsa", "spring boot", "sql", "database", "maven", "git", "api")) return "PROGRAMMING";
        if (matches(q, "math", "algebra", "calculus", "equation", "probability", "integral", "derivative", "matrix", "statistics")) return "MATHEMATICS";
        if (matches(q, "physics", "chemistry", "biology", "science", "thermodynamics", "mechanics", "organic chemistry")) return "SCIENCE";
        if (matches(q, "exam", "test", "revision", "study plan", "semester", "prepare", "preparation", "quiz")) return "EXAMS";
        if (matches(q, "assignment", "homework", "submission", "project", "deadline")) return "ASSIGNMENTS";
        if (matches(q, "attendance", "absence", "absent", "present")) return "ATTENDANCE";
        return "GENERAL";
    }

    private boolean matches(String text, String... terms) {
        for (String term : terms) {
            if (text.contains(term)) return true;
        }
        return false;
    }
}
