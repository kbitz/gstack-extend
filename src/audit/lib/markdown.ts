import { Lexer, Marked, Tokenizer, type Token, type Tokens } from 'marked';

// CommonMark permits ASCII spaces and tabs after a closing fence. Keep the
// pinned lexer's opening and nesting rules and amend only its closing tail.
const originalFences = Lexer.rules.block.gfm.fences;
const fences = new RegExp(
  originalFences.source.replace(' *(?=\\n|$)', '[ \\t]*(?=\\n|$)'),
  originalFences.flags,
);
const planningMarked = new Marked({ gfm: true, pedantic: false });
planningMarked.use({
  tokenizer: {
    fences(src) {
      const rules = this.rules;
      this.rules = { ...rules, block: { ...rules.block, fences } };
      try {
        return Tokenizer.prototype.fences.call(this, src);
      } finally {
        this.rules = rules;
      }
    },
  },
});

function advanceLine(line: number, raw: string): number {
  return line + raw.split('\n').length - 1;
}

/** Yield planning text with its original, one-based file coordinates. */
export function* planningLines(content: string): Generator<readonly [lineNo: number, line: string]> {
  if (content === '') return;

  const rawLines = content.split('\n').map(line => line.replace(/\r$/, ''));
  const lexSource = rawLines.map(line => line.replace(/\r/g, ' ')).join('\n');
  // Finish lexing before yielding, so walkers can be interleaved.
  const tokens = planningMarked.lexer(lexSource);
  let lastYieldedLine = -1;

  function* walk(blocks: Token[], startLine: number): Generator<readonly [number, string]> {
    let line = startLine;
    for (const token of blocks) {
      switch (token.type) {
        case 'list': {
          let itemLine = line;
          for (const item of (token as Tokens.List).items) {
            yield* walk(item.tokens, itemLine);
            itemLine = advanceLine(itemLine, item.raw);
          }
          break;
        }
        case 'blockquote':
          yield* walk((token as Tokens.Blockquote).tokens, line);
          break;
        case 'code':
        case 'html':
        case 'space':
          break;
        default: {
          const end = advanceLine(line, token.raw.replace(/\n+$/, ''));
          // For example, a task checkbox and its text share one source line.
          for (let idx = Math.max(line, lastYieldedLine + 1); idx <= end; idx++) {
            lastYieldedLine = idx;
            yield [idx + 1, rawLines[idx]!] as const;
          }
        }
      }
      line = advanceLine(line, token.raw);
    }
  }

  yield* walk(tokens, 0);
}
