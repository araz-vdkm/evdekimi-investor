/**
 * Accounting formula engine — an Excel-like formula language evaluated safely
 * inside the app.
 *
 * Pure functions only (no React, no network, no `eval`) so it can be
 * unit-tested with synthetic grids. Formulas are parsed into an AST by a
 * hand-written tokenizer + precedence-climbing parser and then walked; there
 * is no dynamic code execution anywhere, so a formula typed by a user can
 * never reach the runtime.
 *
 * Reference styles, all relative to the grid the formula is evaluated over:
 *   G          — column G of the CURRENT row (what a column formula normally
 *                wants: "= G - H" is "this row's G minus this row's H")
 *   G7         — the exact cell G7 (1-based row, as shown in the grid)
 *   G6:G20     — a range, usable inside SUM/MIN/MAX/AVERAGE/COUNT
 *
 * Values coming out of the grid are display strings ("24,000,000", "75%"),
 * so coercion strips grouping separators and understands percents — the same
 * way the Excel export does.
 */

// ---------------------------------------------------------------------------
// Values & errors
// ---------------------------------------------------------------------------

export type FormulaValue = number | string | boolean;

export interface FormulaError {
  __error: true;
  code: string;
  message: string;
}

export type EvalResult = FormulaValue | FormulaError;

export function isFormulaError(v: unknown): v is FormulaError {
  return typeof v === 'object' && v !== null && (v as any).__error === true;
}

function err(code: string, message: string): FormulaError {
  return { __error: true, code, message };
}

/** Thrown only by the tokenizer/parser; evaluation returns errors as values
 *  (like a spreadsheet) rather than throwing. */
export class FormulaSyntaxError extends Error {}

// ---------------------------------------------------------------------------
// Column letters
// ---------------------------------------------------------------------------

export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function columnLetterToIndex(letter: string): number {
  const up = String(letter || '').toUpperCase();
  if (!/^[A-Z]+$/.test(up)) return -1;
  let n = 0;
  for (let i = 0; i < up.length; i++) n = n * 26 + (up.charCodeAt(i) - 64);
  return n - 1;
}

// ---------------------------------------------------------------------------
// Coercion — grid cells are display strings
// ---------------------------------------------------------------------------

/** Parses a displayed cell into a number when it plausibly is one.
 *  "24,000,000" -> 24000000, "75%" -> 0.75, "(1,200)" -> -1200 (accounting
 *  negatives), "1 234,50" -> 1234.5. Returns null when it isn't numeric. */
export function parseDisplayNumber(raw: string): number | null {
  let text = String(raw ?? '').trim();
  if (text === '') return null;

  // Currency symbols / non-breaking spaces / plain spaces used as grouping.
  text = text.replace(/[ \s]/g, '').replace(/^(Rp|IDR|USD|EUR|\$|€)/i, '');

  let negative = false;
  const paren = text.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    text = paren[1];
  }

  let percent = false;
  if (text.endsWith('%')) {
    percent = true;
    text = text.slice(0, -1);
  }

  // Decide the decimal separator: if both "," and "." appear, the LAST one is
  // the decimal point and the other is grouping.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // A single comma: decimal separator only when it isn't 3-digit grouping.
    const after = text.length - lastComma - 1;
    text = after === 3 && /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  }

  if (!/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(text)) return null;
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  const signed = negative ? -n : n;
  return percent ? signed / 100 : signed;
}

function toNumber(v: EvalResult): number | FormulaError {
  if (isFormulaError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v.trim() === '') return 0; // blank behaves as 0, as in a spreadsheet
    const n = parseDisplayNumber(v);
    if (n === null) return err('VALUE', `"${v}" is not a number`);
    return n;
  }
  return err('VALUE', 'Not a number');
}

function toBoolean(v: EvalResult): boolean | FormulaError {
  if (isFormulaError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toUpperCase();
    if (t === 'TRUE') return true;
    if (t === 'FALSE' || t === '') return false;
    const n = parseDisplayNumber(v);
    if (n !== null) return n !== 0;
  }
  return err('VALUE', 'Not a boolean');
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; col: number; row: number | null }
  | { t: 'range'; c1: number; r1: number | null; c2: number; r2: number | null }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

const OPERATORS = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '<', '>', '='];

export function tokenize(input: string): Token[] {
  const src = String(input ?? '').replace(/^\s*=/, ''); // a leading "=" is optional
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== quote) {
        out += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaSyntaxError('Unclosed text quote');
      tokens.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) throw new FormulaSyntaxError(`Bad number "${raw}"`);
      tokens.push({ t: 'num', v: n });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);

      // A reference looks like LETTERS or LETTERS+DIGITS, and is only a
      // reference when it isn't immediately followed by "(" (a function call).
      const refMatch = word.match(/^([A-Za-z]+)(\d+)?$/);
      const nextNonSpace = src.slice(j).match(/^\s*(.)/);
      const isCall = nextNonSpace?.[1] === '(';

      if (refMatch && !isCall) {
        const col = columnLetterToIndex(refMatch[1]);
        const row = refMatch[2] ? parseInt(refMatch[2], 10) : null;
        const upper = word.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({ t: 'ident', v: upper });
          i = j;
          continue;
        }
        if (col < 0) throw new FormulaSyntaxError(`Unknown reference "${word}"`);

        // Range?
        const rest = src.slice(j);
        const rangeMatch = rest.match(/^\s*:\s*([A-Za-z]+)(\d+)?/);
        if (rangeMatch) {
          const col2 = columnLetterToIndex(rangeMatch[1]);
          if (col2 < 0) throw new FormulaSyntaxError(`Unknown reference "${rangeMatch[1]}"`);
          tokens.push({
            t: 'range',
            c1: col,
            r1: row,
            c2: col2,
            r2: rangeMatch[2] ? parseInt(rangeMatch[2], 10) : null,
          });
          i = j + rangeMatch[0].length;
          continue;
        }

        tokens.push({ t: 'ref', col, row });
        i = j;
        continue;
      }

      tokens.push({ t: 'ident', v: word.toUpperCase() });
      i = j;
      continue;
    }

    if (ch === '(') {
      tokens.push({ t: 'lp' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rp' });
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      tokens.push({ t: 'comma' });
      i++;
      continue;
    }
    if (ch === '%') {
      tokens.push({ t: 'op', v: '%' });
      i++;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }

    throw new FormulaSyntaxError(`Unexpected character "${ch}"`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (precedence climbing) -> AST
// ---------------------------------------------------------------------------

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; col: number; row: number | null }
  | { k: 'range'; c1: number; r1: number | null; c2: number; r2: number | null }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'postfix'; op: string; arg: Node }
  | { k: 'bin'; op: string; left: Node; right: Node };

const BINARY_PRECEDENCE: Record<string, number> = {
  '=': 1, '==': 1, '<>': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1,
  '+': 2, '-': 2,
  '*': 3, '/': 3,
  '^': 4,
};

export function parseFormula(input: string): Node {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new FormulaSyntaxError('Formula is empty');
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression(minPrec = 0): Node {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op') break;
      const prec = BINARY_PRECEDENCE[tok.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      // "^" is right-associative, everything else left-associative.
      const right = parseExpression(tok.v === '^' ? prec : prec + 1);
      left = { k: 'bin', op: tok.v, left, right };
    }
    return left;
  }

  function parseUnary(): Node {
    const tok = peek();
    if (tok && tok.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      next();
      return { k: 'unary', op: tok.v, arg: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix(): Node {
    let node = parsePrimary();
    for (;;) {
      const tok = peek();
      if (tok && tok.t === 'op' && tok.v === '%') {
        next();
        node = { k: 'postfix', op: '%', arg: node };
        continue;
      }
      break;
    }
    return node;
  }

  function parsePrimary(): Node {
    const tok = next();
    if (!tok) throw new FormulaSyntaxError('Formula ends unexpectedly');

    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'str') return { k: 'str', v: tok.v };
    if (tok.t === 'ref') return { k: 'ref', col: tok.col, row: tok.row };
    if (tok.t === 'range') return { k: 'range', c1: tok.c1, r1: tok.r1, c2: tok.c2, r2: tok.r2 };

    if (tok.t === 'lp') {
      const inner = parseExpression(0);
      const close = next();
      if (!close || close.t !== 'rp') throw new FormulaSyntaxError('Missing closing bracket');
      return inner;
    }

    if (tok.t === 'ident') {
      if (tok.v === 'TRUE') return { k: 'bool', v: true };
      if (tok.v === 'FALSE') return { k: 'bool', v: false };
      const open = peek();
      if (!open || open.t !== 'lp') throw new FormulaSyntaxError(`"${tok.v}" is not a known value — did you mean a function like ${tok.v}(...)?`);
      next(); // consume "("
      const args: Node[] = [];
      if (peek() && peek().t !== 'rp') {
        for (;;) {
          args.push(parseExpression(0));
          const sep = peek();
          if (sep && sep.t === 'comma') {
            next();
            continue;
          }
          break;
        }
      }
      const close = next();
      if (!close || close.t !== 'rp') throw new FormulaSyntaxError(`Missing closing bracket for ${tok.v}(`);
      return { k: 'call', name: tok.v, args };
    }

    throw new FormulaSyntaxError('Could not read the formula');
  }

  const ast = parseExpression(0);
  if (pos < tokens.length) throw new FormulaSyntaxError('Unexpected extra text at the end of the formula');
  return ast;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** How a formula reaches the sheet it lives in. `resolveCell` is what makes
 *  a formula column able to reference ANOTHER formula column: the caller
 *  decides whether a cell comes from the grid or from a computed column. */
export interface EvalContext {
  /** 0-based row currently being computed (a bare `G` reads this row). */
  rowIndex: number;
  rowCount: number;
  colCount: number;
  /** 0-based row/col -> displayed value (already accounting for edits and
   *  other computed columns). May return a FormulaError to propagate one. */
  resolveCell: (row: number, col: number) => EvalResult;
}

export const FORMULA_FUNCTIONS = [
  'IF', 'IFERROR', 'AND', 'OR', 'NOT',
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT',
  'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'INT', 'SQRT', 'POWER', 'MOD',
  'ISBLANK', 'ISNUMBER',
] as const;

function flatten(nodeValues: EvalResult[][]): EvalResult[] {
  const out: EvalResult[] = [];
  nodeValues.forEach((vals) => vals.forEach((v) => out.push(v)));
  return out;
}

function numbersOf(values: EvalResult[]): number[] | FormulaError {
  const nums: number[] = [];
  for (const v of values) {
    if (isFormulaError(v)) return v;
    if (typeof v === 'string' && v.trim() === '') continue; // skip blanks
    const n = toNumber(v);
    if (isFormulaError(n)) return n;
    nums.push(n);
  }
  return nums;
}

export function evaluateAst(node: Node, ctx: EvalContext): EvalResult {
  /** Values of a node, expanded when the node is a range. */
  function valuesOf(n: Node): EvalResult[] {
    if (n.k === 'range') {
      const r1 = n.r1 === null ? 1 : n.r1;
      const r2 = n.r2 === null ? ctx.rowCount : n.r2;
      const rowStart = Math.max(1, Math.min(r1, r2));
      const rowEnd = Math.min(ctx.rowCount, Math.max(r1, r2));
      const colStart = Math.min(n.c1, n.c2);
      const colEnd = Math.max(n.c1, n.c2);
      const out: EvalResult[] = [];
      for (let r = rowStart; r <= rowEnd; r++) {
        for (let c = colStart; c <= colEnd; c++) {
          if (c < 0 || c >= ctx.colCount) continue;
          out.push(ctx.resolveCell(r - 1, c));
        }
      }
      return out;
    }
    return [evaluateAst(n, ctx)];
  }

  switch (node.k) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'bool':
      return node.v;

    case 'ref': {
      const row = node.row === null ? ctx.rowIndex : node.row - 1;
      if (node.col < 0 || node.col >= ctx.colCount) return err('REF', `Column ${columnIndexToLetter(node.col)} is outside this tab`);
      if (row < 0 || row >= ctx.rowCount) return err('REF', `Row ${node.row} is outside this tab`);
      return ctx.resolveCell(row, node.col);
    }

    case 'range':
      return err('VALUE', 'A range can only be used inside a function like SUM(...)');

    case 'unary': {
      const v = toNumber(evaluateAst(node.arg, ctx));
      if (isFormulaError(v)) return v;
      return node.op === '-' ? -v : v;
    }

    case 'postfix': {
      const v = toNumber(evaluateAst(node.arg, ctx));
      if (isFormulaError(v)) return v;
      return v / 100;
    }

    case 'bin': {
      const op = node.op;
      const l = evaluateAst(node.left, ctx);
      if (isFormulaError(l)) return l;
      const r = evaluateAst(node.right, ctx);
      if (isFormulaError(r)) return r;

      if (['=', '==', '<>', '!='].includes(op)) {
        const ln = typeof l === 'string' ? parseDisplayNumber(l) : null;
        const rn = typeof r === 'string' ? parseDisplayNumber(r) : null;
        const lc = ln !== null ? ln : l;
        const rc = rn !== null ? rn : r;
        const equal =
          typeof lc === 'string' && typeof rc === 'string'
            ? lc.trim().toLowerCase() === rc.trim().toLowerCase()
            : lc === rc;
        return op === '=' || op === '==' ? equal : !equal;
      }

      const ln = toNumber(l);
      if (isFormulaError(ln)) return ln;
      const rn = toNumber(r);
      if (isFormulaError(rn)) return rn;

      switch (op) {
        case '+': return ln + rn;
        case '-': return ln - rn;
        case '*': return ln * rn;
        case '/':
          if (rn === 0) return err('DIV0', 'Division by zero');
          return ln / rn;
        case '^': return Math.pow(ln, rn);
        case '<': return ln < rn;
        case '<=': return ln <= rn;
        case '>': return ln > rn;
        case '>=': return ln >= rn;
        default: return err('NAME', `Unknown operator "${op}"`);
      }
    }

    case 'call': {
      const name = node.name;

      // IF and IFERROR must not evaluate every branch eagerly.
      if (name === 'IF') {
        if (node.args.length < 2) return err('NA', 'IF needs at least a condition and a value');
        const cond = toBoolean(evaluateAst(node.args[0], ctx));
        if (isFormulaError(cond)) return cond;
        if (cond) return evaluateAst(node.args[1], ctx);
        return node.args.length > 2 ? evaluateAst(node.args[2], ctx) : false;
      }
      if (name === 'IFERROR') {
        if (node.args.length !== 2) return err('NA', 'IFERROR needs a value and a fallback');
        const v = evaluateAst(node.args[0], ctx);
        return isFormulaError(v) ? evaluateAst(node.args[1], ctx) : v;
      }
      if (name === 'ISBLANK') {
        if (node.args.length !== 1) return err('NA', 'ISBLANK needs one value');
        const v = evaluateAst(node.args[0], ctx);
        if (isFormulaError(v)) return v;
        return typeof v === 'string' ? v.trim() === '' : false;
      }
      if (name === 'ISNUMBER') {
        if (node.args.length !== 1) return err('NA', 'ISNUMBER needs one value');
        const v = evaluateAst(node.args[0], ctx);
        if (isFormulaError(v)) return false;
        if (typeof v === 'number') return true;
        return typeof v === 'string' && parseDisplayNumber(v) !== null;
      }

      const argValues = node.args.map(valuesOf);
      const flat = flatten(argValues);
      for (const v of flat) if (isFormulaError(v)) return v;

      switch (name) {
        case 'AND':
        case 'OR': {
          const bools: boolean[] = [];
          for (const v of flat) {
            if (typeof v === 'string' && v.trim() === '') continue;
            const b = toBoolean(v);
            if (isFormulaError(b)) return b;
            bools.push(b);
          }
          if (bools.length === 0) return err('VALUE', `${name} needs at least one value`);
          return name === 'AND' ? bools.every(Boolean) : bools.some(Boolean);
        }
        case 'NOT': {
          if (flat.length !== 1) return err('NA', 'NOT needs one value');
          const b = toBoolean(flat[0]);
          if (isFormulaError(b)) return b;
          return !b;
        }
        case 'SUM': {
          const nums = numbersOf(flat);
          if (isFormulaError(nums)) return nums;
          return nums.reduce((a, b) => a + b, 0);
        }
        case 'AVERAGE': {
          const nums = numbersOf(flat);
          if (isFormulaError(nums)) return nums;
          if (nums.length === 0) return err('DIV0', 'AVERAGE has no numbers to average');
          return nums.reduce((a, b) => a + b, 0) / nums.length;
        }
        case 'MIN':
        case 'MAX': {
          const nums = numbersOf(flat);
          if (isFormulaError(nums)) return nums;
          if (nums.length === 0) return err('VALUE', `${name} has no numbers`);
          return name === 'MIN' ? Math.min(...nums) : Math.max(...nums);
        }
        case 'COUNT': {
          const nums = numbersOf(flat);
          if (isFormulaError(nums)) return nums;
          return nums.length;
        }
        case 'ROUND':
        case 'ROUNDUP':
        case 'ROUNDDOWN': {
          if (flat.length < 1) return err('NA', `${name} needs a number`);
          const n = toNumber(flat[0]);
          if (isFormulaError(n)) return n;
          let digits = 0;
          if (flat.length > 1) {
            const d = toNumber(flat[1]);
            if (isFormulaError(d)) return d;
            digits = Math.trunc(d);
          }
          const factor = Math.pow(10, digits);
          const scaled = n * factor;
          const rounded =
            name === 'ROUND'
              ? Math.sign(scaled) * Math.round(Math.abs(scaled))
              : name === 'ROUNDUP'
                ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
                : Math.sign(scaled) * Math.floor(Math.abs(scaled));
          return rounded / factor;
        }
        case 'ABS':
        case 'INT':
        case 'SQRT': {
          if (flat.length !== 1) return err('NA', `${name} needs one number`);
          const n = toNumber(flat[0]);
          if (isFormulaError(n)) return n;
          if (name === 'ABS') return Math.abs(n);
          if (name === 'INT') return Math.floor(n);
          if (n < 0) return err('NUM', 'SQRT of a negative number');
          return Math.sqrt(n);
        }
        case 'POWER':
        case 'MOD': {
          if (flat.length !== 2) return err('NA', `${name} needs two numbers`);
          const a = toNumber(flat[0]);
          if (isFormulaError(a)) return a;
          const b = toNumber(flat[1]);
          if (isFormulaError(b)) return b;
          if (name === 'POWER') return Math.pow(a, b);
          if (b === 0) return err('DIV0', 'MOD by zero');
          return a - b * Math.floor(a / b);
        }
        default:
          return err('NAME', `Unknown function "${name}" — supported: ${FORMULA_FUNCTIONS.join(', ')}`);
      }
    }

    default:
      return err('VALUE', 'Could not evaluate the formula');
  }
}

// ---------------------------------------------------------------------------
// Compiled formula (parse once, evaluate per row)
// ---------------------------------------------------------------------------

export interface CompiledFormula {
  source: string;
  ast: Node;
  /** Columns this formula reads, so a change to one of them can invalidate it
   *  and so cycles can be detected before evaluating. */
  referencedColumns: number[];
}

export function compileFormula(source: string): CompiledFormula {
  const ast = parseFormula(source);
  const cols = new Set<number>();
  (function walk(n: Node) {
    switch (n.k) {
      case 'ref':
        cols.add(n.col);
        break;
      case 'range': {
        const c1 = Math.min(n.c1, n.c2);
        const c2 = Math.max(n.c1, n.c2);
        for (let c = c1; c <= c2; c++) cols.add(c);
        break;
      }
      case 'unary':
      case 'postfix':
        walk(n.arg);
        break;
      case 'bin':
        walk(n.left);
        walk(n.right);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  })(ast);
  return { source, ast, referencedColumns: Array.from(cols).sort((a, b) => a - b) };
}

/** Validates a formula without running it. Returns null when it parses. */
export function validateFormula(source: string): string | null {
  try {
    compileFormula(source);
    return null;
  } catch (e: any) {
    return e?.message || 'Invalid formula';
  }
}

// ---------------------------------------------------------------------------
// Sheet-level evaluation with cycle detection
// ---------------------------------------------------------------------------

export interface SheetFormulaSpec {
  /** 0-based column the formula fills. */
  col: number;
  source: string;
  /** 1-based first row it applies to (rows above keep their original value —
   *  these sheets carry title/header/description rows on top). */
  firstRow: number;
}

export interface SheetEvalOptions {
  grid: string[][];
  rowCount: number;
  colCount: number;
  formulas: SheetFormulaSpec[];
}

export interface SheetEvaluator {
  /** Value for any cell, computed columns included. */
  valueAt: (row: number, col: number) => EvalResult;
  /** Compile errors per column, keyed by column index. */
  compileErrors: Map<number, string>;
}

/**
 * Builds an evaluator over one tab. Computed columns can reference each other;
 * a cycle yields a CIRCULAR error on the cells involved instead of hanging.
 * Results are memoised per cell, so a column referencing a wide range stays
 * cheap when several columns read the same inputs.
 */
export function buildSheetEvaluator(options: SheetEvalOptions): SheetEvaluator {
  const { grid, rowCount, colCount } = options;

  const compiled = new Map<number, CompiledFormula>();
  const firstRowByCol = new Map<number, number>();
  const compileErrors = new Map<number, string>();

  options.formulas.forEach((spec) => {
    try {
      compiled.set(spec.col, compileFormula(spec.source));
      firstRowByCol.set(spec.col, spec.firstRow);
    } catch (e: any) {
      compileErrors.set(spec.col, e?.message || 'Invalid formula');
    }
  });

  const cache = new Map<string, EvalResult>();
  const inProgress = new Set<string>();

  function rawAt(row: number, col: number): string {
    return grid[row]?.[col] ?? '';
  }

  function valueAt(row: number, col: number): EvalResult {
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return '';

    const formula = compiled.get(col);
    const firstRow = firstRowByCol.get(col) ?? 1;
    // Above the first data row a computed column keeps whatever the sheet has
    // there (titles, headers, the description line).
    if (!formula || row + 1 < firstRow) return rawAt(row, col);

    const key = `${row}|${col}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    if (inProgress.has(key)) {
      return err('CIRCULAR', `Circular reference at ${columnIndexToLetter(col)}${row + 1}`);
    }

    inProgress.add(key);
    let result: EvalResult;
    try {
      result = evaluateAst(formula.ast, {
        rowIndex: row,
        rowCount,
        colCount,
        resolveCell: (r, c) => valueAt(r, c),
      });
    } finally {
      inProgress.delete(key);
    }

    cache.set(key, result);
    return result;
  }

  return { valueAt, compileErrors };
}

// ---------------------------------------------------------------------------
// Excel serialisation
// ---------------------------------------------------------------------------

const EXCEL_OPERATOR: Record<string, string> = {
  '==': '=',
  '!=': '<>',
};

/**
 * Re-serialises a compiled formula as an Excel formula for one specific row.
 *
 * The app's own syntax uses a bare column letter to mean "this row" (`= G - H`),
 * which Excel has no equivalent for — so exporting has to bind it to a real
 * row: for row 7 that becomes `=G7-H7`. Absolute refs and ranges are already
 * row-qualified and pass through unchanged.
 */
export function toExcelFormula(compiled: CompiledFormula, rowNumber: number): string {
  function ser(n: Node): string {
    switch (n.k) {
      case 'num':
        return String(n.v);
      case 'str':
        return `"${n.v.replace(/"/g, '""')}"`;
      case 'bool':
        return n.v ? 'TRUE' : 'FALSE';
      case 'ref':
        return `${columnIndexToLetter(n.col)}${n.row === null ? rowNumber : n.row}`;
      case 'range': {
        const a = `${columnIndexToLetter(n.c1)}${n.r1 === null ? 1 : n.r1}`;
        const b = `${columnIndexToLetter(n.c2)}${n.r2 === null ? rowNumber : n.r2}`;
        return `${a}:${b}`;
      }
      case 'unary':
        return `${n.op}${ser(n.arg)}`;
      case 'postfix':
        return `${ser(n.arg)}%`;
      case 'bin':
        return `(${ser(n.left)}${EXCEL_OPERATOR[n.op] || n.op}${ser(n.right)})`;
      case 'call':
        return `${n.name}(${n.args.map(ser).join(',')})`;
      default:
        return '';
    }
  }
  return `=${ser(compiled.ast)}`;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Formats a computed value the way the surrounding sheet reads: grouped
 *  thousands, at most 2 decimals, errors as #CODE. */
export function formatFormulaValue(v: EvalResult): string {
  if (isFormulaError(v)) return `#${v.code}`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM';
    const rounded = Math.abs(v) < 1e-10 ? 0 : v;
    const hasFraction = Math.abs(rounded % 1) > 1e-9;
    return rounded.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    });
  }
  return String(v);
}
