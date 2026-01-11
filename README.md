# Next.js Pages to App Router Converter

An intelligent CLI tool to migrate Next.js applications from Pages Router to App Router with **comprehensive component analysis** to automatically determine if components should be client-side or server-side.

## Features

### 🔍 **Intelligent Component Analysis**
- **Automatic Detection**: Analyzes components for hooks, event handlers, browser APIs, and client-only libraries
- **Recursive Analysis**: Scans imported components to ensure correct client/server classification
- **Smart "use client" Insertion**: Adds directives only where needed with explanatory comments
- **Comprehensive Detection**:
  - React hooks (useState, useEffect, useContext, etc.)
  - Event handlers (onClick, onChange, etc.)
  - Browser APIs (window, localStorage, navigator, etc.)
  - Client-only libraries (react-query, zustand, framer-motion, etc.)

### 🚀 **Migration Capabilities**
- Converts `getServerSideProps` and `getStaticProps` to async Server Components
- Transforms `next/router` to `next/navigation`
- Converts `<Head>` to metadata exports
- Generates root `layout.tsx` with proper configuration
- Handles API routes migration
- Preserves TypeScript/JavaScript preferences

### ✅ **Runtime Validation** (Optional)
- Validates conversions by starting the Next.js dev server
- Detects runtime errors automatically
- Suggests fixes for common issues
- Requires Next.js 16+ for full MCP integration

## Installation

### Global Installation
```bash
npm install -g next-page-to-app-converter
```

### Local Development
```bash
git clone <repository-url>
cd next-page-to-app-converter
npm install
npm run build
npm link
```

## Usage

### Basic Migration
```bash
next-pages-to-app /path/to/your/nextjs/project
```

### Dry Run (Preview Changes)
```bash
next-pages-to-app /path/to/your/nextjs/project --dry-run
```

### With Runtime Validation
```bash
next-pages-to-app /path/to/your/nextjs/project --validate
```

### All Options
```bash
next-pages-to-app [projectPath] [options]

Options:
  -d, --dry-run    Run migration in dry-run mode (no files written)
  -v, --validate   Validate conversion with Next.js DevTools (requires Next.js 16+)
  -h, --help       Display help information
```

## How It Works

### 1. **Project Scanning**
The tool scans your `pages` directory and identifies:
- Regular pages
- API routes
- Error pages (_error.tsx)
- Special files (_app.tsx, _document.tsx)

### 2. **Component Analysis**
For each component, the analyzer:
- Detects React hooks usage
- Identifies event handlers in JSX
- Scans for browser-only APIs
- Checks for client-only library imports
- Recursively analyzes imported components

### 3. **Intelligent Transformation**
Based on analysis results:
- **Server Components** (default): No "use client" directive needed
- **Client Components**: Adds "use client" with explanatory comment
- **Data Fetching**: Converts GSSP/GSP to async Server Component patterns
- **Routing**: Updates router imports and usage

### 4. **Validation** (Optional with --validate)
- Starts Next.js dev server
- Monitors for runtime errors
- Suggests and applies fixes automatically
- Stops server after validation

## Component Classification Examples

### ✅ Server Component (No "use client" needed)
```tsx
// app/page.tsx
export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  return <div>{data.title}</div>;
}
```

### 🔵 Client Component (Automatic "use client" added)
```tsx
// Client Component: Uses React hooks
"use client";

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

### 🔵 Client Component (Browser API detected)
```tsx
// Client Component: Uses browser APIs
"use client";

export default function LocalStorage() {
  const save = () => localStorage.setItem('key', 'value');
  return <button onClick={save}>Save</button>;
}
```

## Detection Rules

The tool classifies components as **Client Components** when they:

1. **Use React Hooks**
   - `useState`, `useEffect`, `useContext`, `useReducer`, etc.
   - Custom hooks (functions starting with "use")

2. **Use Event Handlers**
   - `onClick`, `onChange`, `onSubmit`, etc.

3. **Use Browser APIs**
   - `window`, `document`, `localStorage`, `navigator`, etc.

4. **Import Client-Only Libraries**
   - `react-query`, `zustand`, `framer-motion`, etc.
   - See full list in `componentTypes.ts`

## Requirements

- Node.js 18+
- Next.js 13+ (target project)
- Next.js 16+ (for runtime validation with --validate flag)

## Project Structure

```
src/
├── cli.ts                      # CLI entry point
├── index.ts                    # Main migration orchestrator
├── migrate/
│   ├── analyzeComponent.ts     # Component analysis engine
│   ├── componentTypes.ts       # Type definitions and constants
│   ├── transformPage.ts        # Page transformation logic
│   ├── validateWithDevTools.ts # Runtime validation (Next.js 16+)
│   └── ...                     # Other migration utilities
└── utils/
    └── logger.ts               # Logging and reporting
```

## Advanced Features

### Recursive Component Analysis

The tool doesn't just analyze the page component—it recursively scans all imported local components:

```tsx
// pages/index.tsx imports Button.tsx
import Button from '../components/Button';

// The analyzer will:
// 1. Analyze pages/index.tsx
// 2. Detect import of Button
// 3. Analyze components/Button.tsx
// 4. Classify both components correctly
```

### Smart Comment Generation

When adding "use client", the tool explains why:

```tsx
// Client Component: Uses React hooks, Uses event handlers
"use client";

import { useState } from 'react';
```

## Limitations

- **Dynamic Imports**: May not detect all dynamically imported components
- **Conditional Logic**: Complex conditional rendering may require manual review
- **Third-Party Libraries**: Detection limited to known client-only libraries
- **Runtime Validation**: Requires Next.js 16+ and runnable project

## Troubleshooting

### "Component analysis failed"
- Fallback to basic detection is used automatically
- Check if TypeScript files can be parsed
- Ensure project dependencies are installed

### "Validation failed"
- Ensure Next.js 16+ is installed
- Check if `npm run dev` works manually
- Verify no port conflicts (default: 3000)

### Components still have errors after migration
- Review auto-generated "use client" directives
- Check for server-only code in client components
- Verify imported components are correctly classified

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## License

ISC

## Acknowledgments

- Built with [ts-morph](https://github.com/dsherret/ts-morph) for TypeScript AST manipulation
- Uses [Next.js DevTools MCP](https://nextjs.org/docs) for runtime validation
- Inspired by the Next.js community's migration needs
