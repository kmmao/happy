import { t } from "@/text";

import { SessionTimingDiagnosisCode } from "./[id]/sessionTimingDiagnostics";

export function getSessionTimingDiagnosisLabel(
  code: SessionTimingDiagnosisCode,
): string {
  switch (code) {
    case "low_confidence":
      return t("sessionInfo.requestTimingDiagnosisLowConfidence");
    case "queue_wait":
      return t("sessionInfo.requestTimingDiagnosisQueue");
    case "ttft":
      return t("sessionInfo.requestTimingDiagnosisTtft");
    case "generation_tail":
      return t("sessionInfo.requestTimingDiagnosisGeneration");
    case "balanced":
      return t("sessionInfo.requestTimingDiagnosisBalanced");
  }
}

export function getSessionTimingDiagnosisHint(
  code: SessionTimingDiagnosisCode,
): string {
  switch (code) {
    case "low_confidence":
      return t("sessionInfo.requestTimingDiagnosisLowConfidenceHint");
    case "queue_wait":
      return t("sessionInfo.requestTimingDiagnosisQueueHint");
    case "ttft":
      return t("sessionInfo.requestTimingDiagnosisTtftHint");
    case "generation_tail":
      return t("sessionInfo.requestTimingDiagnosisGenerationHint");
    case "balanced":
      return t("sessionInfo.requestTimingDiagnosisBalancedHint");
  }
}

export function getSessionTimingDiagnosisAction(
  code: SessionTimingDiagnosisCode,
): string {
  switch (code) {
    case "low_confidence":
      return t("sessionInfo.requestTimingDiagnosisLowConfidenceAction");
    case "queue_wait":
      return t("sessionInfo.requestTimingDiagnosisQueueAction");
    case "ttft":
      return t("sessionInfo.requestTimingDiagnosisTtftAction");
    case "generation_tail":
      return t("sessionInfo.requestTimingDiagnosisGenerationAction");
    case "balanced":
      return t("sessionInfo.requestTimingDiagnosisBalancedAction");
  }
}
