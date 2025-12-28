import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import semver from "semver";

export function validateProject(projectRoot: string): boolean {
  // 1. Check package.json for Next.js version
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = fs.readJsonSync(packageJsonPath);
      const nextVersion = pkg.dependencies?.next || pkg.devDependencies?.next;
      
      if (nextVersion) {
        // coerced allows "13.4.1", "^13.4.1", etc. to be parsed to "13.4.1"
        const cleanVersion = semver.coerce(nextVersion); 
        
        if (cleanVersion && semver.lt(cleanVersion, "13.4.0")) {
          console.error(chalk.red(`\n✖ Error: Your Next.js version (${nextVersion}) is too old.`));
          console.error(chalk.red(`  App Router requires Next.js 13.4 or later.`));
          console.error(chalk.yellow(`  Please upgrade by running: npm install next@latest react@latest react-dom@latest\n`));
          return false;
        } else if (cleanVersion) {
            console.log(chalk.green(`✔ Validated Next.js version: ${cleanVersion} (Compatible)`));
        }
      } else {
        console.warn(chalk.yellow("\n⚠ Warning: Could not find 'next' in package.json dependencies. Assuming compatible version."));
      }
    } catch (e) {
      console.warn(chalk.yellow("\n⚠ Warning: Could not parse package.json for version check."));
    }
  }

  // 2. Check next.config.js (Existing logic)
  checkConfig(projectRoot);
  
  return true;
}

export function checkConfig(projectRoot: string) {
  const configPath = path.join(projectRoot, "next.config.js");
  
  if (fs.existsSync(configPath)) {
    // console.log(chalk.blue("\nℹ Info: Checked next.config.js"));
  } else {
    // console.log(chalk.yellow("\n⚠️  Warning: next.config.js not found.")); 
    // Less spammy if we did the strict check above
  }
}
