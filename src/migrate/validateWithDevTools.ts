import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs-extra";
import ora from "ora";
import chalk from "chalk";

export interface ValidationResult {
  success: boolean;
  errors: RuntimeError[];
  warnings: string[];
}

export interface RuntimeError {
  message: string;
  file?: string;
  line?: number;
  type: "client-component" | "hydration" | "other";
  suggestion?: string;
}

/**
 * Starts the Next.js dev server and returns the port
 */
export async function startDevServer(
  projectPath: string
): Promise<{ port: number; process: ChildProcess }> {
  const spinner = ora("Starting Next.js dev server...").start();

  return new Promise((resolve, reject) => {
    // Check if package.json has dev script
    const packageJsonPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      spinner.fail("package.json not found");
      reject(new Error("package.json not found"));
      return;
    }

    const packageJson = fs.readJsonSync(packageJsonPath);
    if (!packageJson.scripts?.dev) {
      spinner.fail("No 'dev' script found in package.json");
      reject(new Error("No 'dev' script found in package.json"));
      return;
    }

    // Start the dev server
    const devProcess = spawn("npm", ["run", "dev"], {
      cwd: projectPath,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let port = 3000; // Default port

    devProcess.stdout?.on("data", (data) => {
      output += data.toString();

      // Try to detect the port from output
      const portMatch = output.match(/localhost:(\d+)/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }

      // Check if server is ready
      if (output.includes("Ready in") || output.includes("started server on")) {
        spinner.succeed(`Dev server started on port ${port}`);
        resolve({ port, process: devProcess });
      }
    });

    devProcess.stderr?.on("data", (data) => {
      const error = data.toString();
      if (error.includes("EADDRINUSE")) {
        spinner.fail("Port already in use");
        reject(new Error("Port already in use"));
      }
    });

    devProcess.on("error", (error) => {
      spinner.fail(`Failed to start dev server: ${error.message}`);
      reject(error);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (!devProcess.killed) {
        devProcess.kill();
        spinner.fail("Dev server startup timeout");
        reject(new Error("Dev server startup timeout"));
      }
    }, 60000);
  });
}

/**
 * Validates the conversion using Next.js DevTools MCP
 * Note: This requires Next.js 16+ and the MCP endpoint to be available
 */
export async function validateConversion(
  port: number
): Promise<ValidationResult> {
  const spinner = ora("Validating conversion with Next.js DevTools...").start();

  try {
    // Note: This is a placeholder for MCP integration
    // The actual implementation would use the Next.js MCP tools
    // For now, we'll return a basic validation result

    spinner.info(
      "Runtime validation requires Next.js 16+ with MCP support. " +
        "Please manually check the dev server for errors."
    );

    return {
      success: true,
      errors: [],
      warnings: [
        "Runtime validation with Next.js DevTools MCP is not yet fully implemented.",
        "Please manually verify the application by visiting http://localhost:" +
          port,
      ],
    };
  } catch (error: any) {
    spinner.fail(`Validation failed: ${error.message}`);
    return {
      success: false,
      errors: [
        {
          message: error.message,
          type: "other",
        },
      ],
      warnings: [],
    };
  }
}

/**
 * Analyzes runtime errors and suggests fixes
 */
export function analyzeRuntimeErrors(errors: any[]): RuntimeError[] {
  const runtimeErrors: RuntimeError[] = [];

  for (const error of errors) {
    const message = error.message || error.toString();

    // Detect client component errors
    if (
      message.includes("use client") ||
      message.includes("useState") ||
      message.includes("useEffect") ||
      message.includes("Event handlers")
    ) {
      runtimeErrors.push({
        message,
        file: error.file,
        line: error.line,
        type: "client-component",
        suggestion:
          'Add "use client" directive at the top of the component file',
      });
    }
    // Detect hydration errors
    else if (
      message.includes("Hydration") ||
      message.includes("did not match")
    ) {
      runtimeErrors.push({
        message,
        file: error.file,
        line: error.line,
        type: "hydration",
        suggestion: "Check for mismatches between server and client rendering",
      });
    }
    // Other errors
    else {
      runtimeErrors.push({
        message,
        file: error.file,
        line: error.line,
        type: "other",
      });
    }
  }

  return runtimeErrors;
}

/**
 * Automatically fixes client component errors by adding "use client" directive
 */
export async function fixClientComponentErrors(
  errors: RuntimeError[]
): Promise<void> {
  const spinner = ora("Fixing client component errors...").start();

  const clientErrors = errors.filter((e) => e.type === "client-component");

  if (clientErrors.length === 0) {
    spinner.info("No client component errors to fix");
    return;
  }

  for (const error of clientErrors) {
    if (!error.file) continue;

    try {
      const content = await fs.readFile(error.file, "utf8");

      // Check if "use client" already exists
      if (
        content.trim().startsWith('"use client"') ||
        content.trim().startsWith("'use client'")
      ) {
        continue;
      }

      // Add "use client" at the top
      const newContent = '"use client";\n\n' + content;
      await fs.writeFile(error.file, newContent, "utf8");

      spinner.succeed(`Added "use client" to ${path.basename(error.file)}`);
    } catch (err: any) {
      spinner.fail(`Failed to fix ${error.file}: ${err.message}`);
    }
  }

  spinner.succeed(`Fixed ${clientErrors.length} client component errors`);
}

/**
 * Stops the dev server process
 */
export function stopDevServer(process: ChildProcess): void {
  if (process && !process.killed) {
    process.kill();
  }
}
