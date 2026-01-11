export interface ComponentAnalysis {
  filePath: string;
  classification: "client" | "server" | "unknown";
  reasons: string[];
  hasHooks: boolean;
  hasEventHandlers: boolean;
  hasBrowserAPIs: boolean;
  hasClientLibraries: boolean;
  importedComponents: ComponentAnalysis[];
  confidence: "high" | "medium" | "low";
}

export interface ClientIndicators {
  hooks: string[];
  eventHandlers: string[];
  browserAPIs: string[];
  clientLibraries: string[];
}

// Known client-only libraries that require "use client"
export const CLIENT_ONLY_LIBRARIES = [
  "react-query",
  "@tanstack/react-query",
  "zustand",
  "jotai",
  "recoil",
  "react-hook-form",
  "formik",
  "react-hot-toast",
  "sonner",
  "react-toastify",
  "framer-motion",
  "react-spring",
  "react-use",
  "ahooks",
  "react-intersection-observer",
  "react-window",
  "react-virtualized",
];

// Browser-only APIs that indicate client component
export const BROWSER_APIS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "location",
  "history",
  "screen",
  "performance",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "fetch", // Note: fetch is available on server too, but direct usage often indicates client
  "XMLHttpRequest",
  "WebSocket",
  "IntersectionObserver",
  "MutationObserver",
  "ResizeObserver",
];

// React hooks that require client component
export const REACT_HOOKS = [
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useReducer",
  "useContext",
  "useRef",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
  "useDebugValue",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useSyncExternalStore",
  "useInsertionEffect",
  // Next.js client hooks
  "useRouter", // from next/navigation (client)
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
];
