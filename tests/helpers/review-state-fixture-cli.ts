import { main } from '../../src/review-state/cli.ts';

export const reviewStateFixtureCliPath = import.meta.path;

// Exercise the production CLI without making protocol tests depend on VERSION.
if (import.meta.main) {
  const [versionPath, ...args] = process.argv.slice(2);
  if (!versionPath) throw new Error('A fixture version path is required');
  process.exitCode = main(args, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    versionPath,
  });
}
