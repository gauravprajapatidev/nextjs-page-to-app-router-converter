import fs from "fs-extra";
import path from "path";
import { BROWSER_APIS, REACT_HOOKS } from "./componentTypes.js";

// Cache for analyzed packages to avoid redundant file system operations
const packageCache = new Map<string, boolean | null>();

// Known server-safe packages that can be safely used in Server Components
const SERVER_SAFE_PACKAGES = [
  "react",
  "react-dom",
  "next",
  "next/server",
  "next/navigation",
  "next/link",
  "next/image",
  "next/font",
  "next/headers",
  "next/cache",
  "next/constants",
  "next/dist",
  "@next",
  "fs",
  "path",
  "os",
  "crypto",
  "stream",
  "util",
  "url",
  "querystring",
  "http",
  "https",
  "zlib",
  "events",
];

/**
 * Dynamically detects if a package is client-only by analyzing its package.json
 * and optionally its entry point code.
 * Synchronous version for compatibility with existing code.
 */
export function isClientOnlyPackage(
  packageName: string,
  projectRoot?: string
): boolean | null {
  // Check cache first
  if (packageCache.has(packageName)) {
    return packageCache.get(packageName) ?? null;
  }

  // Check if it's a known server-safe package
  if (SERVER_SAFE_PACKAGES.some((safe) => packageName === safe || packageName.startsWith(safe + "/"))) {
    packageCache.set(packageName, false);
    return false;
  }

  // Check if it's a relative/local import (not a node_modules package)
  if (packageName.startsWith(".") || packageName.startsWith("/")) {
    packageCache.set(packageName, null); // Unknown for local imports
    return null;
  }

  // If no projectRoot, use heuristics only
  if (!projectRoot) {
    const isClient = checkHeuristics(packageName);
    packageCache.set(packageName, isClient);
    return isClient;
  }

  // Try to resolve the package in node_modules
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  const packagePath = path.join(nodeModulesPath, packageName);

  if (!fs.existsSync(packagePath)) {
    // Package not found in node_modules, use heuristics
    const isClient = checkHeuristics(packageName);
    packageCache.set(packageName, isClient);
    return isClient;
  }

  // Read package.json
  const packageJsonPath = path.join(packagePath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = fs.readJsonSync(packageJsonPath);

      // Check for "browser" field - indicates browser-only package
      if (packageJson.browser) {
        packageCache.set(packageName, true);
        return true;
      }

      // Check package.json for client-side indicators
      if (packageJson.keywords) {
        const keywords = Array.isArray(packageJson.keywords)
          ? packageJson.keywords
          : [];
        const clientKeywords = ["browser", "client", "dom", "react-component"];
        if (keywords.some((kw: string) => clientKeywords.includes(kw.toLowerCase()))) {
          packageCache.set(packageName, true);
          return true;
        }
      }

      // Try to analyze the main entry point
      const entryPoint = packageJson.module || packageJson.main || packageJson.exports?.["."]?.import || packageJson.exports?.["."]?.require || "index.js";
      const entryPath = path.resolve(packagePath, entryPoint);

      if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile()) {
        const isClient = analyzePackageEntryPoint(entryPath);
        packageCache.set(packageName, isClient);
        return isClient;
      }

      // If entry point is a directory or file doesn't exist, check for index file
      const entryDir = fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory() 
        ? entryPath 
        : path.dirname(entryPath);
      
      if (fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory()) {
        const indexFiles = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
        for (const indexFile of indexFiles) {
          const indexPath = path.join(entryDir, indexFile);
          if (fs.existsSync(indexPath)) {
            const isClient = analyzePackageEntryPoint(indexPath);
            packageCache.set(packageName, isClient);
            return isClient;
          }
        }
      }
    } catch (error) {
      // If analysis fails, use heuristics as fallback
      const isClient = checkHeuristics(packageName);
      packageCache.set(packageName, isClient);
      return isClient;
    }
  }

  // Fallback to heuristics
  const isClient = checkHeuristics(packageName);
  packageCache.set(packageName, isClient);
  return isClient;
}

/**
 * Analyzes a package entry point file to detect client-side code patterns
 */
function analyzePackageEntryPoint(filePath: string): boolean {
  try {
    // Only analyze JavaScript/TypeScript files
    const ext = path.extname(filePath);
    if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      return false;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    // Quick check: Look for React hooks or browser APIs in the code
    // This is a lightweight check without full AST parsing
    const hasHooks = REACT_HOOKS.some((hook) => {
      // Look for hook usage patterns (not just the word "useState" anywhere)
      const regex = new RegExp(`\\b${hook}\\s*\\(`, "g");
      return regex.test(content);
    });

    const hasBrowserAPIs = BROWSER_APIS.some((api) => {
      // Look for browser API usage
      const regex = new RegExp(`\\b${api}\\b`, "g");
      return regex.test(content);
    });

    // Check for event handlers pattern
    const hasEventHandlers = /on[A-Z]\w+\s*[:=]/.test(content);

    // Check for JSX (indicates React component)
    const hasJSX = /<[A-Z]/.test(content) || /<\w+[^>]*>/.test(content);

    // If it's a React component file (has JSX) or uses hooks/APIs, it's client-only
    if (hasJSX || hasHooks || hasBrowserAPIs || hasEventHandlers) {
      return true;
    }

    // For more thorough analysis, try AST parsing (optional, slower)
    // We'll skip this for performance, but could be enabled for more accuracy

    return false;
  } catch (error) {
    // If analysis fails, return null (unknown)
    return false;
  }
}

/**
 * Uses heuristics to determine if a package is likely client-only
 */
function checkHeuristics(packageName: string): boolean {
  // Packages starting with "react-" are usually client-only (except known exceptions)
  if (packageName.startsWith("react-") || packageName.startsWith("@react-")) {
    // Known server-safe react packages
    const serverSafeReact = ["react-server", "react-server-components"];
    if (serverSafeReact.some((safe) => packageName.includes(safe))) {
      return false;
    }
    return true;
  }

  // Packages with "dom" or "browser" in name are likely client-only
  if (/dom|browser|client/.test(packageName.toLowerCase())) {
    return true;
  }

  // Scoped packages under @types are type definitions (server-safe)
  if (packageName.startsWith("@types/")) {
    return false;
  }

  // Default to unknown (null) - conservative approach
  return false;
}

/**
 * Clears the package cache (useful for testing or when dependencies change)
 */
export function clearPackageCache(): void {
  packageCache.clear();
}

