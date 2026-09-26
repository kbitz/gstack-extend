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
  const cleaned = stripRemoteUrl(raw).replace(/\.git$/i, '').replace(/\/$/, '');
  let host = '';
  let path = '';
  const ssh = /^ssh:\/\/([^/]+)\/(.+)$/.exec(cleaned);
  const url = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)\/(.+)$/i.exec(cleaned);
  const scp = /^[^@\s]+@([^:]+):(.+)$/.exec(cleaned);
  if (ssh) {
    host = ssh[1] ?? '';
    path = ssh[2] ?? '';
  } else if (url) {
    host = url[1] ?? '';
    path = url[2] ?? '';
  } else if (scp) {
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  } else {
    return null;
  }
  const parts = path.split('/').filter(p => p !== '');
  if (parts.length < 2) return null;
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
  const pull = parts.indexOf('pull');
  if (pull < 2 || parts.length < pull + 2) return null;
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
