/**
 * work-item-migrate.ts — pure, subprocess-free, fs-free planner for assigning
 * work-item IDs to existing planning records using the audit's own parsers.
 */

import { planningLines } from './markdown.ts';
import {
  extractInlineBulletId,
  futureBulletInsertEdit,
  futureBulletParts,
  legacyShippedBulletInsertEdit,
  legacyTodoBulletKind,
  mintRandomId,
} from './work-item-id.ts';
import { parseRoadmap } from '../parsers/roadmap.ts';
import { parseTodos, type TodoEntry } from '../parsers/todos.ts';

export type MigrateDocKind = 'todos' | 'roadmap' | 'future' | 'shipped';

export type MigrateDocInput = {
  kind: MigrateDocKind;
  relPath: string;
  content: string;
};

export type MigrateAssignment = {
  relPath: string;
  line: number;
  id: string;
  kind: string;
  label: string;
};

export type MigrateRefusal = {
  relPath: string;
  line: number;
  kind: string;
  reason: string;
};

export type MigrateFileOutput = {
  relPath: string;
  content: string;
  changed: boolean;
};

export type MigrateResult = {
  assignments: MigrateAssignment[];
  refusals: MigrateRefusal[];
  files: MigrateFileOutput[];
};

type LineSlice = {
  start: number;
  end: number; // before EOL
  eol: string; // '\r\n' | '\n' | ''
  text: string;
};

type SpanEdit = {
  pos: number;
  text: string;
};

function indexLines(content: string): LineSlice[] {
  const out: LineSlice[] = [];
  let pos = 0;
  while (pos < content.length) {
    const nl = content.indexOf('\n', pos);
    if (nl === -1) {
      const hasCr = content.endsWith('\r');
      const end = hasCr ? content.length - 1 : content.length;
      out.push({ start: pos, end, eol: '', text: content.slice(pos, end) });
      pos = content.length;
    } else {
      const hasCr = nl > pos && content[nl - 1] === '\r';
      const end = hasCr ? nl - 1 : nl;
      const eol = hasCr ? '\r\n' : '\n';
      out.push({ start: pos, end, eol, text: content.slice(pos, end) });
      pos = nl + 1;
    }
  }
  return out;
}

function detectDocEol(lines: LineSlice[]): string {
  for (const line of lines) {
    if (line.eol !== '') return line.eol;
  }
  return '\n';
}

function insertLineAfter(lines: LineSlice[], lineNo: number, newLine: string): SpanEdit {
  const slice = lines[lineNo - 1]!;
  if (slice.eol !== '') {
    return {
      pos: slice.end + slice.eol.length,
      text: `${newLine}${slice.eol}`,
    };
  }
  const eol = detectDocEol(lines);
  return {
    pos: slice.end,
    text: `${eol}${newLine}`,
  };
}

function insertLinesBefore(lines: LineSlice[], lineNo: number, newLines: string[]): SpanEdit {
  const slice = lines[lineNo - 1]!;
  const eol = slice.eol !== '' ? slice.eol : detectDocEol(lines);
  return {
    pos: slice.start,
    text: newLines.map(l => `${l}${eol}`).join(''),
  };
}

function applyEdits(
  original: string,
  edits: SpanEdit[],
): { content: string; insertedRanges: Array<{ start: number; end: number }> } {
  const sorted = [...edits].sort((a, b) => a.pos - b.pos);
  const pieces: string[] = [];
  const insertedRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  let outLen = 0;
  for (const edit of sorted) {
    const chunk = original.slice(cursor, edit.pos);
    pieces.push(chunk);
    outLen += chunk.length;
    const start = outLen;
    pieces.push(edit.text);
    outLen += edit.text.length;
    insertedRanges.push({ start, end: outLen });
    cursor = edit.pos;
  }
  pieces.push(original.slice(cursor));
  return { content: pieces.join(''), insertedRanges };
}

function removeInsertedRanges(
  modified: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const r of ranges) {
    pieces.push(modified.slice(cursor, r.start));
    cursor = r.end;
  }
  pieces.push(modified.slice(cursor));
  return pieces.join('');
}

function planTodoEntryEdit(
  entry: TodoEntry,
  id: string,
  lines: LineSlice[],
  planLineMap: Map<number, string>,
): SpanEdit {
  const headingLine = entry.line;
  // Boundary: next planning line treated as an entry or section (`### `,
  // legacy/compact bullet with withinHeading=true, or `## `), or EOF.
  let boundaryLine = lines.length + 1;
  for (let ln = headingLine + 1; ln <= lines.length; ln++) {
    const pLine = planLineMap.get(ln);
    if (pLine === undefined) continue;
    if (/^## /.test(pLine) || /^### /.test(pLine) || legacyTodoBulletKind(pLine, true) !== null) {
      boundaryLine = ln;
      break;
    }
  }

  for (let ln = headingLine + 1; ln < boundaryLine; ln++) {
    const raw = lines[ln - 1]!.text;
    if (raw.trim() === '') continue;
    if (raw.startsWith('- ')) {
      // T-a: attribute, checklist or link bullet
      return insertLinesBefore(lines, ln, [`- **ID:** ${id}`]);
    }
    // T-b: other text (e.g. **What:** paragraph)
    return insertLinesBefore(lines, ln, [`- **ID:** ${id}`, '']);
  }

  // T-c: nothing but blank lines before the boundary
  return insertLineAfter(lines, headingLine, `- **ID:** ${id}`);
}

function findRoadmapTrackMetadataLine(
  headingLine: number,
  lines: LineSlice[],
  planLineMap: Map<number, string>,
): number | null {
  for (let ln = headingLine + 1; ln <= lines.length; ln++) {
    const pLine = planLineMap.get(ln);
    if (pLine === undefined) continue;
    if (pLine.trim() === '') continue;
    if (/^#{2,5} /.test(pLine)) return null;
    if (/^_id:/i.test(pLine) || /^_touches:/.test(pLine)) return null;
    if (/^_.*_$/.test(pLine)) return ln;
    return null;
  }
  return null;
}

function sameInlineField(
  a: ReturnType<typeof extractInlineBulletId>,
  b: ReturnType<typeof extractInlineBulletId>,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.raw === b.raw && a.id === b.id && a.duplicate === b.duplicate;
}

function verifyTodosReadback(
  relPath: string,
  before: ReturnType<typeof parseTodos>['value'],
  after: ReturnType<typeof parseTodos>['value'],
  unprocessedTargets: Map<number, string>,
  completedTargets: Map<number, string>,
): MigrateRefusal | null {
  const fail = (line: number, reason: string): MigrateRefusal => ({
    relPath, line, kind: 'todo', reason: `read-back verification failed: ${reason}`,
  });

  if (before.entries.length !== after.entries.length) {
    return fail(1, `unprocessed entry count changed (${before.entries.length} -> ${after.entries.length})`);
  }
  for (let i = 0; i < before.entries.length; i++) {
    const b = before.entries[i]!;
    const a = after.entries[i]!;
    if (b.kind !== a.kind) return fail(b.line, `entry kind changed at index ${i}`);
    if (b.kind === 'heading') {
      if (b.title !== a.title) return fail(b.line, `TODO title changed`);
      const assigned = unprocessedTargets.get(i);
      if (assigned !== undefined) {
        if (a.workItemId !== assigned || a.workItemIdError !== null) {
          return fail(b.line, `assigned ID ${assigned} did not read back cleanly`);
        }
      } else if (
        b.workItemIdRaw !== a.workItemIdRaw ||
        b.workItemId !== a.workItemId ||
        b.workItemIdError !== a.workItemIdError
      ) {
        return fail(b.line, `non-target TODO ID changed`);
      }
    }
  }

  const beforeComp = before.completedEntries ?? [];
  const afterComp = after.completedEntries ?? [];
  if (beforeComp.length !== afterComp.length) {
    return fail(1, `completed entry count changed (${beforeComp.length} -> ${afterComp.length})`);
  }
  for (let i = 0; i < beforeComp.length; i++) {
    const b = beforeComp[i]!;
    const a = afterComp[i]!;
    if (b.title !== a.title) return fail(b.line, `completed TODO title changed`);
    const assigned = completedTargets.get(i);
    if (assigned !== undefined) {
      if (a.workItemId !== assigned || a.workItemIdError !== null) {
        return fail(b.line, `assigned completed ID ${assigned} did not read back cleanly`);
      }
    } else if (
      b.workItemIdRaw !== a.workItemIdRaw ||
      b.workItemId !== a.workItemId ||
      b.workItemIdError !== a.workItemIdError
    ) {
      return fail(b.line, `non-target completed TODO ID changed`);
    }
  }

  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const expectedCompletedIds = [
    ...(before.completedIds ?? []),
    ...completedTargets.values(),
  ].sort(cmp);
  const actualCompletedIds = [...(after.completedIds ?? [])].sort(cmp);
  if (
    expectedCompletedIds.length !== actualCompletedIds.length ||
    expectedCompletedIds.some((v, idx) => v !== actualCompletedIds[idx])
  ) {
    return fail(1, `completedIds set did not match expected assignments`);
  }

  return null;
}

function verifyFutureBulletsReadback(
  relPath: string,
  beforeBullets: string[],
  beforeLines: number[],
  afterBullets: string[],
  targets: Map<number, string>,
): MigrateRefusal | null {
  const fail = (line: number, reason: string): MigrateRefusal => ({
    relPath, line, kind: 'future', reason: `read-back verification failed: ${reason}`,
  });

  if (beforeBullets.length !== afterBullets.length) {
    return fail(1, `future bullet count changed (${beforeBullets.length} -> ${afterBullets.length})`);
  }
  for (let i = 0; i < beforeBullets.length; i++) {
    const b = beforeBullets[i]!;
    const a = afterBullets[i]!;
    const line = beforeLines[i] ?? 1;
    if (futureBulletParts(b).title !== futureBulletParts(a).title) {
      return fail(line, `future bullet title changed`);
    }
    const afterField = extractInlineBulletId(a);
    const assigned = targets.get(i);
    if (assigned !== undefined) {
      if (afterField === null || afterField.id !== assigned || afterField.duplicate) {
        return fail(line, `assigned ID ${assigned} did not read back cleanly`);
      }
    } else {
      const beforeField = extractInlineBulletId(b);
      if (!sameInlineField(beforeField, afterField)) {
        return fail(line, `non-target future bullet ID changed`);
      }
    }
  }
  return null;
}

function verifyRoadmapReadback(
  relPath: string,
  kind: 'roadmap' | 'shipped',
  before: ReturnType<typeof parseRoadmap>['value'],
  after: ReturnType<typeof parseRoadmap>['value'],
  trackTargets: Map<number, string>,
  legacyTargets: Map<number, string>,
  futureTargets: Map<number, string>,
): MigrateRefusal | null {
  const fail = (line: number, recKind: string, reason: string): MigrateRefusal => ({
    relPath, line, kind: recKind, reason: `read-back verification failed: ${reason}`,
  });

  if (before.tracks.length !== after.tracks.length) {
    return fail(1, 'track', `track count changed (${before.tracks.length} -> ${after.tracks.length})`);
  }
  for (let i = 0; i < before.tracks.length; i++) {
    const b = before.tracks[i]!;
    const a = after.tracks[i]!;
    const line = b.line ?? 1;
    if (b.id !== a.id) return fail(line, 'track', `track label changed (${b.id} -> ${a.id})`);
    const assigned = trackTargets.get(i);
    if (assigned !== undefined) {
      if (a.workItemId !== assigned || a.workItemIdError !== null) {
        return fail(line, 'track', `assigned ID ${assigned} did not read back cleanly`);
      }
    } else if (
      b.workItemIdRaw !== a.workItemIdRaw ||
      b.workItemId !== a.workItemId ||
      b.workItemIdError !== a.workItemIdError
    ) {
      return fail(line, 'track', `non-target track ID changed`);
    }
  }

  const beforeExtra = before.extraTrackWorkItems ?? [];
  const afterExtra = after.extraTrackWorkItems ?? [];
  if (beforeExtra.length !== afterExtra.length) {
    return fail(1, 'track', `duplicate-label track count changed`);
  }
  for (let i = 0; i < beforeExtra.length; i++) {
    const b = beforeExtra[i]!;
    const a = afterExtra[i]!;
    if (
      b.label !== a.label ||
      b.workItemIdRaw !== a.workItemIdRaw ||
      b.workItemId !== a.workItemId ||
      b.workItemIdError !== a.workItemIdError
    ) {
      return fail(b.line ?? 1, 'track', `duplicate-label track changed`);
    }
  }

  const beforeLegacy = before.legacyShippedTracks ?? [];
  const afterLegacy = after.legacyShippedTracks ?? [];
  if (beforeLegacy.length !== afterLegacy.length) {
    return fail(1, 'legacy-track', `legacy shipped track count changed`);
  }
  for (let i = 0; i < beforeLegacy.length; i++) {
    const b = beforeLegacy[i]!;
    const a = afterLegacy[i]!;
    if (b.label !== a.label) return fail(b.line, 'legacy-track', `legacy track label changed`);
    const assigned = legacyTargets.get(i);
    if (assigned !== undefined) {
      if (a.workItemId !== assigned || a.workItemIdError !== null) {
        return fail(b.line, 'legacy-track', `assigned ID ${assigned} did not read back cleanly`);
      }
    } else if (
      b.workItemIdRaw !== a.workItemIdRaw ||
      b.workItemId !== a.workItemId ||
      b.workItemIdError !== a.workItemIdError
    ) {
      return fail(b.line, 'legacy-track', `non-target legacy track ID changed`);
    }
  }

  if (kind === 'roadmap') {
    const futureErr = verifyFutureBulletsReadback(
      relPath,
      before.futureBullets,
      before.futureBulletLines ?? [],
      after.futureBullets,
      futureTargets,
    );
    if (futureErr !== null) return futureErr;
  }

  return null;
}

/**
 * Plan work-item ID insertions across all supplied planning documents.
 * Pure: performs no filesystem or subprocess I/O.
 */
export function planWorkItemMigration(
  docs: MigrateDocInput[],
  initialTaken: ReadonlySet<string>,
  mintId: (taken: ReadonlySet<string>) => string = mintRandomId,
): MigrateResult {
  const taken = new Set<string>(initialTaken);
  const assignments: MigrateAssignment[] = [];
  const refusals: MigrateRefusal[] = [];
  const files: MigrateFileOutput[] = [];

  const nextId = (): string => {
    const id = mintId(taken);
    taken.add(id);
    return id;
  };

  for (const doc of docs) {
    const lines = indexLines(doc.content);
    const edits: SpanEdit[] = [];
    const docRefusalsStart = refusals.length;

    if (doc.kind === 'todos') {
      const before = parseTodos(doc.content).value;
      const planLineMap = new Map<number, string>();
      for (const [ln, text] of planningLines(doc.content)) planLineMap.set(ln, text);

      const unprocessedTargets = new Map<number, string>();
      const completedTargets = new Map<number, string>();

      for (let i = 0; i < before.entries.length; i++) {
        const entry = before.entries[i]!;
        if (entry.kind !== 'heading') continue;
        if (entry.workItemIdRaw !== null || entry.workItemIdError !== null) continue;
        const id = nextId();
        unprocessedTargets.set(i, id);
        edits.push(planTodoEntryEdit(entry, id, lines, planLineMap));
        assignments.push({
          relPath: doc.relPath,
          line: entry.line,
          id,
          kind: 'todo',
          label: entry.title || entry.raw.replace(/^### /, '').trim(),
        });
      }

      const completed = before.completedEntries ?? [];
      for (let i = 0; i < completed.length; i++) {
        const entry = completed[i]!;
        if (entry.workItemIdRaw !== null || entry.workItemIdError !== null) continue;
        const id = nextId();
        completedTargets.set(i, id);
        edits.push(planTodoEntryEdit(entry, id, lines, planLineMap));
        assignments.push({
          relPath: doc.relPath,
          line: entry.line,
          id,
          kind: 'todo',
          label: entry.title || entry.raw.replace(/^### /, '').trim(),
        });
      }

      if (edits.length === 0) {
        files.push({ relPath: doc.relPath, content: doc.content, changed: false });
        continue;
      }

      const { content: updated, insertedRanges } = applyEdits(doc.content, edits);
      if (removeInsertedRanges(updated, insertedRanges) !== doc.content) {
        refusals.push({
          relPath: doc.relPath,
          line: 1,
          kind: 'todo',
          reason: 'read-back verification failed: removing inserted spans did not restore original bytes',
        });
      } else {
        const after = parseTodos(updated).value;
        const err = verifyTodosReadback(doc.relPath, before, after, unprocessedTargets, completedTargets);
        if (err !== null) refusals.push(err);
      }
      files.push({ relPath: doc.relPath, content: updated, changed: true });
      continue;
    }

    if (doc.kind === 'future') {
      const before = parseRoadmap(doc.content).value;
      const bulletLines = before.futureBulletLines ?? [];
      const futureTargets = new Map<number, string>();

      for (let i = 0; i < before.futureBullets.length; i++) {
        const bullet = before.futureBullets[i]!;
        if (extractInlineBulletId(bullet) !== null) continue;
        const lineNo = bulletLines[i]!;
        const rawLine = lines[lineNo - 1]!.text;
        const id = nextId();
        const edit = futureBulletInsertEdit(rawLine, id);
        if (edit === null) {
          refusals.push({
            relPath: doc.relPath,
            line: lineNo,
            kind: 'future',
            reason: 'no title dash separator before Revisit when',
          });
          continue;
        }
        futureTargets.set(i, id);
        edits.push({
          pos: lines[lineNo - 1]!.start + edit.offset,
          text: edit.text,
        });
        assignments.push({
          relPath: doc.relPath,
          line: lineNo,
          id,
          kind: 'future',
          label: futureBulletParts(bullet).title,
        });
      }

      if (refusals.length > docRefusalsStart || edits.length === 0) {
        files.push({ relPath: doc.relPath, content: doc.content, changed: false });
        continue;
      }

      const { content: updated, insertedRanges } = applyEdits(doc.content, edits);
      if (removeInsertedRanges(updated, insertedRanges) !== doc.content) {
        refusals.push({
          relPath: doc.relPath,
          line: 1,
          kind: 'future',
          reason: 'read-back verification failed: removing inserted spans did not restore original bytes',
        });
      } else {
        const after = parseRoadmap(updated).value;
        const err = verifyFutureBulletsReadback(
          doc.relPath,
          before.futureBullets,
          bulletLines,
          after.futureBullets,
          futureTargets,
        );
        if (err !== null) refusals.push(err);
      }
      files.push({ relPath: doc.relPath, content: updated, changed: true });
      continue;
    }

    // doc.kind === 'roadmap' | 'shipped'
    const fromShippedArchive = doc.kind === 'shipped';
    const before = parseRoadmap(doc.content, fromShippedArchive ? { fromShippedArchive: true } : {}).value;
    const planLineMap = new Map<number, string>();
    for (const [ln, text] of planningLines(doc.content)) planLineMap.set(ln, text);

    const trackTargets = new Map<number, string>();
    const legacyTargets = new Map<number, string>();
    const futureTargets = new Map<number, string>();

    for (let i = 0; i < before.tracks.length; i++) {
      const track = before.tracks[i]!;
      if (track.workItemIdRaw !== null || track.workItemIdError !== null) continue;
      const headingLine = track.line;
      if (headingLine === undefined) {
        refusals.push({
          relPath: doc.relPath,
          line: 1,
          kind: fromShippedArchive ? 'shipped-track' : 'track',
          reason: `missing heading line coordinate for Track ${track.id}`,
        });
        continue;
      }

      if (fromShippedArchive) {
        if (!planLineMap.get(headingLine)?.startsWith('### Track ')) {
          refusals.push({
            relPath: doc.relPath,
            line: headingLine,
            kind: 'shipped-track',
            reason: `Track ${track.id} must use a level-three shipped archive heading`,
          });
          continue;
        }
        const id = nextId();
        trackTargets.set(i, id);
        edits.push(insertLineAfter(lines, headingLine, `_id: ${id}_`));
        assignments.push({
          relPath: doc.relPath,
          line: headingLine,
          id,
          kind: 'shipped-track',
          label: `Track ${track.id}`,
        });
      } else {
        const metaLine = findRoadmapTrackMetadataLine(headingLine, lines, planLineMap);
        if (metaLine === null) {
          refusals.push({
            relPath: doc.relPath,
            line: headingLine,
            kind: 'track',
            reason: `Track ${track.id} has no metadata line`,
          });
          continue;
        }
        const id = nextId();
        trackTargets.set(i, id);
        edits.push(insertLineAfter(lines, metaLine, `_id: ${id}_`));
        assignments.push({
          relPath: doc.relPath,
          line: headingLine,
          id,
          kind: 'track',
          label: `Track ${track.id}`,
        });
      }
    }

    for (const extra of before.extraTrackWorkItems ?? []) {
      if (extra.workItemIdRaw !== null || extra.workItemIdError !== null) continue;
      refusals.push({
        relPath: doc.relPath,
        line: extra.line ?? 1,
        kind: fromShippedArchive ? 'shipped-track' : 'track',
        reason: `duplicate track label Track ${extra.label} lacks an ID`,
      });
    }

    const legacyTracks = before.legacyShippedTracks ?? [];
    for (let i = 0; i < legacyTracks.length; i++) {
      const legacy = legacyTracks[i]!;
      if (legacy.workItemIdRaw !== null || legacy.workItemIdError !== null) continue;
      const lineNo = legacy.line;
      const rawLine = lines[lineNo - 1]!.text;
      const id = nextId();
      const edit = legacyShippedBulletInsertEdit(rawLine, id);
      if (edit === null) {
        refusals.push({
          relPath: doc.relPath,
          line: lineNo,
          kind: 'legacy-track',
          reason: `legacy shipped bullet Track ${legacy.label} has no dash separator`,
        });
        continue;
      }
      legacyTargets.set(i, id);
      edits.push({
        pos: lines[lineNo - 1]!.start + edit.offset,
        text: edit.text,
      });
      assignments.push({
        relPath: doc.relPath,
        line: lineNo,
        id,
        kind: 'legacy-track',
        label: `Track ${legacy.label}`,
      });
    }

    if (doc.kind === 'roadmap') {
      const bulletLines = before.futureBulletLines ?? [];
      for (let i = 0; i < before.futureBullets.length; i++) {
        const bullet = before.futureBullets[i]!;
        if (extractInlineBulletId(bullet) !== null) continue;
        const lineNo = bulletLines[i]!;
        const rawLine = lines[lineNo - 1]!.text;
        const id = nextId();
        const edit = futureBulletInsertEdit(rawLine, id);
        if (edit === null) {
          refusals.push({
            relPath: doc.relPath,
            line: lineNo,
            kind: 'future',
            reason: 'no title dash separator before Revisit when',
          });
          continue;
        }
        futureTargets.set(i, id);
        edits.push({
          pos: lines[lineNo - 1]!.start + edit.offset,
          text: edit.text,
        });
        assignments.push({
          relPath: doc.relPath,
          line: lineNo,
          id,
          kind: 'future',
          label: futureBulletParts(bullet).title,
        });
      }
    }

    if (refusals.length > docRefusalsStart || edits.length === 0) {
      files.push({ relPath: doc.relPath, content: doc.content, changed: false });
      continue;
    }

    const { content: updated, insertedRanges } = applyEdits(doc.content, edits);
    if (removeInsertedRanges(updated, insertedRanges) !== doc.content) {
      refusals.push({
        relPath: doc.relPath,
        line: 1,
        kind: fromShippedArchive ? 'shipped-track' : 'track',
        reason: 'read-back verification failed: removing inserted spans did not restore original bytes',
      });
    } else {
      const after = parseRoadmap(updated, fromShippedArchive ? { fromShippedArchive: true } : {}).value;
      const err = verifyRoadmapReadback(
        doc.relPath,
        doc.kind,
        before,
        after,
        trackTargets,
        legacyTargets,
        futureTargets,
      );
      if (err !== null) refusals.push(err);
    }
    files.push({ relPath: doc.relPath, content: updated, changed: true });
  }

  return { assignments, refusals, files };
}
