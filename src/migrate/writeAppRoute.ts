import fs from "fs-extra";
import path from "path";

export async function writeAppRoute(
  target: string,
  content: string,
  options: { dryRun?: boolean }
): Promise<boolean> {
  // const content = await fs.readFile(source, "utf8"); // Content is now passed in

  if (options.dryRun) {
    return true;
  }

  // Safety: Don't overwrite existing files
  if (await fs.pathExists(target)) {
    return false;
  }

  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, content);

  return true;
}
