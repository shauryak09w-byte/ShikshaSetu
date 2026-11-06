# ShikshaSetu — AI Model Research & Technical Design

**Prepared:** 5 November 2026  
**Scope:** Student early-warning / academic-support loop shown in the Mentor Support Loop diagram.

## Executive decision

The first deployable ML component is a **supervised tabular classifier** implemented in the existing Java/Spring Boot stack with Weka Random Forest. It estimates one narrow, observable future outcome: whether a student's next non-overlapping reporting-period subject-average mark falls by at least 10 percentage points compared with the current-period average. It is **not** a universal measure of student risk, dropout probability, wellbeing, motivation, or learning ability.

This is an appropriate first model because the current ShikshaSetu records are structured tabular values (attendance, internal marks, assignment completion, prior failures, absences and dated academic trends). Recent reviews find that tree ensembles and other transparent classical ML approaches remain common and competitive for structured education data, while deep learning is more useful when sufficiently large, sequential data exists and is harder to interpret and operationalise. A 2026 review of 72 studies reports broad use of tree-based and neural approaches, with explainability still relatively under-adopted. Another 2026 synthesis of 126 studies reports that ensemble methods tend to suit medium-scale tabular datasets while sequential deep models need larger temporal datasets to justify their complexity. These are literature-level findings, not a guarantee of performance on ShikshaSetu data.

## Model component in this release

| Component | Current implementation | Meaning / limitation |
|---|---|---|
| Learner | Weka Random Forest | 300 trees, fixed seed 42, maximum depth 8, minimum leaf size 5 |
| Outcome | `next_period_deterioration` | 1 if next period's average falls by at least 10 percentage points; else 0 |
| Inputs | 8 academic / engagement features | Must all be known on or before the prediction snapshot |
| Grouping key | `student_key` | Pseudonymous split-only key; it is not a predictor |
| Holdout | Student-grouped 80/20 | Prevents the same pseudonymous student appearing in both partitions; still requires later-term and external validation |
| Metrics | Accuracy, precision, recall, F1, ROC AUC, confusion matrix | Do not rely on accuracy alone, especially if the outcome is imbalanced |
| Persistence | Serialized Weka model bundle | Model version, training timestamp, header and test metrics retained |
| Runtime | Separate `/api/ai/...` endpoints | The earlier rule-based assessment API remains available and unchanged |

### Feature contract

- `attendance_percent`
- `internal_marks_percent`
- `assignment_completion_percent`
- `previous_failures`
- `absence_count`
- `consecutive_absences`
- `recent_mark_drop`
- `repeated_low_results`

Names, email addresses, roll numbers, real student IDs, age, sex, caste, religion, disability, address, audit group, mood check-ins, counselling notes and sensitive wellbeing text are not model predictors. `auditGroup` remains a separate, optional fairness-audit dimension only. Voluntary mood check-ins remain outside the academic model.

## Data design and label validity

One CSV row represents one student at one snapshot date. Predictor values are frozen at that snapshot. The label is calculated only after the subsequent, non-overlapping reporting period is complete. It must not be derived from the previous rule-based score; doing so would train the ML model to reproduce that heuristic instead of learning an independently observed outcome.

The API requires at least 100 labelled snapshots, 30 distinct pseudonymous students, and at least five examples of each class in both partitions. These are code-level guards only; they do not establish a statistically adequate sample size. The training team should use substantially larger multi-term / multi-cohort data and document how each label was calculated.

Missing trend fields remain missing (`?` / blank); they are not converted to zero. Duplicates, data provenance, snapshot dates, institution/semester boundaries and measurement changes should be audited before upload. The current CSV trainer does not itself verify the academic source system's truth or compute labels from raw grade tables.

## Validation before any live deployment

The current grouped random holdout is an initial engineering check. A real release should add:

1. **Temporal validation:** train on earlier terms and test on a later untouched term; avoid features recorded after the prediction cut-off.
2. **External validation:** repeat at another cohort / program / institution before claiming generalisation.
3. **Class-imbalance reporting:** publish the positive-class rate, confusion matrix, precision, recall, F1 and precision-recall AUC alongside ROC AUC.
4. **Probability calibration:** calibrate only on an independent validation set; inspect reliability diagrams and Brier / log loss. Random Forest output probabilities must not be presented as calibrated confidence until this is done.
5. **Threshold analysis:** select intervention thresholds with mentors and students, considering false-negative and false-positive costs. Current 0.35 / 0.65 priority bands are placeholders, not institutional policy.
6. **Fairness review:** examine data coverage, false-positive / false-negative rates and calibration by lawful, institution-approved audit groups, with minimum cell-size and disclosure controls. Audit group data must never feed the individual's score.
7. **Monitoring:** track missingness, input drift, outcome drift, performance and intervention outcomes. Retraining requires versioning, review and rollback.
8. **Impact evaluation:** test whether the actual support loop improves student outcomes; predictive accuracy alone does not prove interventions work.

## Diagram mapping

1. **Identify early signals:** ML probability for the narrowly defined deterioration outcome plus separately visible recorded attendance / mark / assignment signals.
2. **Understand and explain:** show the prediction target, model version, observed input snapshot, missing-data notes and rule-generated warning signals. These are not causal explanations or SHAP feature attributions.
3. **Recommend personalised intervention:** the current service returns configurable support suggestions (learning support, attendance conversation, assignment catch-up, or strength-based goal). These are transparent templates triggered by observed feature thresholds, not generative model output.
4. **Connect to support:** a mentor must discuss and approve actions; the model does not contact, discipline, rank or restrict a student.
5. **Track improvement:** ML assessment snapshots are stored separately in `ai_assessments`; the existing mentor action and follow-up outcome workflow remains available.
6. **Repeat:** compare snapshots carefully; change in score is not proof that an intervention caused the change.
7. **Wellbeing:** voluntary mood data remains local/separate. Live emergency or safety routing is not implemented until an approved staffed human responder and escalation policy exist.

## Additional research implications

A 2026 PRISMA review of 72 student-performance studies reports frequent use of tree-based methods and neural networks, while explainable-AI adoption remains limited. A separate 2026 review of 126 studies reports that ensembles tend to fit medium-scale tabular data, whereas sequence-focused deep-learning models show their strongest comparative results when datasets are larger than 10,000 records and have temporal structure. This supports starting with a tabular ensemble on ShikshaSetu's current feature shape rather than claiming that a neural network is automatically more capable. It does **not** prove Random Forest is the best algorithm for this institution; compare it against regularised logistic regression and gradient-boosted trees on the same leakage-safe folds when a sufficiently large dataset exists.

A 2025 Journal of Learning Analytics study also highlights that prediction by itself is not enough: early-identification systems need timely, pedagogically grounded feedback/interventions. That is why ShikshaSetu's model is only one input to the review → select support → record action → follow up → compare loop, not an automatic decision engine.

## India-specific data-protection planning note (checked 5 November 2026)

The Gazette notifications for the Digital Personal Data Protection Act, 2023 and Digital Personal Data Protection Rules, 2025 use phased commencement. The Act notification is dated 13 November 2025: several provisions commenced on publication, some are scheduled one year later, and the main substantive provisions listed in the notification are scheduled eighteen months later (13 May 2027). The Rules notification of 13 November 2025 makes Rules 1, 2 and 17–21 effective immediately, Rule 4 effective after one year (13 November 2026), and Rules 3, 5–16, 22 and 23 effective after eighteen months (13 May 2027). This is a schedule summary, not legal advice; check later Gazette amendments and obtain institution-specific legal advice before processing real student records. The system should be designed now for clear purpose notices, appropriate consent / lawful processing, student rights, security controls, retention/deletion, grievance contact, processor agreements, incident response and additional controls for under-18 learners.

## What is not an AI model in this package

- The original heuristic score is a transparent rules baseline, not a trained model.
- Support-suggestion templates are deterministic rules, not a language model.
- The student chat box remains a frontend conversation preview; it is **not** backed by a production LLM in this release.
- The 24-image nature gallery is frontend visual behaviour, not part of the ML pipeline.

An LLM chat assistant should be developed as a separate service with strict student-data access control, grounding to approved resources, refusal/safety handling, redaction, human escalation and auditable prompts. It must not be conflated with the Random Forest deterioration classifier.

## Security / governance blockers

The included login is a frontend development preview. There is no production server-side authentication, row-level student authorisation, hardened model-upload permission, or deployment-grade audit pipeline. Do not upload identifiable or confidential student data to an exposed instance. Before real deployment: implement authentication and role-based access, encrypted transport and storage, institution-approved legal basis/consent, data-protection impact assessment, retention/deletion controls, secure backups, audit logs, penetration testing and incident response.

## Research basis

- Jisc, **Code of practice for learning analytics**, last updated 9 September 2026. Its guidance requires student benefit, transparency, validity, privacy, qualified human interpretation and supportive rather than punitive uses of predictions. https://www.jisc.ac.uk/guides/code-of-practice-for-learning-analytics
- Jisc, **The ethical application of AI in learning analytics**, 23 October 2026. The companion guidance emphasises human oversight, meaningful explanations and a route for students to question or correct data. https://www.jisc.ac.uk/news/all/the-ethical-application-of-ai-in-learning-analytics
- NIST, **AI Risk Management Framework 1.0**. Trustworthiness includes validity/reliability, safety, security/resilience, transparency/accountability, explainability, privacy and fairness. https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf
- Boujmiraz et al., **Predicting student performance: A comprehensive review of machine learning, deep learning, and explainable AI approaches**, 2026. Review of 72 studies. https://www.sciencedirect.com/science/article/pii/S2666920X26000093
- **Educational Data Mining and Machine Learning for Academic Performance Prediction: A Systematic Review and Critical Synthesis**, 2026. Review of 126 studies; its reported dataset-scale observations support a conservative tabular-first strategy. https://ieeexplore.ieee.org/abstract/document/11650473
- scikit-learn, **Probability calibration** documentation. Calibrators should be fit on data independent of the base model training data. https://scikit-learn.org/stable/modules/calibration.html
- Weka, **RandomForest** and **Evaluation** API references. https://weka.sourceforge.io/doc.dev/weka/classifiers/trees/RandomForest.html and https://weka.sourceforge.io/doc.dev/weka/classifiers/Evaluation.html
- Boujmiraz et al., 2026, 72-study systematic review of student-performance prediction and explainable AI. https://www.sciencedirect.com/science/article/pii/S2666920X26000093
- IEEE, 2026, **Educational Data Mining and Machine Learning for Academic Performance Prediction: A Systematic Review and Critical Synthesis** (126-study review). https://ieeexplore.ieee.org/abstract/document/11650473
- Dai et al., **Learning Analytics for Early Identification of At-Risk Students and Feedback Intervention**, *Journal of Learning Analytics* 12(3), 2025. https://eric.ed.gov/?id=EJ1492730
- Government of India, MeitY, Gazette notification G.S.R. 843(E), 13 November 2025, commencement schedule for the DPDP Act. https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
- Government of India, MeitY, Gazette notification G.S.R. 846(E), 13 November 2025, Digital Personal Data Protection Rules, 2025 and phased commencement. https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf

---

**Release statement:** This package contains a trainable ML pipeline, not a pretrained or validated institutional model. It is not trained until an approved, labelled longitudinal dataset is uploaded and the training endpoint completes successfully.
