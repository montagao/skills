#!/usr/bin/env node
/**
 * Dead Code Detector for TypeScript/JavaScript projects
 *
 * Detects:
 * 1. Unused exports - exported symbols never imported elsewhere
 * 2. Unused dependencies - packages in package.json never imported
 * 3. Unreachable code patterns (basic detection)
 *
 * Usage: node find-dead-code.js [project-root]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = process.argv[2] || process.cwd();

// File patterns to scan
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const IGNORE_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  ".turbo",
  ".cache",
  "out",
  ".output",
  "public",  // Usually static assets
  "storybook-static",
];

function shouldIgnoreDir(name) {
  // Exact matches
  if (IGNORE_DIRS.includes(name)) return true;
  // Pattern matches (hidden dirs, venv variants)
  if (name.startsWith(".venv")) return true;
  if (name.startsWith("venv")) return true;
  if (name.endsWith("-venv")) return true;
  return false;
}

function findFiles(dir, files = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDir(entry.name)) {
          findFiles(fullPath, files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.includes(ext) && !entry.name.endsWith(".d.ts")) {
          files.push(fullPath);
        }
      }
    }
  } catch (e) {
    // Skip directories we can't read
  }
  return files;
}

function extractExports(content, filePath) {
  const exports = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    // Named exports: export const/let/var/function/class/type/interface
    const namedExport = line.match(
      /^export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/
    );
    if (namedExport) {
      exports.push({ symbol: namedExport[1], line: index + 1 });
    }

    // Export { ... }
    const reExport = line.match(/^export\s*\{([^}]+)\}/);
    if (reExport) {
      const symbols = reExport[1].split(",").map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });
      symbols.forEach((symbol) => {
        if (symbol && !symbol.includes("*")) {
          exports.push({ symbol, line: index + 1 });
        }
      });
    }

    // export default - track as 'default'
    if (line.match(/^export\s+default\s/)) {
      exports.push({ symbol: "default", line: index + 1 });
    }
  });

  return exports;
}

function extractImports(content) {
  const imports = new Set();

  // import { a, b } from 'module'
  const namedImports = content.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  );
  for (const match of namedImports) {
    const symbols = match[1].split(",").map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[0].trim();
    });
    symbols.forEach((s) => imports.add(s));
  }

  // import Default from 'module'
  const defaultImports = content.matchAll(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g
  );
  for (const match of defaultImports) {
    imports.add(match[1]);
  }

  // import * as Name from 'module'
  const namespaceImports = content.matchAll(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g
  );
  for (const match of namespaceImports) {
    imports.add(match[1]);
  }

  return imports;
}

function extractPackageImports(content) {
  const packages = new Set();

  const importMatches = content.matchAll(
    /(?:import|from|require)\s*\(?['"]([^'"./][^'"]*)['"]\)?/g
  );
  for (const match of importMatches) {
    // Extract package name (handle scoped packages)
    const pkg = match[1];
    if (pkg.startsWith("@")) {
      const parts = pkg.split("/");
      packages.add(`${parts[0]}/${parts[1]}`);
    } else {
      packages.add(pkg.split("/")[0]);
    }
  }

  return packages;
}

function findUnreachablePatterns(content, filePath) {
  const patterns = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Always-false conditions: if (false)
    if (trimmed.match(/if\s*\(\s*false\s*\)/)) {
      patterns.push({
        file: filePath,
        line: lineNum,
        pattern: "always-false-condition",
        description: "if (false) - code block never executes",
      });
    }

    // Always-true conditions in while: while (true) without break
    if (trimmed.match(/while\s*\(\s*true\s*\)/)) {
      patterns.push({
        file: filePath,
        line: lineNum,
        pattern: "infinite-loop",
        description: "while (true) - potential infinite loop",
      });
    }

    // Commented out code blocks (heuristic)
    if (
      trimmed.match(/^\/\/\s*(const|let|var|function|class|if|for|while)\s/)
    ) {
      patterns.push({
        file: filePath,
        line: lineNum,
        pattern: "commented-code",
        description: "Commented out code - consider removing",
      });
    }

    // TODO/FIXME with old dates (heuristic for stale code)
    const todoMatch = trimmed.match(/\/\/\s*(TODO|FIXME|HACK).*20[0-2][0-4]/i);
    if (todoMatch) {
      patterns.push({
        file: filePath,
        line: lineNum,
        pattern: "stale-todo",
        description: `Stale ${todoMatch[1]} from 2020-2024`,
      });
    }
  });

  return patterns;
}

function isEntryPoint(filePath) {
  const entryPatterns = [
    /index\.[jt]sx?$/,
    /main\.[jt]sx?$/,
    /server\.[jt]sx?$/,
    /worker\.[jt]sx?$/,
    /app\//,
    /pages\//,
    /convex\//,
    /remotion\.config/,
    /next\.config/,
    /vite\.config/,
    /webpack\.config/,
    /tailwind\.config/,
    /postcss\.config/,
  ];

  return entryPatterns.some((pattern) => pattern.test(filePath));
}

function isTestFile(filePath) {
  return /\.(test|spec)\.[jt]sx?$/.test(filePath);
}

async function main() {
  console.log(`\n🔍 Scanning for dead code in: ${projectRoot}\n`);

  const files = findFiles(projectRoot);
  console.log(`Found ${files.length} source files to analyze\n`);

  // Collect all exports and imports
  const allExports = new Map();
  const allImportedSymbols = new Set();
  const allPackageImports = new Set();
  const unreachablePatterns = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relativePath = path.relative(projectRoot, file);

    // Skip test files and entry points for unused export detection
    if (!isEntryPoint(relativePath) && !isTestFile(relativePath)) {
      const exports = extractExports(content, relativePath);
      if (exports.length > 0) {
        allExports.set(relativePath, exports);
      }
    }

    // Collect imports
    const imports = extractImports(content);
    imports.forEach((i) => allImportedSymbols.add(i));

    // Collect package imports
    const pkgImports = extractPackageImports(content);
    pkgImports.forEach((p) => allPackageImports.add(p));

    // Find unreachable patterns (skip test files)
    if (!isTestFile(relativePath)) {
      const patterns = findUnreachablePatterns(content, relativePath);
      unreachablePatterns.push(...patterns);
    }
  }

  // Find unused exports
  const unusedExports = [];
  for (const [file, exports] of allExports) {
    for (const exp of exports) {
      // Check if symbol is imported anywhere
      if (!allImportedSymbols.has(exp.symbol)) {
        // Skip common patterns that are externally consumed
        if (
          exp.symbol === "default" ||
          exp.symbol.match(/^(Props|Config|Options|Schema|Type)$/)
        ) {
          continue;
        }
        unusedExports.push({
          file,
          symbol: exp.symbol,
          line: exp.line,
        });
      }
    }
  }

  // Find unused dependencies
  const unusedDependencies = [];
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const declaredDeps = new Set([
      ...Object.keys(pkgJson.dependencies || {}),
      ...Object.keys(pkgJson.devDependencies || {}),
    ]);

    // Skip common dev tools that might not be imported
    const skipPatterns = [
      "typescript",
      "prettier",
      "eslint",
      "@types/",
      "vitest",
      "jest",
      "@testing-library",
      "husky",
      "lint-staged",
      "tsx",
      "tsup",
      "turbo",
      "postcss",
      "tailwindcss",
      "autoprefixer",
    ];

    for (const dep of declaredDeps) {
      if (skipPatterns.some((skip) => dep.includes(skip))) continue;
      if (!allPackageImports.has(dep)) {
        unusedDependencies.push(dep);
      }
    }
  }

  // Generate report
  const report = {
    unusedExports,
    unusedDependencies,
    unreachablePatterns,
  };

  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("                     DEAD CODE REPORT");
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );

  if (unusedExports.length > 0) {
    console.log(`📦 UNUSED EXPORTS (${unusedExports.length}):`);
    console.log(
      "─────────────────────────────────────────────────────────────"
    );
    const grouped = unusedExports.reduce((acc, exp) => {
      if (!acc[exp.file]) acc[exp.file] = [];
      acc[exp.file].push(exp);
      return acc;
    }, {});

    for (const [file, exports] of Object.entries(grouped)) {
      console.log(`\n  ${file}:`);
      for (const exp of exports) {
        console.log(`    L${exp.line}: ${exp.symbol}`);
      }
    }
    console.log();
  }

  if (unusedDependencies.length > 0) {
    console.log(
      `📚 POTENTIALLY UNUSED DEPENDENCIES (${unusedDependencies.length}):`
    );
    console.log(
      "─────────────────────────────────────────────────────────────"
    );
    for (const dep of unusedDependencies) {
      console.log(`  - ${dep}`);
    }
    console.log();
  }

  if (unreachablePatterns.length > 0) {
    console.log(
      `⚠️  UNREACHABLE/SUSPICIOUS PATTERNS (${unreachablePatterns.length}):`
    );
    console.log(
      "─────────────────────────────────────────────────────────────"
    );
    for (const pattern of unreachablePatterns) {
      console.log(`  ${pattern.file}:${pattern.line}`);
      console.log(`    [${pattern.pattern}] ${pattern.description}`);
    }
    console.log();
  }

  // Summary
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("                        SUMMARY");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(`  Unused exports:      ${unusedExports.length}`);
  console.log(`  Unused dependencies: ${unusedDependencies.length}`);
  console.log(`  Suspicious patterns: ${unreachablePatterns.length}`);
  console.log(
    `  Total issues:        ${unusedExports.length + unusedDependencies.length + unreachablePatterns.length}`
  );
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );

  // Write JSON report
  const reportPath = path.join(projectRoot, "dead-code-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Full report written to: ${reportPath}\n`);

  // Exit with error code if issues found
  const totalIssues =
    unusedExports.length +
    unusedDependencies.length +
    unreachablePatterns.length;
  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(console.error);
