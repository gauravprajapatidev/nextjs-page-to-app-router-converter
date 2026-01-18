# Next.js Pages to App Router Converter

Automate your migration from Next.js Pages Router to App Router with intelligent component analysis and code transformation.

## 🚀 Key Features

*   **Smart Component Analysis**: Automatically determines if a component should be Server or Client based on hooks and browser API usage.
*   **Data Fetching Migration**: Converts `getServerSideProps` and `getStaticProps` to async Server Components, including `generateStaticParams`.
*   **Routing Updates**: Transforms `next/router` to `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`).
*   **API Routes**: Migrates API handlers to Route Handlers, updating `res` methods to `NextResponse`.
*   **Metadata**: Converts `<Head>` tags to the Metadata API.
*   **Layouts & Providers**: Automatically generates root layouts, nested layouts, and extracts context providers from `_app.tsx`.
*   **Font Optimization**: Migrates `next/font` configurations.

## 📦 Installation & Usage

### Quick Run
You can likely run the tool directly (if published):
```bash
npx next-page-to-app-converter <project-path>
```

### Global Installation
```bash
npm install -g next-page-to-app-converter
next-pages-to-app <project-path>
```

## ⚙️ Options

| Flag | Description |
| :--- | :--- |
| `-d, --dry-run` | Preview the migration without writing any files. |
| `-v, --validate` | **(Experimental)** Runs runtime validation using Next.js DevTools (Requires Next.js 16+). |
| `-h, --help` | Show all available commands and options. |

## 🛠️ How It Works

1.  **Scans** your `pages` directory for routes, API endpoints, and special files (`_app`, `_document`, `_error`).
2.  **Analyzes** every component (and its imports) to detect:
    *   React Hooks (`useState`, `useEffect`, etc.)
    *   Event Handlers (`onClick`, `onChange`)
    *   Browser-only APIs (`window`, `localstorage`)
3.  **Transforms** the code:
    *   Adds `"use client"` directives where needed.
    *   Rewrites data fetching to `async` Server Components.
    *   Updates navigation and routing logic.
4.  **Generates** the new folder structure in the `app` directory, preserving your logic.

## ✅ Requirements

*   **Node.js**: 18.0.0 or later
*   **Target Project**: Next.js 13 or later (Next.js 16+ required for `--validate`)

## ❓ Troubleshooting

*   **Validation Issues**: The `--validate` flag relies on starting your dev server. Ensure `npm run dev` works on your project manually before running the tool.
*   **Complex Logic**: While the tool handles most patterns, highly dynamic imports or complex custom server logic might require manual review after migration.

## License

ISC

## Acknowledgments

- Built with [ts-morph](https://github.com/dsherret/ts-morph) for TypeScript AST manipulation
- Inspired by the Next.js community's migration needs
