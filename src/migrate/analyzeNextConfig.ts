import fs from "fs-extra";
import path from "path";
import { parse as parseJS } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

// @ts-ignore - babel traverse has ESM/CJS compatibility issues
const traverse = traverseModule.default || traverseModule;

export interface ConfigRedirect {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
  basePath?: boolean;
  locale?: boolean;
  has?: any[];
  missing?: any[];
}

export interface ConfigRewrite {
  source: string;
  destination: string;
  basePath?: boolean;
  locale?: boolean;
  has?: any[];
  missing?: any[];
}

export interface ConfigAnalysisResult {
  hasRedirects: boolean;
  hasRewrites: boolean;
  redirects: ConfigRedirect[];
  rewrites:
    | ConfigRewrite[]
    | {
        beforeFiles?: ConfigRewrite[];
        afterFiles?: ConfigRewrite[];
        fallback?: ConfigRewrite[];
      };
  warnings: string[];
  suggestions: string[];
  isCompatible: boolean;
}

/**
 * Analyzes next.config.js/mjs for redirects and rewrites
 * Provides compatibility guidance for App Router
 */
export function analyzeNextConfig(projectPath: string): ConfigAnalysisResult {
  const result: ConfigAnalysisResult = {
    hasRedirects: false,
    hasRewrites: false,
    redirects: [],
    rewrites: [],
    warnings: [],
    suggestions: [],
    isCompatible: true,
  };

  // Look for next.config.js or next.config.mjs
  const possibleConfigFiles = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
  ];

  let configPath: string | null = null;
  for (const configFile of possibleConfigFiles) {
    const testPath = path.join(projectPath, configFile);
    if (fs.existsSync(testPath)) {
      configPath = testPath;
      break;
    }
  }

  if (!configPath) {
    // No config file found - this is OK
    return result;
  }

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const configFileName = path.basename(configPath);

    // Parse the config file
    const ast = parseJS(content, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });

    // Track if we find redirects or rewrites functions
    let foundRedirects = false;
    let foundRewrites = false;

    traverse(ast, {
      // Look for redirects() or rewrites() function inside the config
      ObjectProperty(path: NodePath<t.ObjectProperty>) {
        const key = path.node.key;

        // Check for redirects
        if (
          (t.isIdentifier(key) && key.name === "redirects") ||
          (t.isStringLiteral(key) && key.value === "redirects")
        ) {
          foundRedirects = true;
          result.hasRedirects = true;

          // Try to extract redirect patterns if it's a function
          if (
            t.isArrowFunctionExpression(path.node.value) ||
            t.isFunctionExpression(path.node.value)
          ) {
            result.suggestions.push(
              "Redirects configuration found in next.config.js. These work the same in App Router.",
            );
          }
        }

        // Check for rewrites
        if (
          (t.isIdentifier(key) && key.name === "rewrites") ||
          (t.isStringLiteral(key) && key.value === "rewrites")
        ) {
          foundRewrites = true;
          result.hasRewrites = true;

          result.suggestions.push(
            "Rewrites configuration found in next.config.js. These work the same in App Router.",
          );
        }
      },
    });

    // Add general compatibility notes
    if (foundRedirects) {
      result.suggestions.push(
        "✓ Redirects: No changes needed - redirects work identically in App Router",
      );
      result.suggestions.push(
        "  - Pattern matching with :param and * wildcards still work",
      );
      result.suggestions.push(
        "  - Header/cookie matching (has/missing) still work",
      );
      result.suggestions.push(
        "  - Consider using redirect() from 'next/navigation' for programmatic redirects in Server Components",
      );
    }

    if (foundRewrites) {
      result.suggestions.push(
        "✓ Rewrites: No changes needed - rewrites work identically in App Router",
      );
      result.suggestions.push(
        "  - beforeFiles, afterFiles, and fallback arrays still work",
      );
      result.suggestions.push(
        "  - Pattern matching and header/cookie matching still work",
      );
    }

    // Check for potential issues with dynamic routes in App Router
    if (foundRedirects || foundRewrites) {
      result.suggestions.push(
        "⚠️  Note: If redirects/rewrites target dynamic routes, ensure your App Router routes use the correct folder structure:",
      );
      result.suggestions.push("  - /blog/:slug → app/blog/[slug]/page.tsx");
      result.suggestions.push(
        "  - /blog/:category/:slug → app/blog/[category]/[slug]/page.tsx",
      );
    }

    // Warn about potential middleware conflicts
    const middlewarePath = [
      "middleware.ts",
      "middleware.js",
      "middleware.tsx",
      "middleware.jsx",
    ]
      .map((f) => path.join(projectPath, f))
      .find((p) => fs.existsSync(p));

    if (middlewarePath && (foundRedirects || foundRewrites)) {
      result.warnings.push(
        "You have both middleware and config-based redirects/rewrites. Be aware of execution order:",
      );
      result.warnings.push("  1. Headers from next.config.js");
      result.warnings.push("  2. Redirects from next.config.js");
      result.warnings.push("  3. Middleware (headers, rewrites, redirects)");
      result.warnings.push("  4. beforeFiles rewrites from next.config.js");
      result.warnings.push(
        "  5. Filesystem routes (pages, static files, etc.)",
      );
      result.warnings.push("  6. afterFiles rewrites from next.config.js");
      result.warnings.push("  7. Fallback rewrites from next.config.js");
    }

    // Overall compatibility
    result.isCompatible = true;

    if (!foundRedirects && !foundRewrites) {
      result.suggestions.push(
        "No redirects or rewrites found in next.config.js",
      );
    }
  } catch (error: any) {
    result.warnings.push(`Could not parse ${configPath}: ${error.message}`);
    result.warnings.push("Manual review of next.config.js is recommended");
    result.isCompatible = false;
  }

  return result;
}

/**
 * Print analysis results to console
 */
export function printConfigAnalysis(analysis: ConfigAnalysisResult): void {
  if (!analysis.hasRedirects && !analysis.hasRewrites) {
    return; // Nothing to report
  }

  console.log("\n📝 Next.js Configuration Analysis:");
  console.log("─".repeat(50));

  if (analysis.suggestions.length > 0) {
    analysis.suggestions.forEach((suggestion) => {
      console.log(`  ${suggestion}`);
    });
  }

  if (analysis.warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    analysis.warnings.forEach((warning) => {
      console.log(`  ${warning}`);
    });
  }

  console.log("─".repeat(50));
  console.log();
}
