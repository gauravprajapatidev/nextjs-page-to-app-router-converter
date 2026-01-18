import path from "path";
import type { PageFile } from "./scanPages.js";

export function mapRoute(page: PageFile, targetAppDir: string): string {
  // src/pages/blog/[slug].tsx -> src/app/blog/[slug]/page.tsx
  // src/pages/api/user.ts -> src/app/api/user/route.ts
  // src/pages/404.tsx -> src/app/not-found.tsx
  // pages/about.tsx -> app/about/page.tsx
  
  const dirName = path.dirname(page.relativePath);
  const fileName = path.basename(page.relativePath, page.extension);

  let targetDir = dirName;

  if (fileName !== "index") {
    targetDir = path.join(dirName, fileName);
  }

  if (page.type === 'error') {
    let errorName = 'error';
    if (fileName === '404') {
      errorName = 'not-found';
    } else if (fileName === '_error') {
      // If _error.tsx is in root pages directory, map to global-error.tsx
      // Otherwise map to error.tsx
      if (dirName === '.' || dirName === '') {
        errorName = 'global-error';
      } else {
        errorName = 'error';
      }
    }
    return path.join(targetAppDir, `${errorName}${page.extension}`);
  }

  const outputName = page.type === 'api' ? 'route' : 'page';
  return path.join(targetAppDir, targetDir, `${outputName}${page.extension}`);
}
