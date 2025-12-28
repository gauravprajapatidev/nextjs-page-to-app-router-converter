import chalk from "chalk";
import { DetectionResult } from "../migrate/detectionTypes.js";
import { ConfidenceResult } from "../migrate/confidenceTypes.js";

export function printWarnings(result: DetectionResult) {
  const warnings: string[] = [];

  if (result.hasGSSP) {
    warnings.push(
      "Uses getServerSideProps (must be migrated to async server component)"
    );
  }

  if (result.hasGSP) {
    warnings.push(
      "Uses getStaticProps (can be migrated to async server component)"
    );
  }

  if (result.hasGSPPaths) {
    warnings.push(
      "Uses getStaticPaths (requires dynamic route handling in App Router)"
    );
  }

  if (result.usesUseRouter) {
    warnings.push("Uses useRouter (consider useParams or useSearchParams)");
  }

  if (warnings.length) {
    console.log(chalk.yellow(`\n⚠ ${result.file}`));
    warnings.forEach((w) => console.log(chalk.gray(`  - ${w}`)));
  }
}

export function printConfidence(result: ConfidenceResult) {
  const label =
    result.confidence === "safe"
      ? chalk.green("SAFE")
      : result.confidence === "review"
      ? chalk.yellow("REVIEW")
      : chalk.red("UNSUPPORTED");

  console.log(`\n${label}  ${result.file}`);

  result.reasons.forEach((reason) => {
    console.log(chalk.gray(`  - ${reason}`));
  });
}

export function summarizeResults(results: { page: string; confidence: string; status: string }[]) {
  const success = results.filter((r) => r.status === "Success").length;
  const skipped = results.filter((r) => r.status === "Skipped").length;
  const error = results.filter((r) => r.status === "Error").length;

  console.log("\n" + chalk.bgBlue.white.bold(" MIGRATION SUMMARY ") + "\n");
  console.log(`Total Pages: ${results.length}`);
  console.log(chalk.green(`Success:     ${success}`));
  console.log(chalk.yellow(`Skipped:     ${skipped}`));
  console.log(chalk.red(`Failed:      ${error}`));
  console.log("\n");
}

export function printManualSteps(steps: string[]) {
  if (steps.length === 0) return;

  console.log(chalk.bgMagenta.white.bold("\n MANUAL MIGRATION STEPS "));
  console.log(chalk.gray("The following items could not be automatically migrated and require manual attention:\n"));
  
  steps.forEach((step, index) => {
    console.log(chalk.magenta(`${index + 1}. ${step}`));
  });
  console.log("\n");
}
