export function backupFailureKind(message: string): 'folder' | 'storage' | 'save' | 'retention' {
  if (message.startsWith('Backup saved, but')) return 'retention';
  if (/ENOSPC|no space left|not enough space|disk full/i.test(message)) return 'storage';
  if (
    /EACCES|EPERM|ENOENT|permission|access.*(?:lost|denied)|securityexception|not writable|isn't (?:writable|readable)|filenotfound|(?:folder|directory|document).*(?:not found|does not exist)/i.test(
      message,
    )
  )
    return 'folder';
  return 'save';
}

export function backupFolderName(uri: string): string {
  const path = decodeURIComponent(uri.split('/tree/')[1] ?? uri);
  return (
    path
      .split('/')
      .filter(Boolean)
      .at(-1)
      ?.replace(/^[^:]+:/, '') || path
  );
}

export function backupTime(timestamp: number | null, now = new Date()): string {
  if (timestamp === null) return 'Never';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString()} at ${time}`;
}
