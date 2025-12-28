import fs from "fs-extra";
import path from "path";
import chalk from "chalk";

const MIN_NEXT_VERSION = "13.0.0";
const RECOMMENDED_NEXT_VERSION = "14.0.0";

export function checkDependencies(projectPath: string): { success: boolean; warnings: string[] } {
  const packageJsonPath = path.join(projectPath, "package.json");
  const warnings: string[] = [];

  if (!fs.existsSync(packageJsonPath)) {
    return { success: true, warnings: ["No package.json found. Skipping dependency check."] };
  }

  try {
    const pkg = fs.readJsonSync(packageJsonPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const nextVersion = deps.next;
    if (nextVersion) {
      // Very naive version comparison for MVP
      const major = parseInt(nextVersion.replace(/[^0-9.]/g, "").split(".")[0]);
      if (major < 13) {
        warnings.push(`Next.js version ${nextVersion} is below 13. App Router requires at least Next.js 13.`);
      } else if (major < 14) {
        warnings.push(`Next.js version ${nextVersion} is supported but version 14+ is recommended for stable App Router features.`);
      }
    } else {
        warnings.push("Next.js not found in dependencies.");
    }

    const reactVersion = deps.react;
    if (reactVersion) {
        const major = parseInt(reactVersion.replace(/[^0-9.]/g, "").split(".")[0]);
        if (major < 18) {
            warnings.push(`React version ${reactVersion} is below 18. App Router requires React 18+.`);
        }
    }

  } catch (e) {
    return { success: false, warnings: ["Failed to parse package.json"] };
  }

  return { success: true, warnings };
}
