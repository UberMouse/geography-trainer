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

function titleText(node: ts.Expression, source: ts.SourceFile): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText(source);
}

export function findTests(file: string, text: string): TestCase[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cases: TestCase[] = [];

  const visit = (node: ts.Node, describes: string[]): void => {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      const fn = node.arguments.at(-1);
      const first = node.arguments[0];
      if (
        chain &&
        ROOTS.has(chain.root) &&
        !chain.members.some((m) => NOT_DECLARATIONS.has(m)) &&
        first &&
        node.arguments.length >= 2 &&
        isFunction(fn)
      ) {
        const title = titleText(first, source);
        const isDescribe = chain.root === 'describe' || chain.members.includes('describe');
        if (isDescribe) {
          ts.forEachChild(fn!, (child) => visit(child, [...describes, title]));
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
