import { DetectionResult } from "./detectionTypes.js";
import { ConfidenceResult } from "./confidenceTypes.js";

export function classifyConfidence(
  detection: DetectionResult
): ConfidenceResult {
  const reasons: string[] = [];

  const dataFetchingCount = [
    detection.hasGSSP,
    detection.hasGSP,
    detection.hasGSPPaths,
  ].filter(Boolean).length;

  // Unsupported: multiple data fetching methods
  if (dataFetchingCount > 1) {
    reasons.push("Multiple data-fetching methods detected");
    return {
      file: detection.file,
      confidence: "unsupported",
      reasons,
    };
  }

  // Needs manual review
  if (
    detection.hasGSSP ||
    detection.hasGSP ||
    detection.hasGSPPaths ||
    detection.usesUseRouter
  ) {
    if (detection.hasGSSP)
      reasons.push("Uses getServerSideProps");
    if (detection.hasGSP)
      reasons.push("Uses getStaticProps");
    if (detection.hasGSPPaths)
      reasons.push("Uses getStaticPaths");
    if (detection.usesUseRouter)
      reasons.push("Uses useRouter");

    return {
      file: detection.file,
      confidence: "review",
      reasons,
    };
  }

  // Safe
  return {
    file: detection.file,
    confidence: "safe",
    reasons: ["No migration blockers detected"],
  };
}
