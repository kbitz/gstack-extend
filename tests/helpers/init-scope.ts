/**
 * init-scope.ts — isolated HOME, extension state, and gstack state for init tests.
 * The target directory is left absent. Suites own afterAll cleanup.
 * Never mutates the parent process environment.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type InitScope = {
  home: string;
  state: string;
  groot: string;
  target: string;
};

export function mkScope(baseTmp: string, name: string): InitScope {
  const root = join(baseTmp, name);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const groot = join(root, 'gstack');
  const target = join(root, 'target');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(groot, { recursive: true });
  return { home, state, groot, target };
}
