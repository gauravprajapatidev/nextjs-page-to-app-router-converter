#!/usr/bin/env node
import { Command } from "commander";
import figlet from "figlet";
import boxen from "boxen";
import prompts from "prompts";
import chalk from "chalk";
import { migrate } from "./index.js";

const program = new Command();

console.log(
  boxen(chalk.cyan(figlet.textSync("Next.js Migrate", { horizontalLayout: "full" })), {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: "cyan",
  })
);

program
  .name("next-pages-to-app")
  .description("Migrate Next.js Pages Router to App Router")
  .argument("[projectPath]", "Path to the Next.js project")
  .option("-d, --dry-run", "Run the migration in dry-run mode", false)
  .action(async (projectPath, options) => {
    let targetPath = projectPath;

    if (!targetPath) {
      const response = await prompts({
        type: "text",
        name: "path",
        message: "Enter the path to your Next.js project:",
        initial: ".",
      });
      targetPath = response.path;
    }

    if (!targetPath) {
        console.log("Operation cancelled.");
        process.exit(0);
    }

    await migrate(targetPath, options);
  });

program.parse(process.argv);
