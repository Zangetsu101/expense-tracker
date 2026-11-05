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

export function releaseIdentity(release: RunningRelease) {
  const source = release.platform === 'web' ? 'Web' : release.development || release.expoGo ? 'Development' :
    release.isEnabled ? release.isEmbeddedLaunch ? 'Embedded' : 'OTA update' : 'Updates disabled';
  const commit = release.commit && /^[a-f0-9]{40}$/i.test(release.commit) ? release.commit : null;
  const label = source === 'Web' || source === 'Development' ? source :
    commit ? `Release ${commit.slice(0, 7)}` : source === 'OTA update' && release.updateId ? `Update ${release.updateId.slice(0, 8)}` : source;
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
