import { SourceFile, SyntaxKind, JsxElement, JsxSelfClosingElement, Node } from "ts-morph";

export interface ExtractedMetadata {
  metadataBase?: string;
  title?: string | { template?: string; default?: string; absolute?: string };
  description?: string;
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    images?: Array<{
      url: string;
      width?: number;
      height?: number;
      alt?: string;
    }>;
    locale?: string;
    type?: string;
    [key: string]: any;
  };
  twitter?: {
    card?: string;
    title?: string;
    description?: string;
    images?: string[];
    creator?: string;
    site?: string;
    [key: string]: any;
  };
  robots?: string | { index?: boolean; follow?: boolean; [key: string]: any };
  icons?: string | Array<{ url: string; type?: string; sizes?: string }> | { icon?: string | Array<{ url: string; type?: string }>; apple?: string | Array<{ url: string; sizes?: string }>; shortcut?: string; [key: string]: any };
  manifest?: string;
  alternates?: {
    canonical?: string;
    languages?: Record<string, string>;
    [key: string]: any;
  };
  appLinks?: {
    ios?: { appId?: string; appStoreId?: string; url?: string };
    android?: { package?: string; url?: string };
    [key: string]: any;
  };
  category?: string;
  other?: Record<string, string>;
  isDynamic?: boolean; // If true, suggests using generateMetadata
}

/**
 * Extracts metadata from <Head> components in a source file
 */
export function extractMetadataFromHead(sourceFile: SourceFile): ExtractedMetadata | null {
  const metadata: ExtractedMetadata = { other: {} };

  // Find all <Head> JSX elements
  const headElements = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxElement)
    .filter(
      (el) => el.getOpeningElement().getTagNameNode().getText() === "Head"
    );

  const headSelfClosing = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
    .filter(
      (el) => el.getTagNameNode().getText() === "Head"
    );

  if (headElements.length === 0 && headSelfClosing.length === 0) {
    return null;
  }

  // Check if Head contains dynamic content (functions, variables, etc.)
  let hasDynamicContent = false;
  
  // Collect all meta tags first to handle og:image:* properly
  const allMetaTags: Array<{ name: string; content: string; attributes: Record<string, string> }> = [];
  const allLinkTags: Array<Record<string, string>> = [];

  // Process all Head elements
  [...headElements, ...headSelfClosing].forEach((head) => {
    if (head.getKind() === SyntaxKind.JsxSelfClosingElement) {
      return; // Self-closing Head has no children
    }

    const headElement = head.asKindOrThrow(SyntaxKind.JsxElement);
    headElement.getJsxChildren().forEach((child) => {
      // Check for dynamic content
      if (
        child.getKind() === SyntaxKind.JsxExpression ||
        child.getText().includes("${") ||
        child.getText().includes("{")
      ) {
        hasDynamicContent = true;
      }

      if (child.getKind() === SyntaxKind.JsxElement) {
        const childElement = child.asKindOrThrow(SyntaxKind.JsxElement);
        const tagName = childElement.getOpeningElement().getTagNameNode().getText();
        const openingElement = childElement.getOpeningElement();
        const attributes: Record<string, string> = {};
        
        openingElement.getAttributes().forEach((attr: any) => {
          if (attr.getKind() === SyntaxKind.JsxAttribute) {
            const jsxAttr = attr.asKindOrThrow(SyntaxKind.JsxAttribute);
            const name = jsxAttr.getNameNode().getText();
            const initializer = jsxAttr.getInitializer();

            if (initializer) {
              if (initializer.getKind() === SyntaxKind.StringLiteral) {
                attributes[name] = initializer.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
              } else if (initializer.getKind() === SyntaxKind.JsxExpression) {
                hasDynamicContent = true;
                attributes[name] = initializer.getText();
              }
            }
          }
        });

        if (tagName.toLowerCase() === "title") {
          const textNodes = childElement.getDescendantsOfKind(SyntaxKind.JsxText);
          const titleText = textNodes
            .map((node) => node.getText().trim())
            .join("")
            .trim();
          if (titleText) {
            metadata.title = titleText;
          }
        } else if (tagName.toLowerCase() === "meta") {
          const name = attributes.name || attributes.property || attributes["http-equiv"];
          const content = attributes.content;
          if (name && content) {
            allMetaTags.push({ name, content, attributes });
          }
        } else if (tagName.toLowerCase() === "link") {
          allLinkTags.push(attributes);
        } else if (tagName.toLowerCase() === "base") {
          if (attributes.href) {
            metadata.metadataBase = attributes.href;
          }
        }
      } else if (child.getKind() === SyntaxKind.JsxSelfClosingElement) {
        const childElement = child.asKindOrThrow(SyntaxKind.JsxSelfClosingElement);
        const tagName = childElement.getTagNameNode().getText();
        const attributes: Record<string, string> = {};
        
        childElement.getAttributes().forEach((attr: any) => {
          if (attr.getKind() === SyntaxKind.JsxAttribute) {
            const jsxAttr = attr.asKindOrThrow(SyntaxKind.JsxAttribute);
            const name = jsxAttr.getNameNode().getText();
            const initializer = jsxAttr.getInitializer();

            if (initializer) {
              if (initializer.getKind() === SyntaxKind.StringLiteral) {
                attributes[name] = initializer.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
              } else if (initializer.getKind() === SyntaxKind.JsxExpression) {
                hasDynamicContent = true;
                attributes[name] = initializer.getText();
              }
            }
          }
        });

        if (tagName.toLowerCase() === "meta") {
          const name = attributes.name || attributes.property || attributes["http-equiv"];
          const content = attributes.content;
          if (name && content) {
            allMetaTags.push({ name, content, attributes });
          }
        } else if (tagName.toLowerCase() === "link") {
          allLinkTags.push(attributes);
        } else if (tagName.toLowerCase() === "base") {
          if (attributes.href) {
            metadata.metadataBase = attributes.href;
          }
        }
      }
    });
  });

  // Process all meta tags together (to handle og:image:* properly)
  processAllMetaTags(allMetaTags, metadata);
  
  // Process all link tags
  allLinkTags.forEach((attributes) => {
    processLinkTag(attributes, metadata);
  });

  if (hasDynamicContent) {
    metadata.isDynamic = true;
  }

  // Only return metadata if we found something
  if (
    !metadata.title &&
    !metadata.description &&
    !metadata.openGraph &&
    !metadata.twitter &&
    !metadata.robots &&
    !metadata.icons &&
    !metadata.manifest &&
    !metadata.alternates &&
    !metadata.appLinks &&
    !metadata.category &&
    Object.keys(metadata.other || {}).length === 0
  ) {
    return null;
  }

  return metadata;
}

/**
 * Processes all meta tags together (to handle og:image:* properly)
 */
function processAllMetaTags(
  metaTags: Array<{ name: string; content: string; attributes: Record<string, string> }>,
  metadata: ExtractedMetadata
): void {
  // First pass: collect og:image URLs and their related properties
  const ogImageData: Map<string, any> = new Map();
  const ogImageUrls: string[] = [];
  
  // Collect all og:image URLs
  metaTags.forEach((tag) => {
    if (tag.name === "og:image" || tag.name === "og:image:url") {
      if (!ogImageData.has(tag.content)) {
        ogImageData.set(tag.content, { url: tag.content });
        ogImageUrls.push(tag.content);
      }
    }
  });

  // Second pass: collect og:image:* properties
  // For simplicity, associate them with the first/last image
  // (More complex cases may need manual adjustment)
  metaTags.forEach((tag) => {
    if (tag.name.startsWith("og:image:")) {
      const imageKey = tag.name.replace("og:image:", "");
      if (imageKey !== "url" && ogImageUrls.length > 0) {
        // Associate with the last image URL (most common pattern)
        const imageUrl = ogImageUrls[ogImageUrls.length - 1];
        if (!ogImageData.has(imageUrl)) {
          ogImageData.set(imageUrl, { url: imageUrl });
        }
        const image = ogImageData.get(imageUrl);
        if (imageKey === "width") {
          image.width = parseInt(tag.content, 10);
        } else if (imageKey === "height") {
          image.height = parseInt(tag.content, 10);
        } else if (imageKey === "alt") {
          image.alt = tag.content;
        }
      }
    }
  });

  // Process all meta tags (excluding og:image:* which we handled above)
  metaTags.forEach((tag) => {
    if (!tag.name.startsWith("og:image:")) {
      processMetaTag(tag.name, tag.content, metadata);
    }
  });
  
  // Add collected og:image objects to metadata
  if (ogImageData.size > 0) {
    if (!metadata.openGraph) metadata.openGraph = {};
    metadata.openGraph.images = Array.from(ogImageData.values());
  }
}

/**
 * Processes a <meta> tag
 */
function processMetaTag(
  name: string,
  content: string,
  metadata: ExtractedMetadata
): void {
  if (!name || !content) return;

  // Standard meta tags
  if (name === "description") {
    metadata.description = content;
  } else if (name === "robots") {
    metadata.robots = parseRobots(content);
  } else if (name === "category") {
    metadata.category = content;
  } else if (name === "theme-color") {
    // Add to other
    if (!metadata.other) metadata.other = {};
    metadata.other[name] = content;
  }

  // Open Graph tags (og:image:* are handled in processAllMetaTags)
  if (name.startsWith("og:") && !name.startsWith("og:image:")) {
    if (!metadata.openGraph) metadata.openGraph = {};

    const ogKey = name.replace("og:", "");
    if (ogKey === "image" || ogKey === "image:url") {
      // Simple og:image (handled in processAllMetaTags, but add here as fallback)
      if (!metadata.openGraph.images) metadata.openGraph.images = [];
      metadata.openGraph.images.push({ url: content });
    } else if (ogKey === "audio") {
      if (!metadata.openGraph.audio) metadata.openGraph.audio = [];
      metadata.openGraph.audio.push({ url: content });
    } else if (ogKey === "video") {
      if (!metadata.openGraph.videos) metadata.openGraph.videos = [];
      metadata.openGraph.videos.push({ url: content });
    } else {
      // Map common OG properties
      const propertyMap: Record<string, string> = {
        "title": "title",
        "description": "description",
        "url": "url",
        "site_name": "siteName",
        "locale": "locale",
        "type": "type",
      };
      const mappedKey = propertyMap[ogKey] || ogKey;
      metadata.openGraph[mappedKey] = content;
    }
  }

  // Twitter Card tags
  if (name.startsWith("twitter:")) {
    if (!metadata.twitter) metadata.twitter = {};

    const twitterKey = name.replace("twitter:", "");
    if (twitterKey === "image" || twitterKey === "image:src") {
      if (!metadata.twitter.images) metadata.twitter.images = [];
      metadata.twitter.images.push(content);
    } else {
      const propertyMap: Record<string, string> = {
        "card": "card",
        "title": "title",
        "description": "description",
        "creator": "creator",
        "site": "site",
      };
      const mappedKey = propertyMap[twitterKey] || twitterKey;
      metadata.twitter[mappedKey] = content;
    }
  }

  // Other meta tags
  if (!name.startsWith("og:") && !name.startsWith("twitter:") && name !== "description" && name !== "robots" && name !== "category") {
    if (!metadata.other) metadata.other = {};
    metadata.other[name] = content;
  }
}

/**
 * Processes a <link> tag
 */
function processLinkTag(
  attributes: Record<string, string>,
  metadata: ExtractedMetadata
): void {
  const rel = attributes.rel;
  const href = attributes.href;

  if (!rel || !href) return;

  switch (rel.toLowerCase()) {
    case "icon":
    case "shortcut icon":
      if (!metadata.icons) metadata.icons = [];
      if (typeof metadata.icons === "string") {
        metadata.icons = [{ url: metadata.icons }];
      }
      if (Array.isArray(metadata.icons)) {
        metadata.icons.push({
          url: href,
          type: attributes.type,
          sizes: attributes.sizes,
        });
      }
      break;

    case "apple-touch-icon":
      if (!metadata.icons) metadata.icons = {};
      if (typeof metadata.icons === "string" || Array.isArray(metadata.icons)) {
        const existing = typeof metadata.icons === "string" ? [{ url: metadata.icons }] : metadata.icons;
        metadata.icons = { icon: existing };
      }
      if (!metadata.icons.apple) metadata.icons.apple = [];
      if (Array.isArray(metadata.icons.apple)) {
        metadata.icons.apple.push({ url: href, sizes: attributes.sizes });
      }
      break;

    case "canonical":
      if (!metadata.alternates) metadata.alternates = {};
      metadata.alternates.canonical = href;
      break;

    case "alternate":
      if (attributes.hreflang) {
        if (!metadata.alternates) metadata.alternates = {};
        if (!metadata.alternates.languages) metadata.alternates.languages = {};
        metadata.alternates.languages[attributes.hreflang] = href;
      }
      break;

    case "manifest":
      metadata.manifest = href;
      break;

    default:
      // Other link tags
      if (!metadata.other) metadata.other = {};
      metadata.other[`link:${rel}`] = href;
  }
}

/**
 * Parses robots content string into metadata format
 */
function parseRobots(content: string): string | { index?: boolean; follow?: boolean; [key: string]: any } {
  const parts = content.split(",").map((p) => p.trim().toLowerCase());
  const result: { index?: boolean; follow?: boolean; [key: string]: any } = {};

  parts.forEach((part) => {
    if (part === "index" || part === "noindex") {
      result.index = part === "index";
    } else if (part === "follow" || part === "nofollow") {
      result.follow = part === "follow";
    } else {
      result[part] = true;
    }
  });

  // If it's just a simple string format, return as string
  if (Object.keys(result).length === 0) {
    return content;
  }

  return result;
}

/**
 * Converts extracted metadata to Next.js metadata export code
 */
export function generateMetadataExport(
  metadata: ExtractedMetadata,
  useTypeScript: boolean = true
): string {
  const lines: string[] = [];

  if (metadata.isDynamic) {
    // Generate generateMetadata function
    lines.push(`export async function generateMetadata(${useTypeScript ? "{ params, searchParams }" : ""}: ${useTypeScript ? "{ params: any, searchParams?: any }" : ""}): Promise<Metadata> {`);
    lines.push(`  // TODO: Convert dynamic Head content to generateMetadata`);
    lines.push(`  // This is a placeholder - you may need to adjust based on your dynamic content`);
    lines.push(`  return {`);
    lines.push(...generateMetadataObject(metadata, "    "));
    lines.push(`  };`);
    lines.push(`}`);
    if (useTypeScript) {
      lines.unshift(`import type { Metadata } from 'next'`);
    }
  } else {
    // Generate static metadata export
    lines.push(`export const metadata${useTypeScript ? ": Metadata" : ""} = {`);
    lines.push(...generateMetadataObject(metadata, "  "));
    lines.push(`};`);
    if (useTypeScript) {
      lines.unshift(`import type { Metadata } from 'next'`);
    }
  }

  return lines.join("\n");
}

/**
 * Generates the metadata object code
 */
function generateMetadataObject(
  metadata: ExtractedMetadata,
  indent: string
): string[] {
  const lines: string[] = [];
  const prefix = indent;

  if (metadata.metadataBase) {
    lines.push(`${prefix}metadataBase: new URL('${metadata.metadataBase}'),`);
  }

  if (metadata.title) {
    if (typeof metadata.title === "string") {
      lines.push(`${prefix}title: '${escapeString(metadata.title)}',`);
    } else {
      lines.push(`${prefix}title: {`);
      if (metadata.title.template) lines.push(`${prefix}  template: '${escapeString(metadata.title.template)}',`);
      if (metadata.title.default) lines.push(`${prefix}  default: '${escapeString(metadata.title.default)}',`);
      if (metadata.title.absolute) lines.push(`${prefix}  absolute: '${escapeString(metadata.title.absolute)}',`);
      lines.push(`${prefix}},`);
    }
  }

  if (metadata.description) {
    lines.push(`${prefix}description: '${escapeString(metadata.description)}',`);
  }

  if (metadata.openGraph) {
    lines.push(`${prefix}openGraph: {`);
    if (metadata.openGraph.title) lines.push(`${prefix}  title: '${escapeString(metadata.openGraph.title)}',`);
    if (metadata.openGraph.description) lines.push(`${prefix}  description: '${escapeString(metadata.openGraph.description)}',`);
    if (metadata.openGraph.url) lines.push(`${prefix}  url: '${escapeString(metadata.openGraph.url)}',`);
    if (metadata.openGraph.siteName) lines.push(`${prefix}  siteName: '${escapeString(metadata.openGraph.siteName)}',`);
    if (metadata.openGraph.locale) lines.push(`${prefix}  locale: '${escapeString(metadata.openGraph.locale)}',`);
    if (metadata.openGraph.type) lines.push(`${prefix}  type: '${escapeString(metadata.openGraph.type)}',`);
    if (metadata.openGraph.images && metadata.openGraph.images.length > 0) {
      lines.push(`${prefix}  images: [`);
      metadata.openGraph.images.forEach((img) => {
        lines.push(`${prefix}    {`);
        lines.push(`${prefix}      url: '${escapeString(img.url)}',`);
        if (img.width) lines.push(`${prefix}      width: ${img.width},`);
        if (img.height) lines.push(`${prefix}      height: ${img.height},`);
        if (img.alt) lines.push(`${prefix}      alt: '${escapeString(img.alt)}',`);
        lines.push(`${prefix}    },`);
      });
      lines.push(`${prefix}  ],`);
    }
    lines.push(`${prefix}},`);
  }

  if (metadata.twitter) {
    lines.push(`${prefix}twitter: {`);
    if (metadata.twitter.card) lines.push(`${prefix}  card: '${escapeString(metadata.twitter.card)}',`);
    if (metadata.twitter.title) lines.push(`${prefix}  title: '${escapeString(metadata.twitter.title)}',`);
    if (metadata.twitter.description) lines.push(`${prefix}  description: '${escapeString(metadata.twitter.description)}',`);
    if (metadata.twitter.creator) lines.push(`${prefix}  creator: '${escapeString(metadata.twitter.creator)}',`);
    if (metadata.twitter.site) lines.push(`${prefix}  site: '${escapeString(metadata.twitter.site)}',`);
    if (metadata.twitter.images && metadata.twitter.images.length > 0) {
      lines.push(`${prefix}  images: [`);
      metadata.twitter.images.forEach((img) => {
        lines.push(`${prefix}    '${escapeString(img)}',`);
      });
      lines.push(`${prefix}  ],`);
    }
    lines.push(`${prefix}},`);
  }

  if (metadata.robots) {
    if (typeof metadata.robots === "string") {
      lines.push(`${prefix}robots: '${escapeString(metadata.robots)}',`);
    } else {
      lines.push(`${prefix}robots: {`);
      if (metadata.robots.index !== undefined) lines.push(`${prefix}  index: ${metadata.robots.index},`);
      if (metadata.robots.follow !== undefined) lines.push(`${prefix}  follow: ${metadata.robots.follow},`);
      lines.push(`${prefix}},`);
    }
  }

  if (metadata.icons) {
    if (typeof metadata.icons === "string") {
      lines.push(`${prefix}icons: '${escapeString(metadata.icons)}',`);
    } else if (Array.isArray(metadata.icons)) {
      lines.push(`${prefix}icons: [`);
      metadata.icons.forEach((icon) => {
        lines.push(`${prefix}  {`);
        lines.push(`${prefix}    url: '${escapeString(icon.url)}',`);
        if (icon.type) lines.push(`${prefix}    type: '${escapeString(icon.type)}',`);
        if (icon.sizes) lines.push(`${prefix}    sizes: '${escapeString(icon.sizes)}',`);
        lines.push(`${prefix}  },`);
      });
      lines.push(`${prefix}],`);
    } else {
      lines.push(`${prefix}icons: {`);
      if (metadata.icons.icon) {
        if (typeof metadata.icons.icon === "string") {
          lines.push(`${prefix}  icon: '${escapeString(metadata.icons.icon)}',`);
        } else if (Array.isArray(metadata.icons.icon)) {
          lines.push(`${prefix}  icon: [`);
          metadata.icons.icon.forEach((icon) => {
            lines.push(`${prefix}    { url: '${escapeString(icon.url)}', type: '${escapeString(icon.type || "")}' },`);
          });
          lines.push(`${prefix}  ],`);
        }
      }
      if (metadata.icons.apple) {
        if (typeof metadata.icons.apple === "string") {
          lines.push(`${prefix}  apple: '${escapeString(metadata.icons.apple)}',`);
        } else if (Array.isArray(metadata.icons.apple)) {
          lines.push(`${prefix}  apple: [`);
          metadata.icons.apple.forEach((icon) => {
            lines.push(`${prefix}    { url: '${escapeString(icon.url)}', sizes: '${escapeString(icon.sizes || "")}' },`);
          });
          lines.push(`${prefix}  ],`);
        }
      }
      if (metadata.icons.shortcut) {
        lines.push(`${prefix}  shortcut: '${escapeString(metadata.icons.shortcut)}',`);
      }
      lines.push(`${prefix}},`);
    }
  }

  if (metadata.manifest) {
    lines.push(`${prefix}manifest: '${escapeString(metadata.manifest)}',`);
  }

  if (metadata.alternates) {
    lines.push(`${prefix}alternates: {`);
    if (metadata.alternates.canonical) {
      lines.push(`${prefix}  canonical: '${escapeString(metadata.alternates.canonical)}',`);
    }
    if (metadata.alternates.languages) {
      lines.push(`${prefix}  languages: {`);
      Object.entries(metadata.alternates.languages).forEach(([lang, url]) => {
        lines.push(`${prefix}    '${escapeString(lang)}': '${escapeString(url)}',`);
      });
      lines.push(`${prefix}  },`);
    }
    lines.push(`${prefix}},`);
  }

  if (metadata.appLinks) {
    lines.push(`${prefix}appLinks: {`);
    if (metadata.appLinks.ios) {
      lines.push(`${prefix}  ios: {`);
      if (metadata.appLinks.ios.appId) lines.push(`${prefix}    appId: '${escapeString(metadata.appLinks.ios.appId)}',`);
      if (metadata.appLinks.ios.appStoreId) lines.push(`${prefix}    appStoreId: '${escapeString(metadata.appLinks.ios.appStoreId)}',`);
      if (metadata.appLinks.ios.url) lines.push(`${prefix}    url: '${escapeString(metadata.appLinks.ios.url)}',`);
      lines.push(`${prefix}  },`);
    }
    if (metadata.appLinks.android) {
      lines.push(`${prefix}  android: {`);
      if (metadata.appLinks.android.package) lines.push(`${prefix}    package: '${escapeString(metadata.appLinks.android.package)}',`);
      if (metadata.appLinks.android.url) lines.push(`${prefix}    url: '${escapeString(metadata.appLinks.android.url)}',`);
      lines.push(`${prefix}  },`);
    }
    lines.push(`${prefix}},`);
  }

  if (metadata.category) {
    lines.push(`${prefix}category: '${escapeString(metadata.category)}',`);
  }

  if (metadata.other && Object.keys(metadata.other).length > 0) {
    lines.push(`${prefix}other: {`);
    Object.entries(metadata.other).forEach(([key, value]) => {
      lines.push(`${prefix}  '${escapeString(key)}': '${escapeString(value)}',`);
    });
    lines.push(`${prefix}},`);
  }

  return lines;
}

/**
 * Escapes strings for JavaScript/TypeScript code
 */
function escapeString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}
