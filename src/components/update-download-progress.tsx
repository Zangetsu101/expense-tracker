import { View } from 'react-native';
import { theme } from '@/theme';

export function UpdateDownloadProgress({ progress, size }: { progress: number; size: number }) {
  const half = size / 2;
  const inset = 2;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Downloading update"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      style={{ width: size, height: size, borderRadius: half, backgroundColor: theme.colors.line }}
    >
      {progress > 0 && (
        <View
          style={{
            position: 'absolute',
            left: half,
            width: half,
            height: size,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: half,
              height: size,
              borderTopRightRadius: half,
              borderBottomRightRadius: half,
              backgroundColor: theme.colors.accent,
              transformOrigin: 'left center',
              transform: [{ rotate: `${Math.min(progress * 360, 180) - 180}deg` }],
            }}
          />
        </View>
      )}
      {progress > 0.5 && (
        <View style={{ position: 'absolute', width: half, height: size, overflow: 'hidden' }}>
          <View
            style={{
              width: half,
              height: size,
              borderTopLeftRadius: half,
              borderBottomLeftRadius: half,
              backgroundColor: theme.colors.accent,
              transformOrigin: 'right center',
              transform: [{ rotate: `${progress * 360 - 360}deg` }],
            }}
          />
        </View>
      )}
      <View
        style={{
          position: 'absolute',
          top: inset,
          left: inset,
          width: size - inset * 2,
          height: size - inset * 2,
          borderRadius: half - inset,
          backgroundColor: theme.colors.surface,
        }}
      />
    </View>
  );
}
