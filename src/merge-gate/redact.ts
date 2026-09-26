/** Strip credentials from git/gh text before it reaches an error or a debug line. */
export function redact(text: string): string {
  return text
    .replace(/\b((?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+)/g, '[REDACTED]')
    .replace(/Authorization:[^\r\n]*/gi, 'Authorization: [REDACTED]')
    .replace(/(\/\/)[^/\s@]+@/g, '$1');
}

export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find(l => l.trim() !== '') ?? '';
  return redact(line).trim();
}

/**
 * Drop userinfo, query, and fragment. scp-style `git@host:path` is unchanged.
 * A `file://` or local-path remote keeps only its last path segment, so
 * evidence never stores an absolute local path (ENG-11).
 */
export function stripRemoteUrl(raw: string): string {
  // Git remote-helper syntax `<transport>::<address>`: strip the address too.
  const helper = /^([A-Za-z0-9][A-Za-z0-9+.-]*)::(.*)$/s.exec(raw);
  if (helper) return `${helper[1]}::${stripRemoteUrl(helper[2] ?? '')}`;
  if (/^file:/i.test(raw) || /^(?:\/|\.\.?(?:\/|$)|~)/.test(raw)) {
    const last = raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    return `local:${last}`;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      u.username = '';
      u.password = '';
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1').replace(/[?#].*$/, '');
    }
  }
  return raw;
}

export type RepoIdentity = { host: string; owner: string; name: string };

export function parseRemote(raw: string): RepoIdentity | null {
  const cleaned = stripRemoteUrl(raw);
  let host = '';
  let path = '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      // An SSH port selects the Git transport, not the GitHub API host.
      // Preserve HTTP(S) ports rather than silently redirecting API traffic.
      host = url.protocol === 'ssh:' ? url.hostname : url.host;
      path = url.pathname;
    } catch {
      return null;
    }
  } else {
    // Git's scp-like syntax makes the user optional, including SSH aliases.
    const scp = /^(?:[^@\s/:]+@)?([^:\s/]+):(.+)$/.exec(cleaned);
    if (!scp) return null;
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = path.split('/').filter(p => p !== '');
  if (host === '' || parts.length < 2) return null;
  const name = parts[parts.length - 1] ?? '';
  const owner = parts[parts.length - 2] ?? '';
  if (owner === '' || name === '') return null;
  return { host, owner, name };
}

export function parsePrUrl(rawUrl: string): (RepoIdentity & { number: number }) | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(p => p !== '');
  // Always `/owner/repo/pull/N`; an owner or repository may itself be named `pull`.
  const pull = 2;
  if (parts[pull] !== 'pull' || parts.length < pull + 2) return null;
  const num = Number(parts[pull + 1]);
  if (!Number.isInteger(num)) return null;
  const name = (parts[pull - 1] ?? '').replace(/\.git$/i, '');
  const owner = parts[pull - 2] ?? '';
  if (owner === '' || name === '') return null;
  return { host: u.hostname, owner, name, number: num };
}

/** Compare owner/name always. Compare hosts only when both are dotted hostnames. */
export function identityMatches(remote: RepoIdentity, pr: RepoIdentity): boolean {
  if (remote.owner.toLowerCase() !== pr.owner.toLowerCase()) return false;
  if (remote.name.toLowerCase() !== pr.name.toLowerCase()) return false;
  const remoteDotted = remote.host.includes('.');
  const prDotted = pr.host.includes('.');
  if (remoteDotted && prDotted && remote.host.toLowerCase() !== pr.host.toLowerCase()) return false;
  return true;
}

/** `-R` spec: owner/repo for github.com and dotless SSH aliases; otherwise host/owner/repo. */
export function repoSpecFromRemote(id: RepoIdentity): string {
  if (id.host.toLowerCase() === 'github.com' || !id.host.includes('.')) {
    return `${id.owner}/${id.name}`;
  }
  return `${id.host}/${id.owner}/${id.name}`;
}

export function repoSpecFromUrl(id: RepoIdentity): string {
  return `${id.host}/${id.owner}/${id.name}`;
}
