import { Project, SyntaxKind, SourceFile, Node } from "ts-morph";
import path from "path";
import fs from "fs-extra";
import {
  ComponentAnalysis,
  ClientIndicators,
  CLIENT_ONLY_LIBRARIES,
  BROWSER_APIS,
  REACT_HOOKS,
} from "./componentTypes.js";
import { isClientOnlyPackage } from "./detectClientPackage.js";

/**
 * Analyzes a component file to determine if it should be a client or server component
 */
export function analyzeComponentFile(
  filePath: string,
  projectRoot?: string
): ComponentAnalysis {
  const project = new Project({
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
      jsx: 1, // Preserve
    },
    useInMemoryFileSystem: false,
  });

  let sourceFile: SourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(filePath);
  } catch (error) {
    // If file doesn't exist or can't be parsed, return unknown
    return {
      filePath,
      classification: "unknown",
      reasons: [`Failed to parse file: ${error}`],
      hasHooks: false,
      hasEventHandlers: false,
      hasBrowserAPIs: false,
      hasClientLibraries: false,
      importedComponents: [],
      confidence: "low",
    };
  }

  const indicators: ClientIndicators = {
    hooks: [],
    eventHandlers: [],
    browserAPIs: [],
    clientLibraries: [],
  };

  // Detect React hooks
  const hooks = detectReactHooks(sourceFile);
  indicators.hooks = hooks;

  // Detect event handlers in JSX
  const eventHandlers = detectEventHandlers(sourceFile);
  indicators.eventHandlers = eventHandlers;

  // Detect browser APIs
  const browserAPIs = detectBrowserAPIs(sourceFile);
  indicators.browserAPIs = browserAPIs;

  // Detect client-only libraries
  const clientLibraries = detectClientLibraries(sourceFile, projectRoot);
  indicators.clientLibraries = clientLibraries;

  // Analyze imported components (if projectRoot provided)
  const importedComponents: ComponentAnalysis[] = [];
  if (projectRoot) {
    const imports = analyzeImportedComponents(
      sourceFile,
      projectRoot,
      filePath
    );
    importedComponents.push(...imports);
  }

  // Determine classification
  const hasHooks = indicators.hooks.length > 0;
  const hasEventHandlers = indicators.eventHandlers.length > 0;
  const hasBrowserAPIs = indicators.browserAPIs.length > 0;
  const hasClientLibraries = indicators.clientLibraries.length > 0;

  const isClient =
    hasHooks || hasEventHandlers || hasBrowserAPIs || hasClientLibraries;

  // Check if any imported component is a client component
  const hasClientImports = importedComponents.some(
    (comp) => comp.classification === "client"
  );

  const reasons: string[] = [];
  if (hasHooks)
    reasons.push(`Uses React hooks: ${indicators.hooks.join(", ")}`);
  if (hasEventHandlers)
    reasons.push(`Uses event handlers: ${indicators.eventHandlers.join(", ")}`);
  if (hasBrowserAPIs)
    reasons.push(`Uses browser APIs: ${indicators.browserAPIs.join(", ")}`);
  if (hasClientLibraries)
    reasons.push(
      `Imports client-only libraries: ${indicators.clientLibraries.join(", ")}`
    );
  if (hasClientImports)
    reasons.push(
      `Imports client components: ${importedComponents
        .filter((c) => c.classification === "client")
        .map((c) => path.basename(c.filePath))
        .join(", ")}`
    );

  // Determine confidence level
  let confidence: "high" | "medium" | "low" = "high";
  if (reasons.length === 0) {
    confidence = "high"; // High confidence it's a server component
  } else if (reasons.length === 1 && hasClientImports) {
    confidence = "medium"; // Medium confidence if only importing client components
  }

  return {
    filePath,
    classification: isClient || hasClientImports ? "client" : "server",
    reasons,
    hasHooks,
    hasEventHandlers,
    hasBrowserAPIs,
    hasClientLibraries,
    importedComponents,
    confidence,
  };
}

/**
 * Detects React hooks usage in the source file
 */
function detectReactHooks(sourceFile: SourceFile): string[] {
  const hooks = new Set<string>();

  // Find all call expressions
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expression = call.getExpression();
    const text = expression.getText();

    // Check if it's a known React hook
    if (REACT_HOOKS.includes(text)) {
      hooks.add(text);
    }

    // Also check for custom hooks (start with "use")
    if (
      text.startsWith("use") &&
      text !== "use" &&
      text[3] === text[3].toUpperCase()
    ) {
      hooks.add(text);
    }
  });

  return Array.from(hooks);
}

/**
 * Detects event handlers in JSX attributes
 */
function detectEventHandlers(sourceFile: SourceFile): string[] {
  const handlers = new Set<string>();

  sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute).forEach((attr) => {
    const name = attr.getNameNode().getText();
    // Event handlers start with "on" followed by uppercase letter
    if (
      name.startsWith("on") &&
      name.length > 2 &&
      name[2] === name[2].toUpperCase()
    ) {
      handlers.add(name);
    }
  });

  return Array.from(handlers);
}

/**
 * Detects browser-only APIs usage
 */
function detectBrowserAPIs(sourceFile: SourceFile): string[] {
  const apis = new Set<string>();

  // Find all identifiers
  sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .forEach((identifier) => {
      const text = identifier.getText();
      if (BROWSER_APIS.includes(text)) {
        // Make sure it's not a variable declaration
        const parent = identifier.getParent();
        if (parent && parent.getKind() !== SyntaxKind.VariableDeclaration) {
          apis.add(text);
        }
      }
    });

  return Array.from(apis);
}

/**
 * Detects client-only library imports using dynamic detection
 */
function detectClientLibraries(sourceFile: SourceFile, projectRoot?: string): string[] {
  const libraries = new Set<string>();

  sourceFile.getImportDeclarations().forEach((importDecl) => {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Skip relative/local imports (handled separately)
    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/")) {
      return;
    }

    // First check the static list for backward compatibility (faster)
    if (CLIENT_ONLY_LIBRARIES.includes(moduleSpecifier)) {
      libraries.add(moduleSpecifier);
      return;
    }

    // Check for scoped packages in static list
    for (const lib of CLIENT_ONLY_LIBRARIES) {
      if (moduleSpecifier.startsWith(lib + "/")) {
        libraries.add(lib);
        return;
      }
    }

    // Use dynamic detection for unknown packages
    const isClient = isClientOnlyPackage(moduleSpecifier, projectRoot);
    if (isClient === true) {
      libraries.add(moduleSpecifier);
    }
  });

  return Array.from(libraries);
}

/**
 * Analyzes imported components recursively
 */
function analyzeImportedComponents(
  sourceFile: SourceFile,
  projectRoot: string,
  currentFilePath: string
): ComponentAnalysis[] {
  const components: ComponentAnalysis[] = [];
  const analyzed = new Set<string>(); // Prevent circular imports

  sourceFile.getImportDeclarations().forEach((importDecl) => {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Only analyze relative imports (local components)
    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/")) {
      const currentDir = path.dirname(currentFilePath);
      let resolvedPath = path.resolve(currentDir, moduleSpecifier);

      // Try to resolve the file with common extensions
      const extensions = [".tsx", ".ts", ".jsx", ".js"];
      let actualPath = resolvedPath;

      if (!fs.existsSync(resolvedPath)) {
        for (const ext of extensions) {
          const testPath = resolvedPath + ext;
          if (fs.existsSync(testPath)) {
            actualPath = testPath;
            break;
          }
        }

        // Also check for index files
        if (!fs.existsSync(actualPath)) {
          for (const ext of extensions) {
            const testPath = path.join(resolvedPath, `index${ext}`);
            if (fs.existsSync(testPath)) {
              actualPath = testPath;
              break;
            }
          }
        }
      }

      // Analyze the imported component if we haven't already
      if (fs.existsSync(actualPath) && !analyzed.has(actualPath)) {
        analyzed.add(actualPath);
        try {
          const analysis = analyzeComponentFile(actualPath, projectRoot);
          components.push(analysis);
        } catch (error) {
          // Skip files that can't be analyzed
        }
      }
    }
  });

  return components;
}

/**
 * Checks if a file already has "use client" directive
 */
export function hasUseClientDirective(sourceFile: SourceFile): boolean {
  const statements = sourceFile.getStatements();
  if (statements.length === 0) return false;

  const firstStatement = statements[0];
  const text = firstStatement.getText().trim();

  return text === '"use client";' || text === "'use client';";
}

/**
 * Adds "use client" directive to a source file if not already present
 */
export function addUseClientDirective(sourceFile: SourceFile): void {
  if (!hasUseClientDirective(sourceFile)) {
    sourceFile.insertStatements(0, '"use client";\n');
  }
}
