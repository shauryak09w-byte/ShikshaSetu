package com.shikshasetu.service;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class EmpatheticChatServiceTest {
    private final EmpatheticChatService service = new EmpatheticChatService();

    @Test
    void respondsSupportivelyToConfusionAndAcademicTopics() {
        var result = service.respond("I am confused about this Java program");
        assertEquals("CONFUSED", result.sentiment());
        assertEquals("PROGRAMMING", result.topic());
        assertTrue(result.reply().toLowerCase().contains("step"));
    }

    @Test
    void recognisesStressAndOffersHumanSupport() {
        var result = service.respond("I feel overwhelmed and stressed about exams");
        assertEquals("STRESSED", result.sentiment());
        assertEquals("EXAMS", result.topic());
        assertTrue(result.reply().contains("study block"));
    }

    @Test
    void prioritisesSafetyTopicForSelfHarmPhrases() {
        var result = service.respond("I feel unsafe and want to hurt myself");
        assertEquals("STRESS_SUPPORT", result.topic());
        assertTrue(result.reply().contains("trusted person"));
    }
    @Test
    void recognisesWorryAndScienceQuestionsWithoutLabellingTheStudent() {
        var result = service.respond("I am nervous about physics and I do not understand mechanics");
        assertEquals("STRESSED", result.sentiment());
        assertEquals("SCIENCE", result.topic());
        assertTrue(result.reply().contains("basic idea"));
    }

    @Test
    void recognisesCommonProgrammingStackTerms() {
        var result = service.respond("I am stuck with a Spring Boot API and SQL database error");
        assertEquals("CONFUSED", result.sentiment());
        assertEquals("PROGRAMMING", result.topic());
        assertTrue(result.reply().contains("step by step"));
    }

}
