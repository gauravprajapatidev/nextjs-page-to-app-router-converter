import fs from "fs-extra";
import path from "path";

const PAGE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

export type PageFile = {
  absolutePath: string;
  relativePath: string; // Relative to "pages" directory
  extension: string;
  type: 'page' | 'api' | 'error';
};

export type ScanResult = {
  pages: PageFile[];
  apiRoutes: PageFile[];
  appFile?: PageFile;
  documentFile?: PageFile;
};

export function scanPages(dir: string, rootDir: string = dir): ScanResult {
  if (!fs.existsSync(dir)) return { pages: [], apiRoutes: [] };

  let pages: PageFile[] = [];
  let apiRoutes: PageFile[] = [];
  let appFile: PageFile | undefined;
  let documentFile: PageFile | undefined;
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      // Recursively scan subdirectories
      if (!file.startsWith("_")) {
        const subResult = scanPages(fullPath, rootDir);
        pages = pages.concat(subResult.pages);
        apiRoutes = apiRoutes.concat(subResult.apiRoutes);
        // We assume _app and _document are only in the root pages dir
      }
    } else {
      const ext = path.extname(file);
      const relativePath = path.relative(rootDir, fullPath);
      const isApi = relativePath.startsWith("api" + path.sep) || relativePath === "api";
      const isError = file.startsWith("404") || file.startsWith("500") || file.startsWith("_error");

      const pageFile: PageFile = {
        absolutePath: fullPath,
        relativePath,
        extension: ext,
        type: isError ? 'error' : (isApi ? 'api' : 'page')
      };

      if (file.startsWith("_app")) {
        appFile = pageFile;
      } else if (file.startsWith("_document")) {
        documentFile = pageFile;
      } else if (PAGE_EXTENSIONS.includes(ext) && (!file.startsWith("_") || file.startsWith("_error"))) {
         if (isApi) {
             apiRoutes.push(pageFile);
         } else {
             pages.push(pageFile);
         }
      }
    }
  }

  return { pages, apiRoutes, appFile, documentFile };
}
