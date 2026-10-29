/** @jest-environment node */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const src = path.resolve(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'test-fixtures') return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

function importsOf(code: string): string[] {
  const file = ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      imports.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

function localTarget(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return path.resolve(src, specifier.slice(2));
  if (specifier.startsWith('.')) return path.resolve(path.dirname(file), specifier);
  return null;
}

function within(file: string, dir: string): boolean {
  return file === dir || file.startsWith(`${dir}${path.sep}`);
}

it('checks aliases, relative imports, re-exports and dynamic/require/type imports', () => {
  const imports = importsOf(`
    import { light } from '@/ui/lighting';
    export { colors } from '../ui/theme';
    const a = require('@/ui/book/BookBody');
    const b = import('../ui/SceneLight');
    type Props = import('@/ui/lighting').SurfaceMaterial;
    // import ignored from '@/ui/comment';
  `);
  expect(imports).toEqual(['@/ui/lighting', '../ui/theme', '@/ui/book/BookBody', '../ui/SceneLight', '@/ui/lighting']);
  expect(localTarget(path.join(src, 'domain/example.ts'), '../ui/theme')).toBe(path.join(src, 'ui/theme'));
});

it('domain and shared scene inputs do not depend on presentation layers', () => {
  const forbidden = ['ui', 'features', 'app'].map((dir) => path.join(src, dir));
  const violations: string[] = [];
  for (const file of [...sources(path.join(src, 'domain')), ...sources(path.join(src, 'scene-config'))]) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = localTarget(file, specifier);
      if (target && forbidden.some((dir) => within(target, dir))) violations.push(`${path.relative(src, file)} -> ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});

it('shared scene inputs have no dependencies outside scene-config', () => {
  const dir = path.join(src, 'scene-config');
  const violations: string[] = [];
  for (const file of sources(dir)) {
    for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
      const target = localTarget(file, specifier);
      if (!target || !within(target, dir)) violations.push(`${path.relative(src, file)} -> ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});

it('saved-layout schema depends only on shared types and layout rules', () => {
  const file = path.join(src, 'domain/layout-schema.ts');
  const allowed = ['types', 'layout-rules'].map((name) => path.join(src, 'domain', name));
  const violations = importsOf(readFileSync(file, 'utf8')).filter((specifier) => !allowed.includes(localTarget(file, specifier) ?? ''));
  expect(violations).toEqual([]);
});
