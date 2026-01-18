import fs from "fs-extra";
import path from "path";
import type { PageFile } from "./scanPages.js";

/**
 * Generates a loading.tsx file for a given page route
 * Loading files are optional but recommended for better UX during page transitions
 */
export async function generateLoadingFile(
  pagePath: string,
  page: PageFile,
  options: { dryRun?: boolean; useTypeScript: boolean }
): Promise<boolean> {
  // loading.tsx should be in the same directory as page.tsx
  // e.g., app/about/page.tsx -> app/about/loading.tsx
  const loadingDir = path.dirname(pagePath);
  const extension = options.useTypeScript ? "tsx" : "js";
  const loadingPath = path.join(loadingDir, `loading.${extension}`);

  // Skip if loading.tsx already exists
  if (fs.existsSync(loadingPath)) {
    return false; // Already exists
  }

  // Generate a simple loading component
  // This is a basic template that users can customize
  const content = `export default function Loading() {
  // You can customize this loading UI to match your design
  // For example, add a spinner, skeleton, or custom loading animation
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <p>Loading...</p>
    </div>
  );
}
`;

  if (options.dryRun) {
    return true; // Simulate creation
  }

  await fs.ensureDir(loadingDir);
  await fs.writeFile(loadingPath, content);

  return true;
}
