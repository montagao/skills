# Dead Code Patterns Reference

## Unused Export Patterns

### Likely False Positives
Skip these patterns as they're often consumed externally:

- `Props`, `Config`, `Options` suffixed types (consumed by parent components)
- `default` exports (may be dynamically imported)
- Barrel file re-exports (`index.ts` that re-exports from submodules)
- Schema exports (Zod, Yup - used at runtime for validation)
- Types/interfaces (may be used in declaration files)
- Constants in config files (may be loaded at runtime)

### Likely True Positives
Flag these patterns as dead code:

- Helper functions not imported anywhere
- Utility functions with unique names not used elsewhere
- Exported constants that are project-specific
- Old API response types from deprecated endpoints
- Commented-out exports

## Unused Dependency Patterns

### Safe to Skip (Dev/Build Tools)
```
typescript, @types/*, eslint*, prettier, vitest, jest,
@testing-library/*, husky, lint-staged, turbo, tsx,
tsup, esbuild, webpack*, vite*, rollup*, postcss*,
tailwindcss, autoprefixer
```

### Likely Used at Runtime (Hard to Detect)
```
- PostCSS/Tailwind plugins (referenced in config)
- Babel plugins (referenced in config)
- Next.js plugins (referenced in next.config)
- Webpack loaders (referenced in config)
```

### Likely Unused (Check These)
```
- Old HTTP clients (axios when switched to fetch)
- Old state managers (redux when switched to zustand)
- Old date libraries (moment when switched to date-fns)
- Old component libraries (material-ui when switched to shadcn)
```

## Unreachable Code Patterns

### Definite Dead Code
```typescript
// Code after return
function foo() {
  return 1;
  console.log("never runs"); // DEAD
}

// Always-false condition
if (false) {
  doSomething(); // DEAD
}

// Impossible type narrowing
if (typeof x === "string" && typeof x === "number") {
  // DEAD - impossible condition
}
```

### Suspicious Patterns (Manual Review)
```typescript
// while(true) without break - infinite loop risk
while (true) {
  process();
}

// Stale TODOs from years ago
// TODO (2021): Refactor this

// Large commented code blocks
// function oldImplementation() {
//   ...100 lines...
// }
```

## Framework-Specific Considerations

### Next.js
- `app/` routes are entry points (don't flag unused exports)
- `page.tsx`, `layout.tsx`, `loading.tsx` are convention files
- `generateStaticParams`, `generateMetadata` are used by framework

### Remotion
- Compositions exported from `Root.tsx` are registered, not imported
- `registerRoot()` in index.ts is the entry point
- `calculateMetadata()` functions are called by framework

### Convex
- Functions in `convex/` are deployed and called via API
- `internal.*` functions are called server-to-server
- Schema exports are used by Convex compiler

### Express/API
- Route handlers are registered, not directly imported
- Middleware is registered, not directly imported

## Manual Investigation Commands

### Find all usages of a symbol
```bash
rg "symbolName" --type ts --type tsx
```

### Find imports of a file
```bash
rg "from ['\"].*filename" --type ts
```

### Find dynamic imports
```bash
rg "import\(['\"]" --type ts
```

### Find requires
```bash
rg "require\(['\"]" --type ts --type js
```

### List exports from a file
```bash
rg "^export" path/to/file.ts
```
