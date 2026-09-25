# Evaluation — Review Copilot V2

This directory contains labeled evaluation cases for measuring review quality.

## Structure

```
evaluation/
├── development/    # Cases used during development and tuning
├── held-out/       # Cases NOT used during development — for independent quality measurement
└── README.md       # This file
```

## Important rules

1. **Do not tune prompts on held-out cases.** If a held-out case reveals a bug, fix the underlying logic, then re-run independently on the remaining held-out set.
2. **Separate labels from predictions.** Labels describe expected findings with supporting evidence.
3. **Report sample sizes and uncertainty.** Never claim quality from a single case.
4. **Acceptance feedback is not proof of correctness.** A reviewer saying "looks good" does not validate finding accuracy.

## Metrics tracked

| Metric | Measurement method | Notes |
|---|---|---|
| Precision (findings) | Confirmed / (confirmed + rejected) per labeled set | Only where reliable ground truth exists |
| Acceptance rate | Human reviewer accepted finding / total confirmed | Feedback, not ground truth |
| Incomplete review rate | Runs with `incomplete` conclusion / total runs | Tracks coverage gaps |
| Escaped defect rate | Defects found post-merge not caught by review | Requires post-merge tracking |
| Latency | Wall-clock time per stage | Measured from logs |
| Model cost | Tokens used per run | Where usage data available |

## Case format

Each case is a directory containing:

```
case-name/
├── metadata.json      # PR metadata (untrusted input)
├── files/             # Changed files (synthetic or anonymized)
├── diffs/             # Unified diffs
├── expected.json      # Expected findings and conclusions
└── README.md          # Case description and rationale
```

### expected.json schema

```json
{
  "caseId": "unique-case-id",
  "description": "What this case tests",
  "expectedRiskLevel": "high|medium|low",
  "expectedConclusions": ["changes_required", ...],
  "expectedFindings": [
    {
      "id": "finding-label-id",
      "underlyingCause": "expected cause key",
      "categories": ["security"],
      "severity": "high",
      "mergeImpact": "blocking",
      "mustBePresent": true,
      "evidence": "Why this finding is expected",
      "acceptableUncertainty": "What would make it acceptable to miss this"
    }
  ],
  "knownLimitations": ["list of known analysis gaps for this case"],
  "evaluationNotes": "Free-form notes about this case"
}
```
