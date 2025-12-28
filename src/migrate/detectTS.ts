import { Project, SyntaxKind } from "ts-morph";
import { DetectionResult } from "./detectionTypes.js";

const project = new Project({
  skipAddingFilesFromTsConfig: true,
});

export function detectTS(filePath: string): DetectionResult {
  const sourceFile = project.addSourceFileAtPath(filePath);

  const exportedFunctions = sourceFile
    .getFunctions()
    .filter((fn) => fn.isExported());

  const hasGSSP = exportedFunctions.some(
    (fn) => fn.getName() === "getServerSideProps"
  );

  const hasGSP = exportedFunctions.some(
    (fn) => fn.getName() === "getStaticProps"
  );

  const hasGSPPaths = exportedFunctions.some(
    (fn) => fn.getName() === "getStaticPaths"
  );

  const usesUseRouter = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((id) => id.getText() === "useRouter");

  return {
    file: filePath,
    hasGSSP,
    hasGSP,
    hasGSPPaths,
    usesUseRouter,
  };
}
