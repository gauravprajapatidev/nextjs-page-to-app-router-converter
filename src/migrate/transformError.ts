import { Project, SyntaxKind, ScriptTarget, ModuleKind } from "ts-morph";

/**
 * Transforms error pages from Pages Router format to App Router format.
 * 
 * Pages Router _error.tsx receives: { statusCode?, hasGetInitialPropsRun?, err? }
 * App Router error.tsx/global-error.tsx receives: { error: Error, reset: () => void }
 * 
 * Both error.tsx and global-error.tsx must be Client Components ('use client')
 */
export function transformError(
  fileContent: string,
  isGlobal: boolean = false
): string {
  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: 1, // Preserve
    },
    useInMemoryFileSystem: true,
  });

  const sourceFile = project.createSourceFile("error.tsx", fileContent);

  // Error components must be Client Components
  // Check if 'use client' already exists
  const firstStatement = sourceFile.getStatements()[0];
  const hasUseClient = firstStatement && 
    firstStatement.getKind() === SyntaxKind.ExpressionStatement &&
    firstStatement.getText().includes('"use client"');

  if (!hasUseClient) {
    sourceFile.insertStatements(0, '"use client";\n');
  }

  // Find the default export component
  const defaultExport = sourceFile
    .getDefaultExportSymbol()
    ?.getDeclarations()[0]
    ?.asKind(SyntaxKind.FunctionDeclaration);

  if (!defaultExport) {
    // If no default export found, return with 'use client' added
    return sourceFile.getFullText();
  }

  // Transform props from Pages Router to App Router format
  // Old: { statusCode?, hasGetInitialPropsRun?, err? }
  // New: { error: Error & { digest?: string }, reset: () => void }

  const params = defaultExport.getParameters();
  if (params.length > 0) {
    const firstParam = params[0];
    
    // Get the current parameter text
    const paramText = firstParam.getText();
    
    // Transform the props
    // Replace the old props with new props structure
    const isTypeScript = paramText.includes(':');
    
    if (isTypeScript) {
      // TypeScript: Transform the type
      firstParam.replaceWithText(
        '{\n  error: Error & { digest?: string };\n  reset: () => void;\n}'
      );
    } else {
      // JavaScript: Just use destructured props
      firstParam.replaceWithText('{ error, reset }');
    }

    // Update component body to map old props to new
    // If component uses statusCode, err, or hasGetInitialPropsRun, we need to map them
    const body = defaultExport.getBody();
    if (body) {
      let bodyText = body.getText();
      const originalBodyText = bodyText;
      
      // Map old prop usage to new prop usage
      // err -> error (but be careful not to replace "error" in "Error" type)
      bodyText = bodyText.replace(/\berr\b(?!\w)/g, 'error');
      
      // Check if statusCode or hasGetInitialPropsRun are used and add TODO comment
      if (bodyText.includes('statusCode') || bodyText.includes('hasGetInitialPropsRun')) {
        // Prepend a TODO comment at the start of the function body
        const todoComment = '// TODO: Convert old Pages Router props (statusCode, hasGetInitialPropsRun, err) to App Router props (error, reset)\n';
        bodyText = todoComment + bodyText;
      }

      // Update the body if we made changes
      if (bodyText !== originalBodyText) {
        body.replaceWithText(bodyText);
      }
    }
  } else {
    // No parameters - add the new props
    // Try to determine if TypeScript based on file content (presence of type annotations)
    const hasTypeAnnotations = fileContent.includes(':') && 
      (fileContent.includes('Error') || fileContent.includes('string') || fileContent.includes('number'));
    
    if (hasTypeAnnotations) {
      defaultExport.addParameter({
        name: '{ error, reset }',
        type: '{ error: Error & { digest?: string }; reset: () => void }',
      });
    } else {
      defaultExport.addParameter({
        name: '{ error, reset }',
      });
    }
  }

  // For global-error.tsx, ensure it has html/body tags if it doesn't already
  if (isGlobal) {
    const body = defaultExport.getBody();
    if (body) {
      const bodyText = body.getText();
      // Check if html and body tags are present
      const hasHtml = bodyText.includes('<html') || bodyText.includes('<HTML');
      const hasBody = bodyText.includes('<body') || bodyText.includes('<BODY');
      
      if (!hasHtml || !hasBody) {
        // Add a comment suggesting to add html/body tags if missing
        const todoComment = '// TODO: global-error.tsx must include <html> and <body> tags as it replaces the entire layout.\n';
        body.replaceWithText(todoComment + bodyText);
      }
    }
  }

  return sourceFile.getFullText();
}
