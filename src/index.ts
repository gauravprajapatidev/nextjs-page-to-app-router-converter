import path from "path";
import fs from "fs-extra";
import ora from "ora";
import chalk from "chalk";
import { scanPages } from "./migrate/scanPages.js";
import { detectPage } from "./migrate/detectPage.js";
import { classifyConfidence } from "./migrate/classifyConfidence.js";
import {
  printConfidence,
  summarizeResults,
  printManualSteps,
} from "./utils/logger.js";
import { mapRoute } from "./migrate/routeMapper.js";
import { writeAppRoute } from "./migrate/writeAppRoute.js";
import { transformPage } from "./migrate/transformPage.js";
import { transformApi } from "./migrate/transformApi.js";
import { transformError } from "./migrate/transformError.js";
import { transformMiddleware } from "./migrate/transformMiddleware.js";
import { DetectionResult } from "./migrate/detectionTypes.js";
import { ConfidenceResult } from "./migrate/confidenceTypes.js";
import {
  generateRootLayout,
  extractGetLayout,
  generateNestedLayout,
} from "./migrate/generateLayout.js";
import { generateLoadingFile } from "./migrate/generateLoading.js";
import { validateProject } from "./migrate/checkConfig.js";
import { extractAppConfig } from "./migrate/extractAppConfig.js";
import { checkDependencies } from "./migrate/checkDeps.js";
import {
  startDevServer,
  validateConversion,
  stopDevServer,
  fixClientComponentErrors,
} from "./migrate/validateWithDevTools.js";
import { formatProject } from "./utils/format.js";
import {
  analyzeNextConfig,
  printConfigAnalysis,
} from "./migrate/analyzeNextConfig.js";

export async function migrate(
  projectPath: string,
  options: { dryRun: boolean; validate?: boolean },
) {
  const absoluteProjectPath = path.resolve(projectPath);

  // Check for src/pages or pages
  let pagesDir = path.join(absoluteProjectPath, "pages");
  if (!fs.existsSync(pagesDir)) {
    pagesDir = path.join(absoluteProjectPath, "src", "pages");
  }

  // Detect TypeScript
  const tsConfigPath = path.join(absoluteProjectPath, "tsconfig.json");
  const useTypeScript = fs.existsSync(tsConfigPath);

  // Pre-flight check: Version & Dependency validation
  if (!validateProject(absoluteProjectPath)) {
    process.exit(1);
  }

  const { warnings: depWarnings } = checkDependencies(absoluteProjectPath);
  depWarnings.forEach((w) => console.log(chalk.yellow(`⚠️  ${w}`)));

  if (!fs.existsSync(pagesDir)) {
    const spinner = ora("Checking project structure...").start();
    spinner.fail(
      `Error: Could not find 'pages' or 'src/pages' directory in ${absoluteProjectPath}`,
    );
    process.exit(1);
  }

  const spinner = ora(`Scanning files in: ${chalk.cyan(pagesDir)}`).start();
  const { pages, apiRoutes, appFile, documentFile } = scanPages(pagesDir);
  const errorPages = pages.filter((p) => p.type === "error");
  const regularPages = pages.filter((p) => p.type === "page");

  // Detect middleware file at root level
  const middlewareExtensions = [".ts", ".js", ".tsx", ".jsx"];
  let middlewarePath: string | null = null;
  for (const ext of middlewareExtensions) {
    const testPath = path.join(absoluteProjectPath, `middleware${ext}`);
    if (fs.existsSync(testPath)) {
      middlewarePath = testPath;
      break;
    }
  }

  spinner.succeed(
    `Found ${regularPages.length} pages, ${apiRoutes.length} API routes, ${errorPages.length} error pages${middlewarePath ? ", and middleware file" : ""}`,
  );

  // Analyze next.config.js for redirects and rewrites
  const configAnalysis = analyzeNextConfig(absoluteProjectPath);
  printConfigAnalysis(configAnalysis);

  // Determine target 'app' directory (sibling to 'pages')
  const appDir = path.join(path.dirname(pagesDir), "app");
  const manualSteps: string[] = [];
  const results: { page: string; confidence: string; status: string }[] = [];

  const allRoutes = [...pages, ...apiRoutes];

  for (const page of allRoutes) {
    const pageSpinner = ora(`Processing ${page.relativePath}...`).start();

    const detection = detectPage(page.absolutePath);
    const confidence = classifyConfidence(detection);

    // Perform migration (or dry run)
    const targetPath = mapRoute(page, appDir);

    try {
      const originalContent = fs.readFileSync(page.absolutePath, "utf8");
      let transformedContent = "";

      if (page.type === "api") {
        transformedContent = transformApi(page.absolutePath, originalContent);
      } else if (page.type === "error") {
        // Determine if this is a global-error.tsx (root-level _error.tsx)
        const fileName = path.basename(page.relativePath, page.extension);
        const dirName = path.dirname(page.relativePath);
        const isGlobal =
          fileName === "_error" && (dirName === "." || dirName === "");

        transformedContent = transformError(originalContent, isGlobal);
      } else {
        transformedContent = transformPage(
          page.absolutePath,
          originalContent,
          absoluteProjectPath,
        );
      }

      const migrated = await writeAppRoute(
        targetPath,
        transformedContent,
        options,
      );
      if (migrated) {
        const action = options.dryRun ? "Migrated (Dry Run)" : "Migrated";
        pageSpinner.succeed(`${action}: ${page.relativePath}`);
        results.push({
          page: page.relativePath,
          confidence: confidence.confidence,
          status: "Success",
        });

        // Generate loading.tsx for regular pages (not API routes or error pages)
        if (page.type === "page") {
          try {
            await generateLoadingFile(targetPath, page, {
              ...options,
              useTypeScript,
            });
          } catch (error) {
            // Silently fail - loading.tsx is optional
          }

          // Extract and generate nested layout if Page.getLayout pattern exists
          try {
            const layoutInfo = extractGetLayout(
              originalContent,
              page.absolutePath,
              absoluteProjectPath,
            );

            if (layoutInfo) {
              // Generate layout.tsx in the same directory as the page
              const layoutDir = path.dirname(targetPath);
              await generateNestedLayout(layoutDir, layoutInfo, {
                ...options,
                useTypeScript,
              });
            }
          } catch (error) {
            // Silently fail - layout generation is optional
            // If getLayout extraction fails, the page will still be migrated
          }
        }
      } else {
        // Skipped
        pageSpinner.warn(`Skipped: ${page.relativePath} (Target exists)`);
        results.push({
          page: page.relativePath,
          confidence: confidence.confidence,
          status: "Skipped",
        });
      }
    } catch (e) {
      pageSpinner.fail(`Failed: ${page.relativePath}`);
      results.push({
        page: page.relativePath,
        confidence: confidence.confidence,
        status: "Error",
      });
    }

    // Log detailed analysis if needed, or keep it quiet for professional look?
    // Let's print unique warnings if unsafe
    if (confidence.confidence !== "safe") {
      printConfidence(confidence);
    }
  }

  summarizeResults(results);

  // Generate Root Layout if missing
  const layoutSpinner = ora("Checking Root Layout...").start();
  try {
    const appConfig = extractAppConfig(
      appFile?.absolutePath,
      documentFile?.absolutePath,
    );

    // Collect manual steps from config
    if (appConfig.providers.length > 0) {
      manualSteps.push(
        `Context Providers were found in _app.js. These have been commented out in layout.${
          useTypeScript ? "tsx" : "js"
        }. Please refactor them into a Client Component wrapper.`,
      );
    }

    const created = await generateRootLayout(appDir, appConfig, {
      ...options,
      useTypeScript,
    });
    if (created) {
      const action = options.dryRun ? "Generated (Dry Run)" : "Generated";
      layoutSpinner.succeed(
        `${action}: Root Layout (layout.${useTypeScript ? "tsx" : "js"})`,
      );
    } else {
      layoutSpinner.info("Root Layout already exists");
    }
  } catch (e) {
    layoutSpinner.fail("Failed to generate Root Layout");
  }

  // Run formatting if available
  if (!options.dryRun) {
    await formatProject(absoluteProjectPath, appDir);
  }

  // Migrate middleware (stays at root level, not in app/)
  if (middlewarePath) {
    const middlewareSpinner = ora("Processing middleware...").start();
    try {
      const originalContent = fs.readFileSync(middlewarePath, "utf8");
      const transformedContent = transformMiddleware(
        middlewarePath,
        originalContent,
      );

      // Middleware stays at root level (same location for App Router)
      const targetMiddlewarePath = middlewarePath; // Keep at root

      if (options.dryRun) {
        middlewareSpinner.succeed("Middleware migration (Dry Run)");
        results.push({
          page: path.relative(absoluteProjectPath, middlewarePath),
          confidence: "safe",
          status: "Success",
        });
      } else {
        // Only write if content changed (to avoid unnecessary file writes)
        if (transformedContent !== originalContent) {
          await fs.writeFile(targetMiddlewarePath, transformedContent);
          middlewareSpinner.succeed("Middleware migrated");
          results.push({
            page: path.relative(absoluteProjectPath, middlewarePath),
            confidence: "safe",
            status: "Success",
          });
        } else {
          middlewareSpinner.info(
            "Middleware already compatible (no changes needed)",
          );
          results.push({
            page: path.relative(absoluteProjectPath, middlewarePath),
            confidence: "safe",
            status: "Skipped",
          });
        }
      }
    } catch (e: any) {
      middlewareSpinner.fail(`Failed to migrate middleware: ${e.message}`);
      results.push({
        page: path.relative(absoluteProjectPath, middlewarePath),
        confidence: "unsafe",
        status: "Error",
      });
    }
  }

  printManualSteps(manualSteps);

  // Runtime validation with Next.js DevTools (optional)
  if (options.validate && !options.dryRun) {
    console.log("\n" + chalk.cyan("━".repeat(50)));
    console.log(chalk.bold.cyan("Runtime Validation"));
    console.log(chalk.cyan("━".repeat(50)) + "\n");

    try {
      const { port, process: devProcess } =
        await startDevServer(absoluteProjectPath);

      // Wait a bit for the server to fully start
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const validationResult = await validateConversion(port);

      if (!validationResult.success) {
        console.log(chalk.yellow("\n⚠️  Validation found issues:"));
        validationResult.errors.forEach((err) => {
          console.log(chalk.red(`  • ${err.message}`));
          if (err.suggestion) {
            console.log(chalk.gray(`    Suggestion: ${err.suggestion}`));
          }
        });

        // Attempt to fix client component errors
        const clientErrors = validationResult.errors.filter(
          (e) => e.type === "client-component",
        );
        if (clientErrors.length > 0) {
          await fixClientComponentErrors(clientErrors);
        }
      } else {
        console.log(chalk.green("✓ Validation passed!"));
      }

      if (validationResult.warnings.length > 0) {
        console.log(chalk.yellow("\nWarnings:"));
        validationResult.warnings.forEach((w) =>
          console.log(chalk.yellow(`  • ${w}`)),
        );
      }

      // Stop the dev server
      stopDevServer(devProcess);
      console.log(chalk.gray("\nDev server stopped."));
    } catch (error: any) {
      console.log(chalk.red(`\n✗ Validation failed: ${error.message}`));
      console.log(
        chalk.yellow(
          "You can manually verify the migration by running 'npm run dev'",
        ),
      );
    }
  } else if (options.validate && options.dryRun) {
    console.log(
      chalk.yellow("\n⚠️  Runtime validation is not available in dry-run mode"),
    );
  }
}
