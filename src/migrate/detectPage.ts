import path from "path";
import { detectTS } from "./detectTS.js";
import { detectJS } from "./detectJS.js";
import { DetectionResult } from "./detectionTypes.js";

export function detectPage(filePath: string): DetectionResult {
  const ext = path.extname(filePath);

  if (ext === ".ts" || ext === ".tsx") {
    return detectTS(filePath);
  }

  return detectJS(filePath);
}
