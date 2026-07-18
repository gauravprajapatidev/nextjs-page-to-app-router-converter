# Next.js Pages to App Router Converter

Automate your migration from Next.js Pages Router to App Router with intelligent component analysis and code transformation.

<a href='https://ko-fi.com/gauravprajapati' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi5.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

> ⭐ If this project saves you time, consider starring the repository and supporting its continued development.

---

## 🚀 Key Features

- **Smart Component Analysis**: Automatically determines if a component should be Server or Client based on hooks and browser API usage.
- **Data Fetching Migration**: Converts `getServerSideProps` and `getStaticProps` to async Server Components, including `generateStaticParams`.
- **Routing Updates**: Transforms `next/router` to `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`).
- **API Routes**: Migrates API handlers to Route Handlers, updating `res` methods to `NextResponse`.
- **Metadata**: Converts `<Head>` tags to the Metadata API.
- **Layouts & Providers**: Automatically generates root layouts, nested layouts, and extracts context providers from `_app.tsx`.
- **Font Optimization**: Migrates `next/font` configurations.

---

## 📦 Installation & Usage

### Quick Run

Run directly using `npx`:

```bash
npx next-page-to-app-converter <project-path>
```

### Global Installation

```bash
npm install -g next-page-to-app-converter
next-pages-to-app <project-path>
```

---

## ⚙️ Options

| Flag | Description |
|------|-------------|
| `-d, --dry-run` | Preview the migration without writing any files. |
| `-v, --validate` | **(Experimental)** Runs runtime validation using Next.js DevTools (Requires Next.js 16+). |
| `-h, --help` | Show all available commands and options. |

---

## 🛠️ How It Works

1. **Scans** your `pages` directory for:
   - Routes
   - API endpoints
   - Special files (`_app`, `_document`, `_error`)

2. **Analyzes** every component and its imports to detect:
   - React Hooks (`useState`, `useEffect`, etc.)
   - Event handlers (`onClick`, `onChange`, etc.)
   - Browser-only APIs (`window`, `document`, `localStorage`, etc.)

3. **Transforms** your code by:
   - Adding `"use client"` directives where required.
   - Rewriting data fetching to async Server Components.
   - Updating navigation and routing logic.
   - Converting metadata handling.
   - Migrating API routes.

4. **Generates** a complete `app` directory while preserving your application's behavior as closely as possible.

---

## ✅ Requirements

- **Node.js:** 18.0.0 or later
- **Target Project:** Next.js 13 or later
- **Validation:** Next.js 16+ required for the `--validate` option

---

## ❓ Troubleshooting

### Validation Issues

The `--validate` flag starts your development server for runtime validation.

Before using it, make sure the following command runs successfully:

```bash
npm run dev
```

### Complex Projects

While the converter handles most common migration patterns, projects using:

- Complex custom server logic
- Dynamic runtime imports
- Advanced webpack customization
- Unusual routing patterns

may require manual review after migration.

---

## ❤️ Support

If this tool saves you hours of migration work, consider supporting its development.

<a href='https://ko-fi.com/gauravprajapati' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi5.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

Your support helps fund:

- 🚀 New migration features
- 🐞 Bug fixes
- ⚡ Performance improvements
- 📚 Better documentation
- ❤️ Continued maintenance

Every contribution is greatly appreciated.

---

## 📄 License

ISC

---

## 🙏 Acknowledgments

- Built with [ts-morph](https://github.com/dsherret/ts-morph) for TypeScript AST manipulation.
- Inspired by the Next.js community's migration needs.
- Thanks to everyone who reports bugs, contributes code, and supports the project.
