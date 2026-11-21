/**
 * Extend-root resolver locks and shell fixtures (Track 16D).
 *
 * The skill file is the source of truth for the canonical span. These
 * constants are the verbatim Part 1 / Part 4 strings the locks pin.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT_RESOLVER_SKILLS = [
  'pair-review',
  'full-review',
  'roadmap',
  'gstack-extend-upgrade',
  'gstack-extend-init',
  'docs-ship',
  'implement',
  'review-and-prep',
  'ship-and-land',
  'project-spec',
  'plan-track',
] as const;

export const WORKFLOW_SKILLS = [
  'pair-review',
  'full-review',
  'roadmap',
  'implement',
  'review-and-prep',
  'ship-and-land',
  'project-spec',
  'plan-track',
] as const;

export const SPAN_START = '_er_ok() {';
export const SPAN_END = 'unset _ER _ER_SRC _ER_SEEN';
export const MARKER_LINE = '# extend-root-protocol: v1';

export const CANONICAL_SPAN = [
  "_er_ok() { case \"$_ER\" in /*) [ -f \"$_ER/bin/update-check\" ] && [ -x \"$_ER/bin/update-check\" ] && grep -qx '# extend-root-protocol: v1' \"$_ER/bin/update-check\" 2>/dev/null ;; *) false ;; esac; }",
  '_EXTEND_ROOT=""',
  '_ER_SEEN=""',
  'for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.config/opencode/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.cursor/skills/"$_ER_SKILL"/SKILL.md; do',
  '  case "$_ER_SRC" in /*) ;; *) continue ;; esac',
  '  _ER=$(readlink "$_ER_SRC" 2>/dev/null || true)',
  '  [ -n "$_ER" ] || continue',
  '  case "$_ER" in /*) ;; *) _ER="$(dirname "$_ER_SRC")/$_ER" ;; esac',
  '  _ER=$(dirname "$(dirname "$_ER")")',
  '  if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi',
  '  _ER_SEEN="${_ER_SEEN:-$_ER}"',
  'done',
  'if [ -z "$_EXTEND_ROOT" ]; then',
  '  for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root "$HOME"/.config/opencode/skills/"$_ER_SKILL"/.extend-root "$HOME"/.cursor/skills/"$_ER_SKILL"/.extend-root; do',
  '    case "$_ER_SRC" in /*) ;; *) continue ;; esac',
  '    [ -f "$_ER_SRC" ] && [ -r "$_ER_SRC" ] || continue',
  '    _ER=""',
  '    IFS= read -r _ER < "$_ER_SRC" || true',
  '    if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi',
  '    _ER_SEEN="${_ER_SEEN:-${_ER:-empty:$_ER_SRC}}"',
  '  done',
  'fi',
  '_ER_UNVERIFIED=""',
  'if [ -z "$_EXTEND_ROOT" ] && [ -n "$_ER_SEEN" ]; then',
  '  _ER="$_ER_SEEN/bin/update-check"',
  '  case "$_ER_SEEN" in',
  '    empty:*) _ER_UNVERIFIED="${_ER_SEEN#empty:} is empty. Fix: run setup --host auto from your gstack-extend checkout" ;;',
  '    /*) if [ ! -e "$_ER" ]; then _ER_UNVERIFIED="$_ER_SEEN has no bin/update-check (checkout moved or deleted). Fix: re-clone gstack-extend (README: Installation), then run its setup --host auto"',
  '        elif [ ! -f "$_ER" ] || [ ! -x "$_ER" ] || [ ! -r "$_ER" ]; then _ER_UNVERIFIED="$_ER is not a readable executable file. Fix: git -C \\"$_ER_SEEN\\" checkout -- bin/update-check, then run \\"$_ER_SEEN/setup\\" --host auto"',
  '        else _ER_UNVERIFIED="$_ER lacks the line \'# extend-root-protocol: v1\' (checkout older than this skill, or not gstack-extend). Fix: git -C \\"$_ER_SEEN\\" pull --ff-only, then run \\"$_ER_SEEN/setup\\" --host auto"; fi ;;',
  '    *) _ER_UNVERIFIED="an install pointer names a non-absolute path ($_ER_SEEN). Fix: run setup --host auto from your gstack-extend checkout" ;;',
  '  esac',
  'fi',
  'unset _ER _ER_SRC _ER_SEEN',
].join('\n');

export const FOR_SKILL_LINE =
  'for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.config/opencode/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.cursor/skills/"$_ER_SKILL"/SKILL.md; do';
export const FOR_POINTER_LINE =
  'for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root "$HOME"/.config/opencode/skills/"$_ER_SKILL"/.extend-root "$HOME"/.cursor/skills/"$_ER_SKILL"/.extend-root; do';

export const WORKFLOW_TAIL = [
  'if [ -n "$_EXTEND_ROOT" ]; then',
  '  echo "EXTEND_ROOT: $_EXTEND_ROOT"',
  "  printf '_EXTEND_ROOT=%q\\n' \"$_EXTEND_ROOT\"",
  '  _UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)',
  '  [ -n "$_UPD" ] && echo "$_UPD" || true',
  'elif [ -n "$_ER_UNVERIFIED" ]; then',
  '  echo "EXTEND_ROOT_UNVERIFIED: $_ER_UNVERIFIED"',
  'fi',
  'unset _ER_UNVERIFIED _ER_SKILL',
].join('\n');

export const UPGRADE_TAIL = WORKFLOW_TAIL.replace(
  '"$_EXTEND_ROOT/bin/update-check"',
  '"$_EXTEND_ROOT/bin/update-check" --force',
);

export const INIT_TAIL = [
  'if [ -z "$_EXTEND_ROOT" ]; then',
  '  echo "ERROR: cannot locate a verified gstack-extend install. ${_ER_UNVERIFIED:-No gstack-extend skill link or .extend-root pointer under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).}"',
  '  exit 1',
  'fi',
  'if [ ! -f "$_EXTEND_ROOT/bin/gstack-extend" ] || [ ! -x "$_EXTEND_ROOT/bin/gstack-extend" ]; then',
  '  echo "ERROR: $_EXTEND_ROOT/bin/gstack-extend is missing or not executable. Fix: git -C \\"$_EXTEND_ROOT\\" checkout -- bin/gstack-extend, or re-clone gstack-extend"',
  '  exit 1',
  'fi',
  'echo "EXTEND_ROOT: $_EXTEND_ROOT"',
  "printf '_EXTEND_ROOT=%q\\n' \"$_EXTEND_ROOT\"",
  '_UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)',
  '[ -n "$_UPD" ] && echo "$_UPD" || true',
  'unset _ER_UNVERIFIED _ER_SKILL',
].join('\n');

// Skills with their own helper launcher check bin/<helper> the way init checks bin/gstack-extend.
const helperTail = (helper: string) => INIT_TAIL
  .replace('"$_EXTEND_ROOT/bin/gstack-extend" ] || [ ! -x "$_EXTEND_ROOT/bin/gstack-extend"', `"$_EXTEND_ROOT/bin/${helper}" ] || [ ! -x "$_EXTEND_ROOT/bin/${helper}"`)
  .replace('$_EXTEND_ROOT/bin/gstack-extend is missing or not executable. Fix: git -C \\"$_EXTEND_ROOT\\" checkout -- bin/gstack-extend', `$_EXTEND_ROOT/bin/${helper} is missing or not executable. Fix: git -C \\"$_EXTEND_ROOT\\" checkout -- bin/${helper}`);
export const DOCS_SHIP_TAIL = helperTail('docs-ship');

export const GUARD_LINE =
  'case "${_EXTEND_ROOT:-}" in /*) grep -qx \'# extend-root-protocol: v1\' "$_EXTEND_ROOT/bin/update-check" 2>/dev/null ;; *) false ;; esac || { echo "ERROR: no verified gstack-extend root. Re-run this skill\'s preamble, or run setup --host auto from your gstack-extend checkout" >&2; exit 1; }';

export const GUARD_COMMENT = '# Start with the _EXTEND_ROOT=… line the preamble printed.';

export const PREAMBLE_CMD_PREFIX = '~/.gstack-extend/bin/preamble';
export const PREAMBLE_GRANT = 'Bash(~/.gstack-extend/bin/preamble:*)';
// DX-13 / E4 committed spike outcome: T1 bash tilde probe passed (bash 5.3.20; zsh absent;
// claude 2.1.330, codex-cli 0.171.0; managed settings absent; no env API/OAuth credentials, so
// per E4 the headless Claude auto-mode probe moves to the owner-run required check before merge).
// Per CEO-14, skills ship the frontmatter grant unless the probe shows (b) stops while (c) does not.
export const PREAMBLE_GRANT_OUTCOME: 'frontmatter-grant' | 'user-rule' = 'frontmatter-grant';

export function expectedPreambleLine(skill: string): string {
  if (skill === 'gstack-extend-upgrade') return `${PREAMBLE_CMD_PREFIX} gstack-extend-upgrade --force`;
  if (skill === 'gstack-extend-init') return `${PREAMBLE_CMD_PREFIX} gstack-extend-init --require gstack-extend`;
  if (skill === 'docs-ship') return `${PREAMBLE_CMD_PREFIX} docs-ship --require docs-ship`;
  return `${PREAMBLE_CMD_PREFIX} ${skill}`;
}

export const NO_INSTALL_MESSAGE =
  'No gstack-extend install found under ~/.claude or ~/.codex. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).';

export const PREAMBLE_MISSING_MESSAGE =
  "PREAMBLE_MISSING: gstack-extend's start command ~/.gstack-extend/bin/preamble is missing or not executable: this install predates it, or setup has not run since the checkout was updated. Fix: in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again. See docs/installation.md#start-command.";

export const PREAMBLE_ARGS_MESSAGE =
  "PREAMBLE_ARGS: gstack-extend's start command rejected this skill's arguments, most likely because the installed command is older than this skill text. Fix: first rerun the skill's start line exactly as written; if it is rejected again, in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again. See docs/installation.md#start-command.";

export function preambleFailedMessage(skill: string): string {
  return `PREAMBLE_FAILED: gstack-extend's start command failed unexpectedly. Fix: in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again; if it fails again, report the output of bash -x ~/.gstack-extend/bin/preamble ${skill}. See docs/installation.md#start-command.`;
}

export const HANDOFF_PARAGRAPH =
  'Run the start command above exactly as written, with no `cd`, expansion, absolute path or wrapper. If the harness refuses or holds it, do not run its steps by hand: tell the user to allow the command (`docs/installation.md#start-command`) and stop (plan-track notes it once in its final message, skips Telemetry finish for this run, and continues). Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init\'s later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run the same start command with ` --root` added at the end (it prints only the root lines and runs neither update-check nor telemetry). If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `' +
  NO_INSTALL_MESSAGE +
  '` roadmap, pair-review and full-review then run Telemetry finish with `--outcome error` and stop, because their tool and session-state steps need the root. Relay any `INSTALL_WARN … reason=retired_host` line once with its Fix link in the run\'s final message before any fenced prompt, result, handoff, stage or pause line, and never inside a fence or a receipt field.';

export function preambleFailureParagraph(skill: string): string {
  return (
    'If the shell cannot run `~/.gstack-extend/bin/preamble` (exit 127 or 126), tell the user: `' +
    PREAMBLE_MISSING_MESSAGE +
    '` If the command exits 2 with stderr starting `preamble: PREAMBLE_USAGE:`, tell the user: `' +
    PREAMBLE_ARGS_MESSAGE +
    '` On any other non-zero exit (or exit 2 without that stderr prefix), relay stderr verbatim, then tell the user: `' +
    preambleFailedMessage(skill) +
    '` On any of these three start-command failures, every skill except plan-track relays the applicable message and stops without Telemetry finish; plan-track relays the message once in its final message, skips Telemetry finish for this run, and continues.'
  );
}

export const UPGRADE_NO_ROOT =
  'If no `EXTEND_ROOT:` line was printed, tell the user no verified gstack-extend install was found, and to run `./setup --host auto` from their gstack-extend checkout. Run Telemetry finish with `--outcome error`. Then stop.';

export const INIT_ERROR_STOP =
  'In this skill, an `ERROR:` line from the preamble replaces the no-install message above: relay that line verbatim and stop.';

export const RENAMES_ER_LINE =
  'ER="$_EXTEND_ROOT" bun -e "const { computeRenames, formatRenamesTable } = await import(process.env.ER + \'/src/audit/lib/renames-diff.ts\');';

// ENG-A21's command-position regex, widened to interpreter launches (`bash bin/x`, `bun run bin/x`).
export const CMD_BIN_RE =
  /(?:^|[;&|({`]|\$\(|\b(?:do|then|else|if|elif|while|until|exec|source|env|xargs|command|time|bash|sh|zsh|bun|run|node|python3?)\b|!|:|(?:^|\s)\.(?=\s)|\b[A-Za-z_][A-Za-z0-9_]*=\S*\s+)\s*["'`]?(?:\.\/)?bin\//;

export const SKILL_PATH_RE = /\.(?:claude|codex|config\/opencode|cursor)\/skills\//g;
export const SKILL_PATH_PREFIXES = ['~/', '$HOME/', '"$HOME"/', '${HOME}/', '"${HOME}"/'];

export function skillPreamble(skill: string, tail: string): string {
  return `_ER_SKILL=${skill}\n${CANONICAL_SPAN}\n${tail}`;
}

export function extractCanonicalSpan(content: string): string {
  const start = content.indexOf(SPAN_START);
  if (start < 0) throw new Error('canonical span start not found');
  const lineStart = content.lastIndexOf('\n', start) + 1;
  const end = content.indexOf(SPAN_END, lineStart);
  if (end < 0) throw new Error('canonical span end not found');
  const lineEnd = content.indexOf('\n', end);
  return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
}

export function extractFences(content: string): Array<{ lang: string; body: string }> {
  const re = /^([ \t]*)```(bash|sh|shell|zsh)\n([\s\S]*?)^\1```/gm;
  const out: Array<{ lang: string; body: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    out.push({ lang: m[2]!, body: m[3]! });
  }
  return out;
}

export function extractPreambleFence(content: string): string {
  const idx = content.indexOf('## Preamble (run first)');
  if (idx < 0) throw new Error('## Preamble (run first) heading not found');
  const fence = extractFences(content.slice(idx))[0];
  if (!fence) throw new Error('preamble fence not found');
  return fence.body.replace(/\n$/, '');
}

export function resolverProbeScript(content: string): string {
  const skillLine = content.match(/^_ER_SKILL=\S+$/m)?.[0];
  if (!skillLine) throw new Error('missing _ER_SKILL line');
  const span = extractCanonicalSpan(content);
  return `${skillLine}\n${span}\nprintf '%s\\n' "$_EXTEND_ROOT"\nprintf '%s\\n' "\${_ER_UNVERIFIED-}"\n`;
}

export function scopedEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...extra,
  };
  if (process.env.TMPDIR !== undefined && extra.TMPDIR === undefined) env.TMPDIR = process.env.TMPDIR;
  return env;
}

export function runShell(
  shell: 'bash' | 'zsh',
  args: string[],
  script: string,
  env: Record<string, string>,
  cwd?: string,
): SpawnSyncReturns<string> {
  const bin = shell === 'zsh' ? (Bun.which('zsh') ?? 'zsh') : 'bash';
  return spawnSync(bin, [...args, script], { encoding: 'utf8', env, cwd, timeout: 15_000 });
}

export function hasZsh(): boolean {
  return Boolean(Bun.which('zsh'));
}

/** bash -euc plus zsh -fc when zsh is installed. */
export function strictShells(): Array<{ shell: 'bash' | 'zsh'; args: string[] }> {
  const out: Array<{ shell: 'bash' | 'zsh'; args: string[] }> = [{ shell: 'bash', args: ['-euc'] }];
  if (hasZsh()) out.push({ shell: 'zsh', args: ['-fc'] });
  return out;
}

/** bash -c plus zsh -fc when zsh is installed (agent Bash-tool mode). */
export function agentShells(): Array<{ shell: 'bash' | 'zsh'; args: string[] }> {
  const out: Array<{ shell: 'bash' | 'zsh'; args: string[] }> = [{ shell: 'bash', args: ['-c'] }];
  if (hasZsh()) out.push({ shell: 'zsh', args: ['-fc'] });
  return out;
}

export function writeUpdateCheck(
  root: string,
  opts: { marker?: boolean; executable?: boolean; asDirectory?: boolean; record?: boolean } = {},
): void {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'update-check');
  if (opts.asDirectory) {
    mkdirSync(path, { recursive: true });
    return;
  }
  const lines = ['#!/bin/sh'];
  if (opts.record) lines.push('printf \'%s\\n\' "${GSTACK_EXTEND_DIR:-}" > "${SENTINEL:?}"');
  if (opts.marker !== false) lines.push(MARKER_LINE);
  writeFileSync(path, lines.join('\n') + '\n');
  chmodSync(path, opts.executable === false ? 0o644 : 0o755);
}

export function writePointer(home: string, host: 'claude' | 'codex' | 'opencode' | 'cursor', skill: string, value: string, newline = true): string {
  const base = hostDir(home, host, skill);
  mkdirSync(base, { recursive: true });
  const pointer = join(base, '.extend-root');
  writeFileSync(pointer, newline ? `${value}\n` : value);
  return pointer;
}

export function hostDir(home: string, host: 'claude' | 'codex' | 'opencode' | 'cursor', skill: string): string {
  if (host === 'claude') return join(home, '.claude', 'skills', skill);
  if (host === 'codex') return join(home, '.codex', 'skills', skill);
  if (host === 'cursor') return join(home, '.cursor', 'skills', skill);
  return join(home, '.config', 'opencode', 'skills', skill);
}
