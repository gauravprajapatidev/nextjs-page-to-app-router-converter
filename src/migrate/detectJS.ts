import fs from "fs";
import { parse } from "@babel/parser";
// @ts-ignore
import _traverse from "@babel/traverse";
const traverse: any = _traverse.default || _traverse;

import { DetectionResult } from "./detectionTypes.js";

export function detectJS(filePath: string): DetectionResult {
  const code = fs.readFileSync(filePath, "utf8");

  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx"],
  });

  let hasGSSP = false;
  let hasGSP = false;
  let hasGSPPaths = false;
  let usesUseRouter = false;

  traverse(ast, {
    ExportNamedDeclaration(path: any) {
      const decl = path.node.declaration;
      if (decl?.type === "FunctionDeclaration") {
        const name = decl.id?.name;
        if (name === "getServerSideProps") hasGSSP = true;
        if (name === "getStaticProps") hasGSP = true;
        if (name === "getStaticPaths") hasGSPPaths = true;
      }
    },
    Identifier(path: any) {
      if (path.node.name === "useRouter") {
        usesUseRouter = true;
      }
    },
  });

  return {
    file: filePath,
    hasGSSP,
    hasGSP,
    hasGSPPaths,
    usesUseRouter,
  };
}
