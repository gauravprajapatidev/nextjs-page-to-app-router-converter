import { Project, SyntaxKind, ModuleKind, ScriptTarget } from "ts-morph";
import fs from "fs-extra";

export interface AppConfig {
  globalCssImports: string[];
  providers: string[]; // List of provider component names (legacy)
  providersInfo?: {
    content: string;
    imports: string[];
  };
  htmlAttributes?: string; // e.g. lang="en"
  bodyAttributes?: string; // e.g. className="bg-white"
  hasCustomApp: boolean;
  hasCustomDocument: boolean;
  fonts: {
    import: string;
    declaration: string;
    variableName: string;
    variableOpt?: string; // e.g. '--font-sans'
  }[];
}

export function extractAppConfig(
  appPath?: string,
  documentPath?: string,
): AppConfig {
  const config: AppConfig = {
    globalCssImports: [],
    providers: [],
    hasCustomApp: !!appPath,
    hasCustomDocument: !!documentPath,
    fonts: [],
  };

  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 1, // Preserve
    },
    useInMemoryFileSystem: true,
  });

  if (appPath && fs.existsSync(appPath)) {
    const appContent = fs.readFileSync(appPath, "utf-8");
    const sourceFile = project.createSourceFile("app.tsx", appContent);

    // 1. Extract Global CSS Imports & Fonts
    sourceFile.getImportDeclarations().forEach((importDecl) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      if (
        moduleSpecifier.endsWith(".css") ||
        moduleSpecifier.endsWith(".scss") ||
        moduleSpecifier.endsWith(".sass")
      ) {
        config.globalCssImports.push(`import '${moduleSpecifier}';`);
      }

      // Font detection (next/font/google or next/font/local)
      if (moduleSpecifier.startsWith("next/font/")) {
        const namedImports = importDecl
          .getNamedImports()
          .map((ni) => ni.getName());

        const defaultImport = importDecl.getDefaultImport()?.getText();

        const importedNames = [...namedImports];
        if (defaultImport) importedNames.push(defaultImport);

        if (importedNames.length > 0) {
          // Find initializations of these fonts
          sourceFile.getVariableDeclarations().forEach((varDecl) => {
            const initializer = varDecl.getInitializer();
            if (
              initializer &&
              initializer.getKind() === SyntaxKind.CallExpression
            ) {
              const callExpr = initializer.asKindOrThrow(
                SyntaxKind.CallExpression,
              );
              const expression = callExpr.getExpression().getText();

              if (importedNames.includes(expression)) {
                // Check for variable option
                let variableOpt: string | undefined;
                const args = callExpr.getArguments();
                if (
                  args.length > 0 &&
                  args[0].getKind() === SyntaxKind.ObjectLiteralExpression
                ) {
                  const objLiteral = args[0].asKindOrThrow(
                    SyntaxKind.ObjectLiteralExpression,
                  );
                  const variableProp = objLiteral.getProperty("variable");
                  if (
                    variableProp &&
                    variableProp.getKind() === SyntaxKind.PropertyAssignment
                  ) {
                    const propAssign = variableProp.asKindOrThrow(
                      SyntaxKind.PropertyAssignment,
                    );
                    // Get the string value from initializer
                    const init = propAssign.getInitializer();
                    if (
                      init &&
                      (init.getKind() === SyntaxKind.StringLiteral ||
                        init.getKind() ===
                          SyntaxKind.NoSubstitutionTemplateLiteral)
                    ) {
                      variableOpt = init.getText().replace(/['"`]/g, "");
                    }
                  }
                }

                config.fonts.push({
                  import: importDecl.getText(),
                  declaration: varDecl.getParent().getParent().getText(), // Get the full 'const inter = ...'
                  variableName: varDecl.getName(),
                  variableOpt,
                });
              }
            }
          });
        }
      }
    });

    // Clean up body attributes if font className is used
    if (config.fonts.length > 0) {
      // If we find something like className={inter.className}, we might want to extract it
      // but it's often dynamic in _app. For now, we'll just inject the font in layout.
    }

    // 2. Enhanced Provider Extraction
    const defaultExportDecl = sourceFile
      .getDefaultExportSymbol()
      ?.getDeclarations()[0];

    if (defaultExportDecl) {
      let componentFn: any = null;

      // Resolve the actual component function
      if (defaultExportDecl.getKind() === SyntaxKind.FunctionDeclaration) {
        componentFn = defaultExportDecl;
      } else if (defaultExportDecl.getKind() === SyntaxKind.ExportAssignment) {
        const expression = (defaultExportDecl as any).getExpression();
        if (
          expression.getKind() === SyntaxKind.FunctionExpression ||
          expression.getKind() === SyntaxKind.ArrowFunction
        ) {
          componentFn = expression;
        } else if (expression.getKind() === SyntaxKind.Identifier) {
          const name = expression.getText();
          componentFn =
            sourceFile.getFunction(name) ||
            sourceFile.getVariableDeclaration(name)?.getInitializer();
        }
      }

      if (componentFn) {
        // Find the 'Component' prop name
        // function MyApp({ Component, pageProps })
        let componentPropName = "Component";
        const params = componentFn.getParameters();
        if (params.length > 0) {
          const firstParam = params[0];
          if (
            firstParam.getKind() === SyntaxKind.Parameter &&
            firstParam.getNameNode().getKind() ===
              SyntaxKind.ObjectBindingPattern
          ) {
            const bindingPattern = firstParam.getNameNode() as any;
            bindingPattern.getElements().forEach((el: any) => {
              if (el.getName() === "Component") {
                // If renamed: { Component: MyComponent }
                if (el.getPropertyNameNode()) {
                  componentPropName = el.getNameNode().getText();
                } else {
                  componentPropName = "Component";
                }
              }
            });
          }
        }

        const body = componentFn.getBody();
        if (body) {
          // Find where Component is used in JSX
          // Look for <Component ... />
          const jsxElements = body.getDescendantsOfKind(
            SyntaxKind.JsxSelfClosingElement,
          );
          const componentUsage = jsxElements.find(
            (el: any) => el.getTagNameNode().getText() === componentPropName,
          );

          if (componentUsage) {
            // Find the root JSX element in the return statement
            let returnStmt: any;
            if (body.getKind() === SyntaxKind.Block) {
              returnStmt = body.getStatementByKind(SyntaxKind.ReturnStatement);
            } else {
              // Arrow function implicit return
              returnStmt = body;
            }

            if (returnStmt) {
              let rootJsx: any;
              if (returnStmt.getKind() === SyntaxKind.ReturnStatement) {
                rootJsx = returnStmt.getExpression();
                if (
                  rootJsx &&
                  rootJsx.getKind() === SyntaxKind.ParenthesizedExpression
                ) {
                  rootJsx = rootJsx.getExpression();
                }
              } else {
                rootJsx = returnStmt;
                if (
                  rootJsx &&
                  rootJsx.getKind() === SyntaxKind.ParenthesizedExpression
                ) {
                  rootJsx = rootJsx.getExpression();
                }
              }

              const validJsxKinds = [
                SyntaxKind.JsxElement,
                SyntaxKind.JsxFragment,
                SyntaxKind.JsxSelfClosingElement,
              ];

              if (rootJsx && validJsxKinds.includes(rootJsx.getKind())) {
                // If the root JSX is NOT the Component itself, we have wrappers
                if (rootJsx !== componentUsage) {
                  // Extract the full JSX content
                  let providersContent = rootJsx.getText();

                  // Replace Component usage with {children}
                  // We need to be careful with regex, but strict replace of the component tag text is safest if unique
                  const componentText = componentUsage.getText();
                  providersContent = providersContent.replace(
                    componentText,
                    "{children}",
                  );

                  // Analyze used identifiers to filter imports
                  // This is a heuristic. We scan the providers content for identifiers
                  // and keep imports that match.
                  // Create a temp source file to parse the extracted JSX
                  const tempProject = new Project({
                    useInMemoryFileSystem: true,
                  });
                  const tempFile = tempProject.createSourceFile(
                    "temp.tsx",
                    providersContent,
                  );
                  const usedIdentifiers = new Set(
                    tempFile
                      .getDescendantsOfKind(SyntaxKind.Identifier)
                      .map((id) => id.getText()),
                  );

                  const imports: string[] = [];
                  sourceFile.getImportDeclarations().forEach((decl) => {
                    const defaultImport = decl.getDefaultImport();
                    const namedImports = decl.getNamedImports();

                    let keepDecl = false;

                    // Check default import
                    if (
                      defaultImport &&
                      usedIdentifiers.has(defaultImport.getText())
                    ) {
                      keepDecl = true;
                    }

                    // Check named imports
                    if (namedImports.length > 0) {
                      const keptNamed = namedImports.filter((ni) =>
                        usedIdentifiers.has(ni.getName()),
                      );
                      if (keptNamed.length > 0) {
                        // Reconstruct declaration if partial (complicated),
                        // or just keep the whole declaration if any is used (simplest for now)
                        // Better: create clean import string
                        keepDecl = true;
                      }
                    }

                    // Also check namespace import
                    const namespaceImport = decl.getNamespaceImport();
                    if (
                      namespaceImport &&
                      usedIdentifiers.has(namespaceImport.getText())
                    ) {
                      keepDecl = true;
                    }

                    // Side effect imports (CSS) handled separately in globalCssImports

                    if (keepDecl) {
                      imports.push(decl.getText());
                    }
                  });

                  config.providersInfo = {
                    content: providersContent,
                    imports: imports,
                  };

                  // Also populate legacy providers array for display/logging
                  const helperJsx = tempFile.getDescendantsOfKind(
                    SyntaxKind.JsxOpeningElement,
                  );
                  helperJsx.forEach((el: any) => {
                    const name = el.getTagNameNode().getText();
                    if (
                      name.includes("Provider") ||
                      name.match(/^[A-Z].*Context$/)
                    ) {
                      config.providers.push(name);
                    }
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  if (documentPath && fs.existsSync(documentPath)) {
    // For _document, we primarily want html/body attributes logic which is often just static in many apps
    const docContent = fs.readFileSync(documentPath, "utf-8");
    const sourceFile = project.createSourceFile("document.tsx", docContent);

    // MVP: Regex or simple search for <Html ...> and <Body ...> to extract props might be safer than full AST reconstruction for now
    // AST approach:
    const classDecl = sourceFile.getClass("MyDocument"); // often default class
    // ... implementing robust Document parsing is hard.
    // Fallback: simple text scanning for attributes on <Html> and <Body>

    const htmlMatch = docContent.match(/<Html([^>]*)>/i);
    if (htmlMatch && htmlMatch[1]) {
      config.htmlAttributes = htmlMatch[1].trim();
    }

    const bodyMatch = docContent.match(/<Body([^>]*)>/i);
    if (bodyMatch && bodyMatch[1]) {
      config.bodyAttributes = bodyMatch[1].trim();
    }
  }

  return config;
}
