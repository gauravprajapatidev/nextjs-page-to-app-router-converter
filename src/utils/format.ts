import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
import util from "util";
import ora from "ora";
import chalk from "chalk";

const execAsync = util.promisify(exec);

export async function formatProject(projectRoot: string, targetDir: string) {
  const spinner = ora("Checking for formatting tools...").start();
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    spinner.info("No package.json found, skipping formatting.");
    return;
  }

  let packageJson;
  try {
    packageJson = await fs.readJson(packageJsonPath);
  } catch (error) {
    spinner.warn("Could not read package.json, skipping formatting.");
    return;
  }

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const hasPrettier = !!allDeps.prettier;
  const hasEsLint = !!allDeps.eslint;

  if (!hasPrettier && !hasEsLint) {
    spinner.info(
      "No Prettier or ESLint found in dependencies, skipping formatting."
    );
    return;
  }

  spinner.succeed("Found formatting tools.");

  // Normalize path to use forward slashes for globs (works better with CLI tools)
  const normalizedTargetDir = targetDir.split(path.sep).join("/");

  if (hasPrettier) {
    const prettierSpinner = ora("Running Prettier...").start();
    try {
      // Format typescript, javascript, and json files in the target directory
      const command = `npx prettier --write "${normalizedTargetDir}/**/*.{ts,tsx,js,jsx,json}"`;
      await execAsync(command, { cwd: projectRoot });
      prettierSpinner.succeed("Prettier completed.");
    } catch (error: any) {
      const errorMessage = error.stderr || error.stdout || error.message;
      prettierSpinner.warn(
        `Prettier failed: ${errorMessage.trim().split("\n")[0]}`
      );
      // If there's more detail in stderr, maybe log it if verbose? For now, first line is often enough if it's "No files matching"
      if (error.stderr) {
        console.log(chalk.gray(error.stderr));
      }
    }
  }

  if (hasEsLint) {
    const eslintSpinner = ora("Running ESLint --fix...").start();
    try {
      // Fix typescript and javascript files
      const command = `npx eslint --fix "${normalizedTargetDir}/**/*.{ts,tsx,js,jsx}"`;
      await execAsync(command, { cwd: projectRoot });
      eslintSpinner.succeed("ESLint fix completed.");
    } catch (error: any) {
      const errorMessage = error.stderr || error.stdout || error.message;
      eslintSpinner.warn(
        `ESLint fix completed with issues (or failed): ${
          errorMessage.trim().split("\n")[0]
        }`
      );
      if (error.stderr) {
        console.log(chalk.gray(error.stderr));
      }
    }
  }
}
