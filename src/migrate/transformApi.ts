import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";

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

            // Map req -> request
            caseLogic = caseLogic.replace(/\breq\b/g, "request");
            // Map res.status().json() -> return NextResponse.json({}, { status: ... })
            caseLogic = caseLogic.replace(
              /res\.status\((\d+)\)\.json\((.*?)\)/g,
              "return NextResponse.json($2, { status: $1 })"
            );
            caseLogic = caseLogic.replace(
              /res\.json\((.*?)\)/g,
              "return NextResponse.json($1)"
            );
            // Map res.status().end() -> return new NextResponse(null, { status: ... })
            caseLogic = caseLogic.replace(
              /res\.status\((\d+)\)\.end\((.*?)\)/g,
              "return new NextResponse($2, { status: $1 })"
            );
            // Map res.setHeader -> // TODO: res.setHeader is not available in App Router. Use Headers object or return NextResponse with headers.
            caseLogic = caseLogic.replace(
              /res\.setHeader\((.*?)\)/g,
              "/* TODO: res.setHeader($1) - headers moved to NextResponse */"
            );
            // Map res.status() -> // TODO: res.status is not available in App Router. Status moved to NextResponse.
            caseLogic = caseLogic.replace(
              /res\.status\((\d+)\)/g,
              "/* TODO: res.status($1) - status moved to NextResponse */"
            );

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
          logic = logic.replace(/\breq\b/g, "request");
          logic = logic.replace(
            /res\.status\((\d+)\)\.json\((.*?)\)/g,
            "return NextResponse.json($2, { status: $1 })"
          );
          logic = logic.replace(
            /res\.json\((.*?)\)/g,
            "return NextResponse.json($1)"
          );
          fnd.getBody()?.replaceWithText(logic);
        }
      }
    }
  }

  return sourceFile.getFullText();
}
