package com.shikshasetu.service;

import com.shikshasetu.model.ChatInteraction;
import com.shikshasetu.repo.ChatInteractionRepository;
import org.springframework.stereotype.Service;
import weka.clusterers.SimpleKMeans;
import weka.core.Attribute;
import weka.core.DenseInstance;
import weka.core.Instances;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Fits an unsupervised Weka activity model on retained interaction metadata.
 * Message contents and sentiment labels are intentionally excluded from the feature vector.
 * The resulting bands describe usage frequency only; they are not academic or wellbeing scores.
 */
@Service
public class ChatEngagementAnalyticsService {
    public record StudentEngagement(Long studentId, int interactions, int activeDays,
                                    int distinctTopics, int averageMessageLength,
                                    String activityBand) {}

    private record Activity(Long studentId, int interactions, int activeDays,
                            int distinctTopics, int averageMessageLength) {}

    private final ChatInteractionRepository chats;

    public ChatEngagementAnalyticsService(ChatInteractionRepository chats) {
        this.chats = chats;
    }

    public List<StudentEngagement> analyseInstitution(Long institutionId, int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(Math.max(1, Math.min(days, 180)));
        List<ChatInteraction> interactions = chats.findByInstitutionIdAndCreatedAtAfterAndExpiresAtAfter(institutionId, since, LocalDateTime.now());
        Map<Long, List<ChatInteraction>> grouped = interactions.stream()
            .filter(row -> row.getStudentId() != null)
            .collect(Collectors.groupingBy(ChatInteraction::getStudentId, TreeMap::new, Collectors.toList()));

        List<Activity> activity = grouped.entrySet().stream().map(entry -> {
            List<ChatInteraction> rows = entry.getValue();
            int activeDays = (int) rows.stream().map(x -> x.getCreatedAt().toLocalDate()).distinct().count();
            int topics = (int) rows.stream().map(ChatInteraction::getTopic).distinct().count();
            int averageLength = (int) Math.round(rows.stream().mapToInt(x -> x.getUserMessage().length()).average().orElse(0));
            return new Activity(entry.getKey(), rows.size(), activeDays, topics, averageLength);
        }).toList();

        Map<Long, String> bands = fitActivityClusters(activity);
        return activity.stream().map(row -> new StudentEngagement(row.studentId(), row.interactions(),
            row.activeDays(), row.distinctTopics(), row.averageMessageLength(),
            bands.getOrDefault(row.studentId(), "INSUFFICIENT_COHORT_DATA"))).toList();
    }

    public Optional<StudentEngagement> analyseStudent(Long institutionId, Long studentId, int days) {
        return analyseInstitution(institutionId, days).stream()
            .filter(row -> Objects.equals(row.studentId(), studentId)).findFirst();
    }

    private Map<Long, String> fitActivityClusters(List<Activity> activity) {
        if (activity.size() < 3) return Map.of();
        try {
            int maxInteractions = activity.stream().mapToInt(Activity::interactions).max().orElse(1);
            int maxActiveDays = activity.stream().mapToInt(Activity::activeDays).max().orElse(1);
            ArrayList<Attribute> attributes = new ArrayList<>();
            attributes.add(new Attribute("interaction_frequency"));
            attributes.add(new Attribute("active_days"));
            attributes.add(new Attribute("topic_diversity"));
            attributes.add(new Attribute("average_message_length"));
            Instances instances = new Instances("institution_chat_activity", attributes, activity.size());
            for (Activity row : activity) {
                instances.add(new DenseInstance(1.0, new double[] {
                    (double) row.interactions() / Math.max(1, maxInteractions),
                    (double) row.activeDays() / Math.max(1, maxActiveDays),
                    (double) row.distinctTopics() / 7.0,
                    Math.min(1.0, (double) row.averageMessageLength() / 1000.0)
                }));
            }
            SimpleKMeans model = new SimpleKMeans();
            model.setNumClusters(Math.min(3, activity.size()));
            model.setSeed(42);
            model.setMaxIterations(100);
            model.setPreserveInstancesOrder(true);
            model.buildClusterer(instances);

            Instances centroids = model.getClusterCentroids();
            Map<Integer, Double> activityScores = new HashMap<>();
            for (int cluster = 0; cluster < centroids.numInstances(); cluster++) {
                var centre = centroids.instance(cluster);
                double score = 0.55 * centre.value(0) + 0.25 * centre.value(1)
                    + 0.15 * centre.value(2) + 0.05 * centre.value(3);
                activityScores.put(cluster, score);
            }
            List<Integer> ordered = activityScores.entrySet().stream()
                .sorted(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey).toList();
            Map<Integer, String> labels = new HashMap<>();
            String[] bandNames = ordered.size() == 2
                ? new String[] {"LOWER_ACTIVITY", "HIGHER_ACTIVITY"}
                : new String[] {"LOWER_ACTIVITY", "STEADY_ACTIVITY", "HIGHER_ACTIVITY"};
            for (int i = 0; i < ordered.size(); i++) labels.put(ordered.get(i), bandNames[i]);

            Map<Long, String> result = new HashMap<>();
            for (int i = 0; i < activity.size(); i++) {
                int cluster = model.clusterInstance(instances.instance(i));
                result.put(activity.get(i).studentId(), labels.getOrDefault(cluster, "UNCLASSIFIED"));
            }
            return result;
        } catch (Exception ex) {
            // The usage dashboard remains available even if the optional clustering step fails.
            return Map.of();
        }
    }
}
