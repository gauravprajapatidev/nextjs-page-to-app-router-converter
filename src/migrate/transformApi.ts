import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";

/**
 * Transforms Pages Router response methods to App Router NextResponse methods
 * Handles: res.json(), res.redirect(), res.send(), res.end(), res.setHeader(), res.status()
 */
function transformResponseMethods(code: string): string {
  let transformed = code;

  // Transform res.redirect(url) -> return NextResponse.redirect(url)
  // Handles: res.redirect('/path'), res.redirect('https://...'), res.redirect(301, '/path')
  transformed = transformed.replace(
    /res\.redirect\(\s*(\d+)\s*,\s*(['"`][^'"`]+['"`]|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g,
    (match, statusCode, url) => {
      return `return NextResponse.redirect(${url}, { status: ${statusCode} })`;
    },
  );

  transformed = transformed.replace(
    /res\.redirect\(\s*(['"`][^'"`]+['"`]|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g,
    (match, url) => {
      return `return NextResponse.redirect(${url})`;
    },
  );

  // Transform res.status(code).json(data) -> return NextResponse.json(data, { status: code })
  transformed = transformed.replace(
    /res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*([^)]*)\s*\)/g,
    "return NextResponse.json($2, { status: $1 })",
  );

  // Transform res.json(data) -> return NextResponse.json(data)
  transformed = transformed.replace(
    /res\.json\s*\(\s*([^)]*)\s*\)/g,
    "return NextResponse.json($1)",
  );

  // Transform res.status(code).send(data) -> return new Response(data, { status: code })
  transformed = transformed.replace(
    /res\.status\s*\(\s*(\d+)\s*\)\.send\s*\(\s*([^)]*)\s*\)/g,
    "return new Response($2, { status: $1 })",
  );

  // Transform res.send(data) -> return new Response(data)
  transformed = transformed.replace(
    /res\.send\s*\(\s*([^)]*)\s*\)/g,
    "return new Response($1)",
  );

  // Transform res.status(code).end() -> return new Response(null, { status: code })
  transformed = transformed.replace(
    /res\.status\s*\(\s*(\d+)\s*\)\.end\s*\(\s*\)/g,
    "return new Response(null, { status: $1 })",
  );

  // Transform res.end() -> return new Response(null)
  transformed = transformed.replace(
    /res\.end\s*\(\s*\)/g,
    "return new Response(null)",
  );

  // Transform res.setHeader(name, value) -> Add TODO comment for proper header handling
  // This is complex because headers need to be collected and passed to NextResponse
  transformed = transformed.replace(
    /res\.setHeader\s*\(\s*(['"`][^'"`]+['"`]|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*([^)]*)\s*\)/g,
    (match, headerName, headerValue) => {
      return `/* TODO: Use NextResponse with headers option: 
       const headers = new Headers();
       headers.set(${headerName}, ${headerValue});
       return NextResponse.json(data, { headers });
     */`;
    },
  );

  // Transform standalone res.status(code) -> Add TODO comment
  // This usually means status is set but response is sent later
  transformed = transformed.replace(
    /res\.status\s*\(\s*(\d+)\s*\)(?!\.)/g,
    "/* TODO: Status $1 - Set status in NextResponse options when returning response */",
  );

  // Detect streaming responses (res.write) and add guidance
  if (transformed.includes("res.write")) {
    transformed = transformed.replace(
      /res\.write\s*\(/g,
      "/* TODO: Streaming - Use ReadableStream with new Response(stream). See: https://nextjs.org/docs/app/building-your-application/routing/route-handlers#streaming */\n  // res.write(",
    );
  }

  return transformed;
}

/**
 * Detects method-based routing using if/else statements
 * Example: if (req.method === 'GET') { ... } else if (req.method === 'POST') { ... }
 */
function detectMethodBasedIfStatements(body: any): Map<string, string> {
  const methodHandlers = new Map<string, string>();

  // Find all if statements that check req.method
  const ifStatements = body.getDescendantsOfKind(SyntaxKind.IfStatement);

  for (const ifStmt of ifStatements) {
    const condition = ifStmt.getExpression().getText();

    // Check if condition is checking req.method
    const methodMatch = condition.match(
      /(?:req|request)\.method\s*===?\s*['"](\w+)['"]/,
    );

    if (methodMatch) {
      const method = methodMatch[1].toUpperCase();
      const thenStatement = ifStmt.getThenStatement();
      const thenCode = thenStatement.getText();

      // Extract the code block (remove braces if it's a block statement)
      const codeBlock =
        thenCode.startsWith("{") && thenCode.endsWith("}")
          ? thenCode.slice(1, -1).trim()
          : thenCode;

      methodHandlers.set(method, codeBlock);
    }
  }

  return methodHandlers;
}

export function transformApi(filePath: string, fileContent: string): string {
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 1,
    },
    useInMemoryFileSystem: true,
  });

  const isTypeScript = filePath.endsWith(".ts") || filePath.endsWith(".tsx");

  const sourceFile = project.createSourceFile("route.ts", fileContent);

  // Strategy for MVP:
  // 1. Find the default export (commonly 'handler').
  // 2. Rename it to a named export 'GET' (safe default).
  // 3. Mark a TODO to check if it handles POST/PUT/etc or needs splitting.
  // 4. Comment out req/res usage and add TODOs to use 'request' object.

  const defaultExport = sourceFile
    .getDefaultExportSymbol()
    ?.getDeclarations()[0];

  if (
    defaultExport &&
    (defaultExport.getKind() === SyntaxKind.FunctionDeclaration ||
      defaultExport.getKind() === SyntaxKind.FunctionExpression ||
      defaultExport.getKind() === SyntaxKind.ArrowFunction)
  ) {
    const fn = defaultExport as any;
    const body = fn.getBody();

    sourceFile.addImportDeclaration({
      moduleSpecifier: "next/server",
      namedImports: ["NextResponse"],
    });

    if (body) {
      // Look for switch (req.method) or if (req.method === '...')
      const switchStmt = body
        .getDescendantsOfKind(SyntaxKind.SwitchStatement)
        .find((s: any) => {
          const expr = s.getExpression().getText();
          return expr.includes("req.method") || expr.includes("request.method");
        });

      if (switchStmt) {
        const cases = switchStmt
          .getClauses()
          .filter((c: any) => c.getKind() === SyntaxKind.CaseClause) as any[];
        cases.forEach((c: any) => {
          const methodMatch = c
            .getExpression()
            .getText()
            .match(/['"](.*?)['"]/);
          if (methodMatch) {
            const method = methodMatch[1].toUpperCase();
            let caseLogic = c
              .getStatements()
              .map((s: any) => s.getText())
              .join("\n");

            // Transform cookies usage before general req -> request replacement
            let usesCookies = false;
            let usesHeaders = false;

            // Transform req.cookies['name'] or req.cookies.name patterns
            const cookiePattern =
              /req\.cookies(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
            caseLogic = caseLogic.replace(
              cookiePattern,
              (
                _match: string,
                _quote: string,
                bracketName: string,
                dotName: string,
              ) => {
                usesCookies = true;
                const cookieName = bracketName || dotName;
                return `cookies().get('${cookieName}')?.value`;
              },
            );

            // Transform standalone req.cookies (when used as an object)
            // The regex above handles req.cookies.name and req.cookies['name'], so if req.cookies still exists,
            // it means it's a standalone usage
            if (caseLogic.includes("req.cookies")) {
              caseLogic = caseLogic.replace(
                /\breq\.cookies\b/g,
                (match: string) => {
                  usesCookies = true;
                  return `cookies().getAll() /* TODO: req.cookies replaced with cookies().getAll(). Each item has { name, value } structure. Adjust code if needed. */`;
                },
              );
            }

            // Transform headers usage: req.headers['name'] → headersList.get('name')
            // Check if req.headers is used (but not req.cookies which we already handled)
            if (caseLogic.includes("req.headers")) {
              usesHeaders = true;

              // Transform req.headers.get('name') → headersList.get('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.get\(/g,
                "headersList.get(",
              );

              // Transform req.headers.has('name') → headersList.has('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.has\(/g,
                "headersList.has(",
              );

              // Transform req.headers.getAll('name') → headersList.getAll('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.getAll\(/g,
                "headersList.getAll(",
              );

              // Transform req.headers['name'] or req.headers.name → headersList.get('name')
              const headerAccessPattern =
                /req\.headers(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
              caseLogic = caseLogic.replace(
                headerAccessPattern,
                (
                  match: string,
                  quote: string,
                  bracketName: string,
                  dotName: string,
                ) => {
                  const headerName = bracketName || dotName;
                  return `headersList.get('${headerName}')`;
                },
              );

              // Transform standalone req.headers → headersList
              // This handles cases where req.headers is used without property access
              if (caseLogic.includes("req.headers")) {
                caseLogic = caseLogic.replace(
                  /\breq\.headers\b/g,
                  "headersList",
                );
              }

              // Add headersList initialization at the beginning of caseLogic
              caseLogic = `const headersList = await headers();\n${caseLogic}`;
            }

            // Map req -> request (for non-cookie and non-headers req usage)
            // Use negative lookahead to skip req.cookies and req.headers
            caseLogic = caseLogic.replace(
              /\breq\.(?!cookies|headers)/g,
              "request.",
            );
            // Also replace standalone req (word boundary) but not req.cookies or req.headers
            caseLogic = caseLogic.replace(/\breq\b(?!\.)/g, "request");

            // Add imports for cookies and/or headers
            if (usesCookies || usesHeaders) {
              const existingHeadersImport =
                sourceFile.getImportDeclaration("next/headers");
              const importsToAdd: string[] = [];

              if (usesCookies) importsToAdd.push("cookies");
              if (usesHeaders) importsToAdd.push("headers");

              if (existingHeadersImport) {
                importsToAdd.forEach((imp) => {
                  const existingImports = existingHeadersImport
                    .getNamedImports()
                    .map((ni) => ni.getName());
                  if (!existingImports.includes(imp)) {
                    existingHeadersImport.addNamedImport(imp);
                  }
                });
              } else if (importsToAdd.length > 0) {
                sourceFile.addImportDeclaration({
                  moduleSpecifier: "next/headers",
                  namedImports: importsToAdd,
                });
              }
            }

            // Transform response methods
            caseLogic = transformResponseMethods(caseLogic);

            const requestParam = isTypeScript ? "request: Request" : "request";
            sourceFile.addStatements(`
export async function ${method}(${requestParam}) {
  ${caseLogic}
}
                      `);
          }
        });
        (fn as any).remove ? (fn as any).remove() : null;
      } else {
        // Check for if/else based method routing
        const ifMethodHandlers = detectMethodBasedIfStatements(body);

        if (ifMethodHandlers.size > 0) {
          // Handle if/else based routing
          ifMethodHandlers.forEach((handlerCode, method) => {
            let caseLogic = handlerCode;

            // Transform cookies usage before general req -> request replacement
            let usesCookies = false;
            let usesHeaders = false;

            // Transform req.cookies['name'] or req.cookies.name patterns
            const cookiePattern =
              /req\.cookies(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
            caseLogic = caseLogic.replace(
              cookiePattern,
              (
                _match: string,
                _quote: string,
                bracketName: string,
                dotName: string,
              ) => {
                usesCookies = true;
                const cookieName = bracketName || dotName;
                return `cookies().get('${cookieName}')?.value`;
              },
            );

            // Transform standalone req.cookies (when used as an object)
            if (caseLogic.includes("req.cookies")) {
              caseLogic = caseLogic.replace(
                /\breq\.cookies\b/g,
                (match: string) => {
                  usesCookies = true;
                  return `cookies().getAll() /* TODO: req.cookies replaced with cookies().getAll(). Each item has { name, value } structure. Adjust code if needed. */`;
                },
              );
            }

            // Transform headers usage: req.headers['name'] → headersList.get('name')
            if (caseLogic.includes("req.headers")) {
              usesHeaders = true;

              // Transform req.headers.get('name') → headersList.get('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.get\(/g,
                "headersList.get(",
              );

              // Transform req.headers.has('name') → headersList.has('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.has\(/g,
                "headersList.has(",
              );

              // Transform req.headers.getAll('name') → headersList.getAll('name')
              caseLogic = caseLogic.replace(
                /\breq\.headers\.getAll\(/g,
                "headersList.getAll(",
              );

              // Transform req.headers['name'] or req.headers.name → headersList.get('name')
              const headerAccessPattern =
                /req\.headers(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
              caseLogic = caseLogic.replace(
                headerAccessPattern,
                (
                  match: string,
                  quote: string,
                  bracketName: string,
                  dotName: string,
                ) => {
                  const headerName = bracketName || dotName;
                  return `headersList.get('${headerName}')`;
                },
              );

              // Transform standalone req.headers → headersList
              if (caseLogic.includes("req.headers")) {
                caseLogic = caseLogic.replace(
                  /\breq\.headers\b/g,
                  "headersList",
                );
              }

              // Add headersList initialization at the beginning of caseLogic
              caseLogic = `const headersList = await headers();\n${caseLogic}`;
            }

            // Map req -> request (for non-cookie and non-headers req usage)
            caseLogic = caseLogic.replace(
              /\breq\.(?!cookies|headers)/g,
              "request.",
            );
            caseLogic = caseLogic.replace(/\breq\b(?!\.)/g, "request");

            // Add imports for cookies and/or headers
            if (usesCookies || usesHeaders) {
              const existingHeadersImport =
                sourceFile.getImportDeclaration("next/headers");
              const importsToAdd: string[] = [];

              if (usesCookies) importsToAdd.push("cookies");
              if (usesHeaders) importsToAdd.push("headers");

              if (existingHeadersImport) {
                importsToAdd.forEach((imp) => {
                  const existingImports = existingHeadersImport
                    .getNamedImports()
                    .map((ni) => ni.getName());
                  if (!existingImports.includes(imp)) {
                    existingHeadersImport.addNamedImport(imp);
                  }
                });
              } else if (importsToAdd.length > 0) {
                sourceFile.addImportDeclaration({
                  moduleSpecifier: "next/headers",
                  namedImports: importsToAdd,
                });
              }
            }

            // Transform response methods
            caseLogic = transformResponseMethods(caseLogic);

            const requestParam = isTypeScript ? "request: Request" : "request";
            sourceFile.addStatements(`
export async function ${method}(${requestParam}) {
  ${caseLogic}
}
                      `);
          });
          (fn as any).remove ? (fn as any).remove() : null;
        } else {
          // Fallback: Rename default handler to GET
          if (fn.getKind() === SyntaxKind.FunctionDeclaration) {
            const fnd = fn.asKindOrThrow(SyntaxKind.FunctionDeclaration);
            fnd.setIsDefaultExport(false);
            fnd.setIsExported(true);
            fnd.rename("GET");
            if (isTypeScript) {
              fnd.getParameters()[0]?.replaceWithText("request: Request");
            } else {
              fnd.getParameters()[0]?.replaceWithText("request");
            }
            fnd.getParameters()[1]?.remove();

            let logic = fnd.getBody()?.getText() || "";

            // Transform cookies usage before general req -> request replacement
            let usesCookies = false;
            let usesHeaders = false;

            // Transform req.cookies['name'] or req.cookies.name patterns
            const cookiePattern =
              /req\.cookies(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
            logic = logic.replace(
              cookiePattern,
              (
                match: string,
                quote: string,
                bracketName: string,
                dotName: string,
              ) => {
                usesCookies = true;
                const cookieName = bracketName || dotName;
                return `cookies().get('${cookieName}')?.value`;
              },
            );

            // Transform standalone req.cookies (when used as an object)
            // The regex above handles req.cookies.name and req.cookies['name'], so if req.cookies still exists,
            // it means it's a standalone usage
            if (logic.includes("req.cookies")) {
              logic = logic.replace(/\breq\.cookies\b/g, (match: string) => {
                usesCookies = true;
                return `cookies().getAll() /* TODO: req.cookies replaced with cookies().getAll(). Each item has { name, value } structure. Adjust code if needed. */`;
              });
            }

            // Transform headers usage: req.headers['name'] → headersList.get('name')
            // Check if req.headers is used (but not req.cookies which we already handled)
            if (logic.includes("req.headers")) {
              usesHeaders = true;

              // Transform req.headers.get('name') → headersList.get('name')
              logic = logic.replace(
                /\breq\.headers\.get\(/g,
                "headersList.get(",
              );

              // Transform req.headers.has('name') → headersList.has('name')
              logic = logic.replace(
                /\breq\.headers\.has\(/g,
                "headersList.has(",
              );

              // Transform req.headers.getAll('name') → headersList.getAll('name')
              logic = logic.replace(
                /\breq\.headers\.getAll\(/g,
                "headersList.getAll(",
              );

              // Transform req.headers['name'] or req.headers.name → headersList.get('name')
              const headerAccessPattern =
                /req\.headers(?:\[(['"])([^'"]+)\1\]|\.([a-zA-Z_$][a-zA-Z0-9_$]*))/g;
              logic = logic.replace(
                headerAccessPattern,
                (
                  match: string,
                  quote: string,
                  bracketName: string,
                  dotName: string,
                ) => {
                  const headerName = bracketName || dotName;
                  return `headersList.get('${headerName}')`;
                },
              );

              // Transform standalone req.headers → headersList
              // This handles cases where req.headers is used without property access
              if (logic.includes("req.headers")) {
                logic = logic.replace(/\breq\.headers\b/g, "headersList");
              }

              // Add headersList initialization at the beginning of logic
              logic = `const headersList = await headers();\n${logic}`;
            }

            // Map req -> request (for non-cookie and non-headers req usage)
            // Use negative lookahead to skip req.cookies and req.headers
            logic = logic.replace(/\breq\.(?!cookies|headers)/g, "request.");
            // Also replace standalone req (word boundary) but not req.cookies or req.headers
            logic = logic.replace(/\breq\b(?!\.)/g, "request");

            // Add imports for cookies and/or headers
            if (usesCookies || usesHeaders) {
              const existingHeadersImport =
                sourceFile.getImportDeclaration("next/headers");
              const importsToAdd: string[] = [];

              if (usesCookies) importsToAdd.push("cookies");
              if (usesHeaders) importsToAdd.push("headers");

              if (existingHeadersImport) {
                importsToAdd.forEach((imp) => {
                  const existingImports = existingHeadersImport
                    .getNamedImports()
                    .map((ni) => ni.getName());
                  if (!existingImports.includes(imp)) {
                    existingHeadersImport.addNamedImport(imp);
                  }
                });
              } else if (importsToAdd.length > 0) {
                sourceFile.addImportDeclaration({
                  moduleSpecifier: "next/headers",
                  namedImports: importsToAdd,
                });
              }
            }
            logic = logic.replace(
              /res\.status\((\d+)\)\.json\((.*?)\)/g,
              "return NextResponse.json($2, { status: $1 })",
            );
            logic = logic.replace(
              /res\.json\((.*?)\)/g,
              "return NextResponse.json($1)",
            );
            fnd.getBody()?.replaceWithText(logic);
          }
        }
      }
    }
  }

  return sourceFile.getFullText();
}
