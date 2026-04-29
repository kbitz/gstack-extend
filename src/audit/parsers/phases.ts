/**
 * phases.ts — port of _parse_phases from bin/roadmap-audit.
 *
 * Single-pass scan of ROADMAP.md for `## Phase N: Title` H2 blocks.
 * For each phase captures: head line number, title, whether it declared
 * **End-state:** and **Groups:** fields, the listed group numbers, and
 * any backtick-quoted scaffolding paths found inside a "Scaffolding
 * contract:" block.
 *
 * Lightweight by design — no field validation here. check_phase_invariants
 * does that downstream.
 *
 * Bold (`**Field:**`) and plain (`Field:`) prefixes are both accepted to
 * match bash's `^\*?\*?Field:\*?\*?` regex.
 */

import type { ParseError, ParserResult } from '../types.ts';

const WS = '[ \\t\\v\\f\\r]';

export type PhaseInfo = {
  num: string;
  title: string;
  headLine: number; // 1-indexed
  hasEndState: boolean;
  hasGroups: boolean;
  groupNums: string[];
  scaffoldPaths: string[];
};

export type ParsedPhases = {
  phases: PhaseInfo[];
};

function trim(s: string): string {
  return s.replace(new RegExp(`^${WS}+|${WS}+$`, 'g'), '');
}

export function parsePhases(content: string): ParserResult<ParsedPhases> {
  const errors: ParseError[] = [];
  const phases: PhaseInfo[] = [];
  if (content === '') return { value: { phases }, errors };

  const lines = content.split('\n');
  let cur: PhaseInfo | null = null;
  let inScaffolding = false;
  let lineno = 0;

  for (const line of lines) {
    lineno++;

    // Phase heading.
    const phaseHeading = line.match(/^## Phase ([0-9]+):(.*)$/);
    if (phaseHeading) {
      cur = {
        num: phaseHeading[1]!,
        title: trim(phaseHeading[2]!),
        headLine: lineno,
        hasEndState: false,
        hasGroups: false,
        groupNums: [],
        scaffoldPaths: [],
      };
      phases.push(cur);
      inScaffolding = false;
      continue;
    }

    // Any other H2 closes the Phase block.
    if (/^## /.test(line)) {
      cur = null;
      inScaffolding = false;
      continue;
    }

    if (cur === null) continue;

    // End-state line.
    if (/^\*?\*?End-state:\*?\*?/i.test(line)) {
      cur.hasEndState = true;
      inScaffolding = false;
      continue;
    }

    // Groups line.
    if (/^\*?\*?Groups:\*?\*?/i.test(line)) {
      cur.hasGroups = true;
      inScaffolding = false;
      // Extract digits + commas: strip parenthetical, then keep only [0-9,].
      let raw = line.replace(/^\*?\*?Groups:\*?\*?[ \t\v\f\r]*/i, '');
      raw = raw.replace(/\(.*\)/, '');
      raw = raw.replace(/[^0-9,]/g, '');
      raw = raw.replace(/,+$/, '');
      cur.groupNums = raw === '' ? [] : raw.split(',').filter((x) => x !== '');
      continue;
    }

    // Scaffolding block opener.
    if (/^\*?\*?Scaffolding contract:\*?\*?/i.test(line)) {
      inScaffolding = true;
      continue;
    }

    // Inside scaffolding block — extract backtick-quoted tokens.
    if (inScaffolding) {
      if (trim(line) === '') {
        inScaffolding = false;
        continue;
      }
      const tokens = line.match(/`[^`]+`/g) ?? [];
      for (const tok of tokens) {
        cur.scaffoldPaths.push(tok.slice(1, -1));
      }
    }
  }

  return { value: { phases }, errors };
}
