package com.shikshasetu.service;

import com.shikshasetu.repo.ChatInteractionRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;

@Component
public class ChatRetentionJob {
    private final ChatInteractionRepository chats;

    public ChatRetentionJob(ChatInteractionRepository chats) {
        this.chats = chats;
    }

    @Scheduled(cron = "0 20 3 * * *")
    @Transactional
    public void purgeExpired() {
        chats.deleteByExpiresAtBefore(LocalDateTime.now());
    }
}
