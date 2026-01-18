import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";

/**
 * Transforms middleware from Pages Router format to App Router format.
 * 
 * Key differences:
 * - Middleware API is mostly the same between Pages and App Router
 * - Both use NextRequest, NextResponse, and request.nextUrl
 * - Matcher config works the same way
 * - Function signature remains the same (NextRequest -> NextResponse | Response | null)
 * 
 * This function mainly ensures proper imports and handles any edge cases.
 */
export function transformMiddleware(
  filePath: string,
  fileContent: string
): string {
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 1,
    },
    useInMemoryFileSystem: true,
  });

  const isTypeScript = filePath.endsWith(".ts") || filePath.endsWith(".tsx");

  const sourceFile = project.createSourceFile("middleware.ts", fileContent);

  // Check if NextRequest/NextResponse imports exist
  const existingImports = sourceFile.getImportDeclarations();
  const hasNextServerImport = existingImports.some(
    (imp) => imp.getModuleSpecifierValue() === "next/server"
  );

  // Find the middleware function (either named export or default export)
  const namedMiddleware = sourceFile.getFunction("middleware");
  const defaultExport = sourceFile
    .getDefaultExportSymbol()
    ?.getDeclarations()[0];

  let middlewareFunction: any = null;
  if (defaultExport && (
    defaultExport.getKind() === SyntaxKind.FunctionDeclaration ||
    defaultExport.getKind() === SyntaxKind.FunctionExpression ||
    defaultExport.getKind() === SyntaxKind.ArrowFunction
  )) {
    middlewareFunction = defaultExport;
  } else if (namedMiddleware) {
    middlewareFunction = namedMiddleware;
  }

  // If middleware function exists, ensure proper imports
  if (middlewareFunction) {
    const text = sourceFile.getFullText();
    const needsNextRequest = /NextRequest/.test(text) || 
                             (isTypeScript && middlewareFunction.getParameters().length > 0);
    const needsNextResponse = /NextResponse/.test(text) || 
                              /NextResponse\.(next|redirect|rewrite|json)/.test(text);

    if (!hasNextServerImport && (needsNextRequest || needsNextResponse)) {
      const namedImports: string[] = [];
      if (needsNextRequest) namedImports.push("NextRequest");
      if (needsNextResponse) namedImports.push("NextResponse");
      
      // If we can't determine what's needed, add both as defaults
      if (namedImports.length === 0) {
        namedImports.push("NextRequest", "NextResponse");
      }

      sourceFile.addImportDeclaration({
        moduleSpecifier: "next/server",
        namedImports: namedImports,
      });
    }

    // Ensure proper type annotations for TypeScript
    if (isTypeScript) {
      const params = middlewareFunction.getParameters();
      if (params.length > 0) {
        const firstParam = params[0];
        const paramText = firstParam.getText();
        
        // Add NextRequest type if missing and it's a simple parameter name
        if (!paramText.includes(":") && !paramText.includes("NextRequest")) {
          // Check if parameter name is request, req, or similar
          const paramName = firstParam.getName();
          if (paramName && (paramName === "request" || paramName === "req")) {
            firstParam.replaceWithText(`${paramName === "req" ? "request" : paramName}: NextRequest`);
          }
        } else if (paramText.includes("req") && !paramText.includes("NextRequest")) {
          // Update req to request with NextRequest type
          firstParam.replaceWithText(`request: NextRequest`);
        }
      }
    }
  }

  // Matcher config works the same in both versions, so no transformation needed
  // The config.matcher export is compatible between Pages and App Router

  return sourceFile.getFullText();
}