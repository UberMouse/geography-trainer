/**
 * Finds every test declared in a spec file (Vitest `it`/`test`, Playwright `test`) with the
 * titles of the `describe` blocks around it, using the TypeScript parser rather than a regex.
 */
import ts from 'typescript';
import { ID_SOURCE } from './spec';

export interface TestCase {
  file: string;
  line: number;
  /** The describe titles, outermost first, then the test's own title (source text when not a literal). */
  titles: string[];
  /** Every ID cited in square brackets anywhere in `titles`. */
  ids: string[];
}

const ROOTS = new Set(['it', 'test', 'describe']);
/** Members that never declare a test or a block, even with a callback. */
const NOT_DECLARATIONS = new Set([
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'step',
  'use',
  'extend',
  'configure',
  'setTimeout',
  'info',
  'slow',
  'fail',
]);

const CITATION = new RegExp(`\\[(${ID_SOURCE}(?:\\s*,\\s*${ID_SOURCE})*)\\]`, 'g');
const ID = new RegExp(ID_SOURCE, 'g');

/** IDs cited as `[SES-03]` or `[SES-03, SES-C01]` in a title. */
export function citedIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CITATION)) ids.push(...(m[1]!.match(ID) ?? []));
  return ids;
}

/** `it`, `test.describe`, `it.each(rows)`, `describe.skip`: the root name and member names. */
function calleeChain(expr: ts.Expression): { root: string; members: string[] } | null {
  const members: string[] = [];
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isCallExpression(e)) e = e.expression; // it.each(rows)(title, fn)
    else if (ts.isTaggedTemplateExpression(e)) e = e.tag; // it.each`table`(title, fn)
    else if (ts.isPropertyAccessExpression(e)) {
      members.unshift(e.name.text);
      e = e.expression;
    } else if (ts.isIdentifier(e)) return { root: e.text, members };
    else return null;
  }
}

function isFunction(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/**
 * A callback passed by name (`it(title, runCase)`, `it(title, cases.slow)`). Counting these
 * means a test can't slip past the checker by not being an inline function; a Playwright
 * in-body skip (`test.skip(isMobile, 'reason')`) still doesn't count, as its second argument
 * is a string.
 */
function isCallbackReference(node: ts.Node): boolean {
  return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node);
}

function titleText(node: ts.Expression, source: ts.SourceFile): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText(source);
}

export function findTests(file: string, text: string): TestCase[] {
  // A .ts file parsed as TSX reads `<T>(x: T) => …` as JSX and can lose the tests after it.
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const cases: TestCase[] = [];

  const visit = (node: ts.Node, describes: string[]): void => {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      // The callback can sit before a timeout (`it(title, fn, 30_000)`) or after options
      // (`it(title, { timeout }, fn)`), so take the first function after the title, else a
      // callback passed by name.
      const rest = node.arguments.slice(1);
      const fn = rest.find(isFunction) ?? rest.find(isCallbackReference);
      const first = node.arguments[0];
      if (chain && ROOTS.has(chain.root) && !chain.members.some((m) => NOT_DECLARATIONS.has(m)) && first && fn) {
        const title = titleText(first, source);
        const isDescribe = chain.root === 'describe' || chain.members.includes('describe');
        if (isDescribe) {
          if (isFunction(fn)) ts.forEachChild(fn, (child) => visit(child, [...describes, title]));
          return;
        }
        const titles = [...describes, title];
        cases.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          titles,
          ids: titles.flatMap(citedIds),
        });
        return; // nothing inside a test body is another test
      }
    }
    ts.forEachChild(node, (child) => visit(child, describes));
  };
  visit(source, []);
  return cases;
}
