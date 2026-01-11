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
import { DetectionResult } from "./migrate/detectionTypes.js";
import { ConfidenceResult } from "./migrate/confidenceTypes.js";
import { generateRootLayout } from "./migrate/generateLayout.js";
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

export async function migrate(
  projectPath: string,
  options: { dryRun: boolean; validate?: boolean }
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
      `Error: Could not find 'pages' or 'src/pages' directory in ${absoluteProjectPath}`
    );
    process.exit(1);
  }

  const spinner = ora(`Scanning files in: ${chalk.cyan(pagesDir)}`).start();
  const { pages, apiRoutes, appFile, documentFile } = scanPages(pagesDir);
  const errorPages = pages.filter((p) => p.type === "error");
  const regularPages = pages.filter((p) => p.type === "page");

  spinner.succeed(
    `Found ${regularPages.length} pages, ${apiRoutes.length} API routes, and ${errorPages.length} error pages`
  );

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
      } else {
        transformedContent = transformPage(
          page.absolutePath,
          originalContent,
          absoluteProjectPath
        );
      }

      const migrated = await writeAppRoute(
        targetPath,
        transformedContent,
        options
      );
      if (migrated) {
        const action = options.dryRun ? "Migrated (Dry Run)" : "Migrated";
        pageSpinner.succeed(`${action}: ${page.relativePath}`);
        results.push({
          page: page.relativePath,
          confidence: confidence.confidence,
          status: "Success",
        });
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
      documentFile?.absolutePath
    );

    // Collect manual steps from config
    if (appConfig.providers.length > 0) {
      manualSteps.push(
        `Context Providers were found in _app.js. These have been commented out in layout.${
          useTypeScript ? "tsx" : "js"
        }. Please refactor them into a Client Component wrapper.`
      );
    }

    const created = await generateRootLayout(appDir, appConfig, {
      ...options,
      useTypeScript,
    });
    if (created) {
      const action = options.dryRun ? "Generated (Dry Run)" : "Generated";
      layoutSpinner.succeed(
        `${action}: Root Layout (layout.${useTypeScript ? "tsx" : "js"})`
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

  printManualSteps(manualSteps);

  // Runtime validation with Next.js DevTools (optional)
  if (options.validate && !options.dryRun) {
    console.log("\n" + chalk.cyan("━".repeat(50)));
    console.log(chalk.bold.cyan("Runtime Validation"));
    console.log(chalk.cyan("━".repeat(50)) + "\n");

    try {
      const { port, process: devProcess } = await startDevServer(
        absoluteProjectPath
      );

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
          (e) => e.type === "client-component"
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
          console.log(chalk.yellow(`  • ${w}`))
        );
      }

      // Stop the dev server
      stopDevServer(devProcess);
      console.log(chalk.gray("\nDev server stopped."));
    } catch (error: any) {
      console.log(chalk.red(`\n✗ Validation failed: ${error.message}`));
      console.log(
        chalk.yellow(
          "You can manually verify the migration by running 'npm run dev'"
        )
      );
    }
  } else if (options.validate && options.dryRun) {
    console.log(
      chalk.yellow("\n⚠️  Runtime validation is not available in dry-run mode")
    );
  }
}
