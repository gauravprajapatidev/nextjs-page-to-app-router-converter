import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";
import path from "path";
import {
  analyzeComponentFile,
  hasUseClientDirective,
} from "./analyzeComponent.js";
import {
  extractMetadataFromHead,
  generateMetadataExport,
} from "./extractMetadata.js";

export function transformPage(
  filePath: string,
  fileContent: string,
  projectRoot?: string,
): string {
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 1, // Preserve
    },
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile("page.tsx", fileContent);
  let isClient = false;
  let analysisReasons: string[] = [];

  // Use comprehensive component analysis
  // Note: We analyze the actual file if projectRoot is provided for better accuracy
  let componentAnalysis;
  if (projectRoot && filePath) {
    try {
      componentAnalysis = analyzeComponentFile(filePath, projectRoot);
      isClient = componentAnalysis.classification === "client";
      analysisReasons = componentAnalysis.reasons;
    } catch (error) {
      // Fallback to basic detection if analysis fails
      console.warn(
        `Component analysis failed for ${filePath}, using basic detection`,
      );
    }
  }

  // Fallback: Basic detection if analysis not available
  if (!componentAnalysis) {
    // 1. Check for Client Component indicators (Hooks, Event Handlers, specific imports)
    const hasHooks = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => {
        const text = call.getExpression().getText();
        return text.startsWith("use") && text !== "useServerInsertedHTML";
      });

    const hasEventHandlers = sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxAttribute)
      .some((attr) => {
        const name = attr.getNameNode().getText();
        return name.startsWith("on") && name !== "on"; // e.g. onClick, onChange
      });

    const importsReactHooks = sourceFile
      .getImportDeclarations()
      .some((decl) => {
        const moduleSpecifier = decl.getModuleSpecifierValue();
        if (moduleSpecifier === "react") {
          return decl.getNamedImports().some((ni) => {
            const name = ni.getName();
            return (
              name === "useState" ||
              name === "useEffect" ||
              name === "useContext" ||
              name === "useReducer"
            );
          });
        }
        return false;
      });

    const usesHooks = hasHooks || hasEventHandlers || importsReactHooks;
    isClient = usesHooks;

    if (hasHooks) analysisReasons.push("Uses React hooks");
    if (hasEventHandlers) analysisReasons.push("Uses event handlers");
    if (importsReactHooks) analysisReasons.push("Imports React hooks");
  }

  // 2. Check for GSSP (Server Data Fetching)
  const gssp = sourceFile.getFunction("getServerSideProps");
  const gsp = sourceFile.getFunction("getStaticProps");

  // Route segment config to add
  const routeSegmentConfig: string[] = [];
  let revalidateValue: string | null = null;
  let fetchCacheValue: string | null = null;

  if (gssp || gsp) {
    const dataFetchName = gssp ? "getServerSideProps" : "getStaticProps";
    const defaultExport = sourceFile
      .getDefaultExportSymbol()
      ?.getDeclarations()[0]
      ?.asKind(SyntaxKind.FunctionDeclaration);

    if (defaultExport) {
      defaultExport.setIsAsync(true);

      // Merge App Router props ({ params, searchParams }) with existing props
      const params = defaultExport.getParameters();
      if (params.length === 0) {
        defaultExport.addParameter({
          name: "{ params, searchParams }",
          type: "any",
        });
      } else {
        const firstParam = params[0];
        const paramText = firstParam.getText();
        if (paramText.startsWith("{") && paramText.endsWith("}")) {
          const inner = paramText.slice(1, -1);
          firstParam.replaceWithText(`{ params, searchParams, ${inner} }`);
        } else {
          firstParam.replaceWithText(
            `{ params, searchParams, ...${paramText} }`,
          );
        }
      }

      // Extract the logic from GSSP/GSP
      const fetchFn = gssp || gsp;
      const body = fetchFn?.getBody();
      if (body && body.getKind() === SyntaxKind.Block) {
        const block = body.asKindOrThrow(SyntaxKind.Block);
        const statements = block.getStatements();
        const returnStmt = block.getStatementByKind(SyntaxKind.ReturnStatement);

        let logicText = "";
        statements.forEach((s: any) => {
          if (s !== returnStmt) {
            logicText += s.getText() + "\n";
          }
        });

        // Extract props and revalidate from return { props: { ... }, revalidate: ... }
        let propsText = "{}";
        if (returnStmt) {
          const expr = returnStmt.getExpression();
          if (expr && expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
            const objLit = expr.asKindOrThrow(
              SyntaxKind.ObjectLiteralExpression,
            );

            // Extract props
            const propsProp = objLit.getProperty("props");
            if (propsProp) {
              propsText = (propsProp as any).getInitializer().getText();
            }

            // Extract revalidate (only for getStaticProps)
            if (gsp) {
              const revalidateProp = objLit.getProperty("revalidate");
              if (revalidateProp) {
                const revalidateInit = (revalidateProp as any).getInitializer();
                if (revalidateInit) {
                  // Check if it's a numeric literal
                  if (revalidateInit.getKind() === SyntaxKind.NumericLiteral) {
                    revalidateValue = revalidateInit.getText();
                  } else {
                    // It's dynamic variable/expression
                    revalidateValue = "dynamic";
                  }
                }
              }
            }
          }
        }

        // Map 'context' to our new props if it was used
        logicText = logicText.replace(
          /\bcontext\b/g,
          "{ params, searchParams }",
        );

        // Detect fetch cache options to determine fetchCache segment config
        if (logicText.includes("fetch")) {
          if (
            /cache:\s*['"]no-store['"]/.test(logicText) ||
            /next:\s*\{\s*revalidate:\s*0/.test(logicText)
          ) {
            fetchCacheValue = "force-no-store";
          } else if (/cache:\s*['"]force-cache['"]/.test(logicText)) {
            fetchCacheValue = "force-cache";
          } else if (/cache:\s*['"]only-if-cached['"]/.test(logicText)) {
            fetchCacheValue = "only-if-cached";
          }
        }

        // Transform cookies usage: req.cookies.name → cookies().get('name')?.value
        let usesCookies = false;
        let usesHeaders = false;
        let transformedLogicText = logicText;

        // Transform req.cookies['name'] or req.cookies.name patterns
        // Match req.cookies['cookieName'] or req.cookies.cookieName
        const cookiePattern =
          /req\.cookies(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
        transformedLogicText = transformedLogicText.replace(
          cookiePattern,
          (match, quote, bracketName, dotName) => {
            usesCookies = true;
            const cookieName = bracketName || dotName;
            return `cookies().get('${cookieName}')?.value`;
          },
        );

        // Transform standalone req.cookies (when used as an object, e.g., Object.keys(req.cookies))
        // This handles cases where req.cookies is used without property access
        // The regex above handles req.cookies.name and req.cookies['name'], so if req.cookies still exists,
        // it means it's a standalone usage
        if (transformedLogicText.includes("req.cookies")) {
          transformedLogicText = transformedLogicText.replace(
            /\breq\.cookies\b/g,
            (match) => {
              usesCookies = true;
              return `cookies().getAll() /* TODO: req.cookies replaced with cookies().getAll(). Each item has { name, value } structure. Adjust code if needed. */`;
            },
          );
        }

        // Transform headers usage: req.headers['name'] → headersList.get('name')
        // Check if req.headers is used (but not req.cookies which we already handled)
        if (transformedLogicText.includes("req.headers")) {
          usesHeaders = true;

          // Transform req.headers.get('name') → headersList.get('name')
          transformedLogicText = transformedLogicText.replace(
            /\breq\.headers\.get\(/g,
            "headersList.get(",
          );

          // Transform req.headers.has('name') → headersList.has('name')
          transformedLogicText = transformedLogicText.replace(
            /\breq\.headers\.has\(/g,
            "headersList.has(",
          );

          // Transform req.headers.getAll('name') → headersList.getAll('name')
          transformedLogicText = transformedLogicText.replace(
            /\breq\.headers\.getAll\(/g,
            "headersList.getAll(",
          );

          // Transform req.headers['name'] or req.headers.name → headersList.get('name')
          const headerAccessPattern =
            /req\.headers(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
          transformedLogicText = transformedLogicText.replace(
            headerAccessPattern,
            (match, quote, bracketName, dotName) => {
              const headerName = bracketName || dotName;
              return `headersList.get('${headerName}')`;
            },
          );

          // Transform standalone req.headers → headersList
          // This handles cases where req.headers is used without property access
          if (transformedLogicText.includes("req.headers")) {
            transformedLogicText = transformedLogicText.replace(
              /\breq\.headers\b/g,
              "headersList",
            );
          }
        }

        // Apply the generic req. replacement (for other req properties, but skip req.cookies and req.headers since we already handled them)
        // This handles any remaining req.* patterns
        transformedLogicText = transformedLogicText.replace(
          /req\.(?!cookies|headers)/g,
          "request.",
        );

        // Add headersList initialization at the beginning if headers are used
        let headersInit = "";
        if (usesHeaders) {
          headersInit = "const headersList = await headers();\n";
        }

        defaultExport.insertStatements(
          0,
          `
  // Automatically converted from ${dataFetchName}
  ${headersInit}${transformedLogicText} 
  const props = ${propsText};
            `,
        );

        // Add imports for cookies and/or headers
        if (usesCookies || usesHeaders) {
          // Check if next/headers import already exists
          const existingHeadersImport =
            sourceFile.getImportDeclaration("next/headers");
          const importsToAdd: string[] = [];

          if (usesCookies) importsToAdd.push("cookies");
          if (usesHeaders) importsToAdd.push("headers");

          if (existingHeadersImport) {
            // Add to existing import
            importsToAdd.forEach((imp) => {
              const existingImports = existingHeadersImport
                .getNamedImports()
                .map((ni) => ni.getName());
              if (!existingImports.includes(imp)) {
                existingHeadersImport.addNamedImport(imp);
              }
            });
          } else if (importsToAdd.length > 0) {
            // Create new import
            sourceFile.addImportDeclaration({
              moduleSpecifier: "next/headers",
              namedImports: importsToAdd,
            });
          }
        }
      }
    }

    // Add route segment config based on data fetching function
    // Only add for server components (not client components)
    if (!isClient) {
      if (gssp) {
        // getServerSideProps → force-dynamic (always runs on each request)
        routeSegmentConfig.push(`export const dynamic = 'force-dynamic';`);
      } else if (gsp) {
        // getStaticProps → force-static (static generation)
        routeSegmentConfig.push(`export const dynamic = 'force-static';`);

        // Add revalidate if present
        if (revalidateValue) {
          if (revalidateValue === "dynamic") {
            routeSegmentConfig.push(
              `// TODO: Dynamic 'revalidate' value (from getStaticProps) cannot be exported directly. Use 'fetch(url, { next: { revalidate: ... } })' instead.`,
            );
          } else {
            routeSegmentConfig.push(
              `export const revalidate = ${revalidateValue};`,
            );
          }
        }
      }
    }

    // Add fetchCache if detected
    if (fetchCacheValue) {
      routeSegmentConfig.push(
        `export const fetchCache = '${fetchCacheValue}';`,
      );
    }

    gssp?.remove();
    gsp?.remove();
  }

  // 2.5. Check for getStaticPaths and convert to generateStaticParams
  const gspPaths = sourceFile.getFunction("getStaticPaths");
  if (gspPaths) {
    const body = gspPaths.getBody();
    if (body && body.getKind() === SyntaxKind.Block) {
      const block = body.asKindOrThrow(SyntaxKind.Block);
      const statements = block.getStatements();
      const returnStmt = block.getStatementByKind(SyntaxKind.ReturnStatement);

      if (returnStmt) {
        const expr = returnStmt.getExpression();
        if (expr && expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const objLit = expr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          const pathsProp = objLit.getProperty("paths");
          const fallbackProp = objLit.getProperty("fallback");

          if (pathsProp) {
            // Extract logic before return statement
            let logicText = "";
            statements.forEach((s: any) => {
              if (s !== returnStmt) {
                logicText += s.getText() + "\n";
              }
            });

            // Get the paths array expression
            const pathsInit = (pathsProp as any).getInitializer();
            let pathsText = "[]";

            if (pathsInit) {
              // Use AST-based transformation for proper handling of nested structures
              if (pathsInit.getKind() === SyntaxKind.ArrayLiteralExpression) {
                const arrayLit = pathsInit.asKindOrThrow(
                  SyntaxKind.ArrayLiteralExpression,
                );
                const elements = arrayLit.getElements();

                // Transform each element: { params: { ... } } → { ... }
                const transformedElements = elements.map((element: any) => {
                  if (
                    element.getKind() === SyntaxKind.ObjectLiteralExpression
                  ) {
                    const objLit = element.asKindOrThrow(
                      SyntaxKind.ObjectLiteralExpression,
                    );
                    const paramsProp = objLit.getProperty("params");

                    if (paramsProp) {
                      const paramsInit = (paramsProp as any).getInitializer();
                      if (paramsInit) {
                        // Extract the params object directly
                        return paramsInit.getText();
                      }
                    }
                  }
                  // Fallback: return element as-is if transformation isn't possible
                  return element.getText();
                });

                pathsText = `[${transformedElements.join(", ")}]`;
              } else {
                // Fallback to text-based regex for non-array cases
                pathsText = pathsInit.getText();
                // Convert { params: { id: '1' } } to { id: '1' }
                // Use improved regex that handles basic nested structures
                pathsText = pathsText.replace(
                  /\{\s*params:\s*(\{[^}]*\})\s*\}/g,
                  "$1",
                );
              }
            }

            // Build the new generateStaticParams function
            const generateStaticParamsCode = `
export async function generateStaticParams() {
  // Automatically converted from getStaticPaths
${logicText}  return ${pathsText};
}
`;

            sourceFile.addStatements(generateStaticParamsCode);

            // Convert fallback option to dynamicParams export
            // fallback: false → dynamicParams = false
            // fallback: true or "blocking" → dynamicParams = true
            if (fallbackProp) {
              const fallbackInit = (fallbackProp as any).getInitializer();
              let dynamicParamsValue: boolean;

              if (fallbackInit) {
                // Check if it's a boolean false literal
                if (
                  fallbackInit.getKind() === SyntaxKind.FalseKeyword ||
                  (fallbackInit.getKind() === SyntaxKind.StringLiteral &&
                    fallbackInit.getText().replace(/['"]/g, "") === "false")
                ) {
                  dynamicParamsValue = false;
                } else {
                  // fallback: true, "blocking", or any other value → dynamicParams = true
                  dynamicParamsValue = true;
                }
              } else {
                // Default to true if we can't determine the value
                dynamicParamsValue = true;
              }

              // Add export const dynamicParams = <value>
              sourceFile.addStatements(
                `export const dynamicParams = ${dynamicParamsValue};\n`,
              );
            }
          }
        }
      } else {
        // No return statement, but function exists - preserve the logic and return empty array
        let logicText = "";
        statements.forEach((s: any) => {
          logicText += s.getText() + "\n";
        });

        const generateStaticParamsCode = `
export async function generateStaticParams() {
  // Automatically converted from getStaticPaths
${logicText}  // TODO: Add return statement with paths array
  return [];
}
`;

        sourceFile.addStatements(generateStaticParamsCode);
      }
    }

    gspPaths.remove();
  }

  // Add route segment config exports (only for server components)
  if (routeSegmentConfig.length > 0 && !isClient) {
    // Add route segment config exports after imports but before other code
    const statements = sourceFile.getStatements();
    let insertIndex = statements.length;

    // Find the first non-import statement to insert before it
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const kind = stmt.getKind();
      // Skip import declarations
      if (kind !== SyntaxKind.ImportDeclaration) {
        insertIndex = i;
        break;
      }
    }

    // Insert all route segment config exports as a single multi-line statement
    // ts-morph will handle the formatting
    const configCode = routeSegmentConfig.join("\n");
    if (insertIndex < statements.length) {
      sourceFile.insertStatements(insertIndex, configCode);
    } else {
      // If no non-import statements found, add to the end (shouldn't happen normally)
      sourceFile.addStatements(configCode);
    }
  }

  if (!gssp && !gsp && isClient) {
    // Strategy: Client Component
    // Add "use client" directive with explanation
    const reasonComment =
      analysisReasons.length > 0
        ? `// Client Component: ${analysisReasons.join(", ")}\n`
        : "";
    sourceFile.insertStatements(0, `${reasonComment}"use client";\n`);
  }

  // 3. Transform useRouter -> import from next/navigation
  const routerImport = sourceFile.getImportDeclaration("next/router");
  if (routerImport) {
    routerImport.setModuleSpecifier("next/navigation");

    // Find all router property/method usages
    const routerCalls = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === "router");

    let usesPathname = false;
    let usesQuery = false;
    let usesEvents = false;
    let usesRouterMethods = false; // back, forward, prefetch, push, replace
    const defaultExport = sourceFile
      .getDefaultExportSymbol()
      ?.getDeclarations()[0]
      ?.asKind(SyntaxKind.FunctionDeclaration);

    // Track router.events statements to comment them out
    const eventsStatements: any[] = [];

    // Analyze router usage patterns
    routerCalls.forEach((id) => {
      const parent = id.getParent();
      if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = parent.asKindOrThrow(
          SyntaxKind.PropertyAccessExpression,
        );
        const propName = propAccess.getNameNode().getText();

        if (propName === "pathname") {
          usesPathname = true;
          // Replace router.pathname with pathname (will be from usePathname hook)
          propAccess.replaceWithText("pathname");
        } else if (propName === "query") {
          usesQuery = true;
          // Replace router.query with routerQuery (merged params + searchParams)
          propAccess.replaceWithText("routerQuery");
        } else if (propName === "events") {
          usesEvents = true;
          // Mark for replacement - router.events is not available in App Router
          eventsStatements.push(propAccess);
          // Replace with undefined and add TODO comment
          propAccess.replaceWithText(
            "undefined /* router.events - not available in App Router */",
          );
        } else if (
          ["back", "forward", "prefetch", "push", "replace", "reload"].includes(
            propName,
          )
        ) {
          usesRouterMethods = true;
          // These methods still work with useRouter from next/navigation
          // Just keep the call, router will come from useRouter() hook
        }
      }
    });

    // Add necessary imports and hooks for client components
    if (isClient && defaultExport) {
      const importsToAdd: string[] = [];
      const hooksToAdd: string[] = [];

      // Check if there's already a const router = useRouter() declaration
      const hasExistingRouter = defaultExport
        .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
        .some((decl) => {
          const name = decl.getNameNode().getText();
          const initializer = decl.getInitializer();
          return (
            name === "router" &&
            initializer &&
            initializer.getKind() === SyntaxKind.CallExpression &&
            initializer.getText().includes("useRouter")
          );
        });

      if (usesPathname) {
        importsToAdd.push("usePathname");
        hooksToAdd.push("  const pathname = usePathname();");
      }

      if (usesQuery) {
        importsToAdd.push("useSearchParams");
        importsToAdd.push("useParams");
        hooksToAdd.push("  const searchParams = useSearchParams();");
        hooksToAdd.push("  const params = useParams();");
        hooksToAdd.push(
          "  const routerQuery = { ...params, ...(searchParams ? Object.fromEntries(searchParams.entries()) : {}) };",
        );
      }

      // Only add const router = useRouter() if we need router methods and don't already have it
      if (usesRouterMethods && !hasExistingRouter) {
        importsToAdd.push("useRouter");
        hooksToAdd.push("  const router = useRouter();");
      } else if (usesRouterMethods && hasExistingRouter) {
        // Still need to import useRouter even if declaration exists (it will use the new import)
        importsToAdd.push("useRouter");
      }

      // Add imports
      if (importsToAdd.length > 0) {
        // Check if next/navigation import already exists
        const navImport = sourceFile.getImportDeclaration("next/navigation");
        if (navImport) {
          // Add to existing import
          importsToAdd.forEach((imp) => {
            const existingImports = navImport
              .getNamedImports()
              .map((ni) => ni.getName());
            if (!existingImports.includes(imp)) {
              navImport.addNamedImport(imp);
            }
          });
        } else {
          // Create new import
          sourceFile.addImportDeclaration({
            moduleSpecifier: "next/navigation",
            namedImports: importsToAdd,
          });
        }
      }

      // Add hooks to component body
      if (hooksToAdd.length > 0) {
        defaultExport.insertStatements(0, hooksToAdd.join("\n"));
      }
    } else if (!isClient) {
      // Server component handling
      if (usesQuery) {
        // searchParams comes from props, which should already be added in getServerSideProps/getStaticProps conversion
        // Just verify the parameter exists
        if (defaultExport) {
          const params = defaultExport.getParameters();
          if (params.length > 0) {
            const firstParam = params[0];
            const paramText = firstParam.getText();
            if (!paramText.includes("searchParams")) {
              // searchParams should already be in props from GSSP/GSP conversion
              // But if not, we need to add it
              if (paramText.startsWith("{") && paramText.endsWith("}")) {
                const inner = paramText.slice(1, -1);
                firstParam.replaceWithText(
                  `{ params, searchParams${inner ? `, ${inner}` : ""} }`,
                );
              } else {
                firstParam.replaceWithText(
                  `{ params, searchParams, ...${paramText} }`,
                );
              }
            }
          } else {
            // No parameters, add them
            defaultExport.addParameter({
              name: "{ params, searchParams }",
              type: "any",
            });
          }
        }
      }

      // If using pathname or router methods in server component, need to convert to client
      if (usesPathname || usesRouterMethods) {
        // These require client component - add "use client" directive
        if (
          !sourceFile
            .getStatements()
            .some(
              (stmt) =>
                stmt.getKind() === SyntaxKind.StringLiteral &&
                stmt.getText() === '"use client"',
            )
        ) {
          sourceFile.insertStatements(
            0,
            `// TODO: router.pathname or router methods detected. This component needs to be a Client Component.\n"use client";\n`,
          );
        }
      }
    }

    // Handle router.events with guidance comment
    if (usesEvents && defaultExport) {
      // Add a comment at the top of the component about router.events
      const existingStatements = defaultExport.getStatements();
      const hasEventsComment = existingStatements.some((stmt) =>
        stmt.getFullText().includes("router.events"),
      );

      if (!hasEventsComment) {
        defaultExport.insertStatements(
          0,
          `// TODO: router.events is not available in App Router.\n// Use window.addEventListener('popstate') or useEffect with pathname/searchParams changes instead.\n// See: https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating#using-router-events\n`,
        );
      }
    }
  }

  // 3.5. Remove Page.getLayout pattern (will be converted to nested layout.tsx)
  // Pattern: Page.getLayout = function getLayout(page) { ... }
  const statements = sourceFile.getStatements();
  const defaultExport = sourceFile
    .getDefaultExportSymbol()
    ?.getDeclarations()[0]
    ?.asKind(SyntaxKind.FunctionDeclaration);

  if (defaultExport) {
    const defaultExportName = defaultExport.getName();

    // Look for property assignments: Page.getLayout = ...
    for (let i = statements.length - 1; i >= 0; i--) {
      const stmt = statements[i];
      if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
        const expr = stmt
          .asKindOrThrow(SyntaxKind.ExpressionStatement)
          .getExpression();
        if (expr.getKind() === SyntaxKind.BinaryExpression) {
          const binaryExpr = expr.asKindOrThrow(SyntaxKind.BinaryExpression);
          const left = binaryExpr.getLeft();
          if (left.getKind() === SyntaxKind.PropertyAccessExpression) {
            const propAccess = left.asKindOrThrow(
              SyntaxKind.PropertyAccessExpression,
            );
            const name = propAccess.getNameNode().getText();
            const objectName = propAccess.getExpression().getText();

            // Check if it's Page.getLayout or ComponentName.getLayout
            if (name === "getLayout") {
              if (
                !defaultExportName ||
                objectName === defaultExportName ||
                objectName === "Page"
              ) {
                // Remove the getLayout assignment
                stmt.remove();
              }
            }
          }
        }
      }
    }

    // Also look for standalone getLayout function declarations and remove them
    // (though this is less common - usually it's assigned to Page.getLayout)
    const getLayoutFunc = sourceFile.getFunction("getLayout");
    if (getLayoutFunc) {
      // Check if it's used only for Page.getLayout (simple heuristic)
      // If it's a standalone function, we might want to keep it, but typically it's not used elsewhere
      // For now, we'll remove it if found - user can manually adjust if needed
      // Only remove if it's not exported (typically getLayout is not exported)
      const isExported = getLayoutFunc
        .getModifiers()
        .some((mod: any) => mod.getKind() === SyntaxKind.ExportKeyword);
      if (!isExported) {
        getLayoutFunc.remove();
      }
    }
  }

  // 4. Transform next/head to metadata
  // Comprehensive metadata extraction from <Head> components
  const extractedMetadata = extractMetadataFromHead(sourceFile);

  if (extractedMetadata) {
    if (!isClient) {
      // Determine if TypeScript based on file extension
      const useTypeScript =
        filePath.endsWith(".ts") || filePath.endsWith(".tsx");

      // Generate metadata export code
      const metadataCode = generateMetadataExport(
        extractedMetadata,
        useTypeScript,
      );

      // Split the code into import and export parts
      const lines = metadataCode.split("\n");
      const importLine = lines.find((line) =>
        line.includes("import type { Metadata }"),
      );
      const exportLines = lines.filter(
        (line) => !line.includes("import type { Metadata }"),
      );

      // Add import if TypeScript
      if (importLine && useTypeScript) {
        // Check if Metadata import already exists
        const existingMetadataImport = sourceFile.getImportDeclaration(
          (decl) => decl.getModuleSpecifierValue() === "next",
        );
        if (!existingMetadataImport) {
          sourceFile.addImportDeclaration({
            moduleSpecifier: "next",
            namedImports: [{ name: "Metadata", isTypeOnly: true }],
          });
        } else {
          // Add Metadata to existing import
          const namedImports = existingMetadataImport.getNamedImports();
          const hasMetadata = namedImports.some(
            (imp) => imp.getName() === "Metadata",
          );
          if (!hasMetadata) {
            existingMetadataImport.addNamedImport({
              name: "Metadata",
              isTypeOnly: true,
            });
          }
        }
      }

      // Add metadata export (find the right place to insert)
      const statements = sourceFile.getStatements();
      let insertIndex = statements.length;

      // Find the first non-import statement to insert before it
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const kind = stmt.getKind();
        // Skip import declarations and route segment config
        if (
          kind !== SyntaxKind.ImportDeclaration &&
          !stmt.getText().includes("export const dynamic") &&
          !stmt.getText().includes("export const revalidate") &&
          !stmt.getText().includes("export const dynamicParams") &&
          !stmt.getText().includes("export const fetchCache")
        ) {
          insertIndex = i;
          break;
        }
      }

      // Insert metadata export
      if (insertIndex < statements.length) {
        sourceFile.insertStatements(insertIndex, exportLines.join("\n"));
      } else {
        sourceFile.addStatements(exportLines.join("\n"));
      }

      // Add TODO comment for Head removal
      const defaultExport = sourceFile
        .getDefaultExportSymbol()
        ?.getDeclarations()[0]
        ?.asKind(SyntaxKind.FunctionDeclaration);
      defaultExport?.insertStatements(
        0,
        `// TODO: <Head> detected. Metadata has been extracted to 'export const metadata'${extractedMetadata.isDynamic ? " / generateMetadata()" : ""}. Please remove <Head> components.`,
      );
    } else {
      // Client components can't export metadata.
      // Leave a comment.
      sourceFile.insertStatements(
        0,
        `// TODO: This is a Client Component with <Head>. Move metadata to a parent Server Component (layout or page).`,
      );
    }
  }

  return sourceFile.getFullText();
}
