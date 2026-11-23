export type RunningRelease = {
  version: string | null;
  commit: string | null;
  platform: string;
  development: boolean;
  expoGo: boolean;
  isEnabled: boolean;
  updateId: string | null;
  createdAt: Date | null;
  runtimeVersion: string | null;
  channel: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
};

type ReleaseSource = 'Web' | 'Development' | 'Embedded' | 'OTA update' | 'Updates disabled';

function releaseSource(release: RunningRelease): ReleaseSource {
  if (release.platform === 'web') return 'Web';
  if (release.development || release.expoGo) return 'Development';
  if (!release.isEnabled) return 'Updates disabled';
  return release.isEmbeddedLaunch ? 'Embedded' : 'OTA update';
}

function releaseLabel(source: ReleaseSource, commit: string | null, updateId: string | null) {
  if (source === 'Web' || source === 'Development') return source;
  if (commit) return `Release ${commit.slice(0, 7)}`;
  if (source === 'OTA update' && updateId) return `Update ${updateId.slice(0, 8)}`;
  return source;
}

export function releaseIdentity(release: RunningRelease) {
  const source = releaseSource(release);
  const commit = release.commit && /^[a-f0-9]{40}$/i.test(release.commit) ? release.commit : null;
  const label = releaseLabel(source, commit, release.updateId);
  return {
    summary: `Version ${release.version ?? 'unknown'} · ${label}`,
    details: [
      `Version: ${release.version ?? 'Unknown'}`,
      `Running JavaScript: ${source}`,
      `Commit: ${commit ?? 'Unknown (not stamped by CI)'}`,
      `Platform: ${release.platform}`,
      `Update ID: ${release.updateId ?? 'Unavailable'}`,
      `Created at: ${release.createdAt?.toISOString() ?? 'Unavailable'}`,
      `Runtime version: ${release.runtimeVersion ?? 'Unavailable'}`,
      `Channel: ${release.channel ?? 'Unavailable'}`,
      `Embedded launch: ${release.isEmbeddedLaunch}`,
      `Emergency launch: ${release.isEmergencyLaunch}`,
      `Emergency reason: ${release.emergencyLaunchReason ?? 'None'}`,
    ].join('\n'),
  };
}
