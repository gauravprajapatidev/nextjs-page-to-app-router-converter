export type ConfidenceLevel = "safe" | "review" | "unsupported";

export type ConfidenceResult = {
  file: string;
  confidence: ConfidenceLevel;
  reasons: string[];
};
