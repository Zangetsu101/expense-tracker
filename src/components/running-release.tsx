import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TurboModuleRegistry,
  useWindowDimensions,
  View,
} from 'react-native';
import { AppSheet } from '@/components/app-sheet';
import { FormButton } from '@/components/form-controls';
import { releaseCommit } from '@/generated/release';
import { releaseIdentity } from '@/lib/release-identity';
import type { TurboModule } from 'react-native';
import { theme } from '@/theme';

interface NativeClipboard extends TurboModule {
  setString: (text: string) => void;
}

export function RunningRelease() {
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const release = releaseIdentity({
    version: Constants.expoConfig?.version ?? null,
    commit: releaseCommit,
    platform: Platform.OS,
    development: __DEV__,
    expoGo: Constants.executionEnvironment === 'storeClient',
    isEnabled: Updates.isEnabled,
    updateId: Updates.updateId,
    createdAt: Updates.createdAt,
    runtimeVersion: Updates.runtimeVersion,
    channel: Updates.channel,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: Updates.emergencyLaunchReason,
  });
  const dismiss = () => {
    setOpen(false);
    setCopyStatus(null);
  };
  const copyDetails = () => {
    const clipboard =
      Platform.OS === 'web' ? null : TurboModuleRegistry.get<NativeClipboard>('Clipboard');
    try {
      if (clipboard) {
        clipboard.setString(release.details);
        setCopyStatus('Details copied.');
        return;
      }
    } catch {
      // Keep system text selection available if this runtime cannot copy directly.
    }
    setCopyStatus(
      'Touch and hold the details, then choose Select all and Copy from the system menu. On web, select the text and copy.',
    );
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={release.summary}
        onPress={() => setOpen(true)}
        style={{ minHeight: theme.controlHeight, justifyContent: 'center' }}
      >
        <Text style={{ color: theme.colors.muted, textAlign: 'center', fontSize: 14 }}>
          {release.summary}
        </Text>
      </Pressable>
      {open && (
        <AppSheet pending={false} onDismiss={dismiss}>
          <ScrollView
            contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.md }}
            style={{ width, maxHeight: height * 0.85, backgroundColor: theme.colors.surface }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: theme.colors.text, fontSize: theme.type.body, fontWeight: '700' }}
            >
              Running release
            </Text>
            {copyStatus && (
              <Text accessibilityRole="alert" style={{ color: theme.colors.muted }}>
                {copyStatus}
              </Text>
            )}
            <Text
              selectable
              style={{
                alignSelf: 'stretch',
                marginHorizontal: -theme.spacing.xl,
                paddingHorizontal: theme.spacing.xl,
                backgroundColor: theme.colors.surface,
                color: theme.colors.text,
                fontSize: 14,
              }}
            >
              {release.details}
            </Text>
            <View style={{ gap: theme.spacing.sm }}>
              <FormButton label="Copy details" variant="secondary" onPress={copyDetails} />
              <FormButton label="Close" variant="secondary" onPress={dismiss} />
            </View>
          </ScrollView>
        </AppSheet>
      )}
    </>
  );
}
