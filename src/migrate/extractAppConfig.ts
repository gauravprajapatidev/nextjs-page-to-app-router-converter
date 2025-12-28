import { Project, SyntaxKind, ModuleKind, ScriptTarget } from "ts-morph";
import fs from "fs-extra";

export interface AppConfig {
  globalCssImports: string[];
  providers: string[]; // List of provider component names (simplified for now)
  htmlAttributes?: string; // e.g. lang="en"
  bodyAttributes?: string; // e.g. className="bg-white"
  hasCustomApp: boolean;
  hasCustomDocument: boolean;
  fonts: {
    import: string;
    declaration: string;
    variableName: string;
  }[];
}

export function extractAppConfig(
  appPath?: string,
  documentPath?: string
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
        if (namedImports.length > 0) {
          // Find initializations of these fonts
          sourceFile.getVariableDeclarations().forEach((varDecl) => {
            const initializer = varDecl.getInitializer();
            if (
              initializer &&
              initializer.getKind() === SyntaxKind.CallExpression
            ) {
              const callExpr = initializer.asKindOrThrow(
                SyntaxKind.CallExpression
              );
              const expression = callExpr.getExpression().getText();
              if (namedImports.includes(expression)) {
                config.fonts.push({
                  import: importDecl.getText(),
                  declaration: varDecl.getParent().getParent().getText(), // Get the full 'const inter = ...'
                  variableName: varDecl.getName(),
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

    // 2. Initial Provider Detection (MVP: Check for nested components in return statement)
    // This is complex to do perfectly with AST without deep analysis,
    // so for MVP we will look for 'Context.Provider' or common patterns if needed.
    // For now, we'll mark a TODO if we detect a complex return.
    let defaultExportDecl = sourceFile
      .getDefaultExportSymbol()
      ?.getDeclarations()[0];

    if (defaultExportDecl) {
      let componentBody: any = null;
      if (defaultExportDecl.getKind() === SyntaxKind.FunctionDeclaration) {
        componentBody = (defaultExportDecl as any).getBody();
      } else if (defaultExportDecl.getKind() === SyntaxKind.ExportAssignment) {
        const identifier = (defaultExportDecl as any).getExpression().getText();
        const originalDecl =
          sourceFile.getFunction(identifier) ||
          sourceFile.getVariableDeclaration(identifier);
        if (originalDecl) {
          if (originalDecl.getKind() === SyntaxKind.FunctionDeclaration) {
            componentBody = (originalDecl as any).getBody();
          } else if (
            originalDecl.getKind() === SyntaxKind.VariableDeclaration
          ) {
            const initializer = (originalDecl as any).getInitializer();
            if (
              initializer &&
              (initializer.getKind() === SyntaxKind.ArrowFunction ||
                initializer.getKind() === SyntaxKind.FunctionExpression)
            ) {
              componentBody = initializer.getBody();
            }
          }
        }
      }

      if (componentBody) {
        // Find JsxElements that likely wrap children
        const jsxElements = componentBody.getDescendantsOfKind(
          SyntaxKind.JsxOpeningElement
        );
        jsxElements.forEach((el: any) => {
          const name = el.getTagNameNode().getText();
          if (name.includes("Provider") || name.match(/^[A-Z].*Context$/)) {
            config.providers.push(name);
          }
        });
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
