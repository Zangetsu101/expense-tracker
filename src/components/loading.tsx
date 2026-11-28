import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue } from 'react-native';
import { theme } from '@/theme';

export function Shimmer() {
  const [progress] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (reduceMotion || !width) return;
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, width]);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {!reduceMotion && width > 0 && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width,
            experimental_backgroundImage:
              'linear-gradient(100deg, transparent, rgba(139,224,190,0.12), transparent)',
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-width, width],
                }),
              },
            ],
          }}
        />
      )}
    </View>
  );
}

export function Skeleton({
  width = '65%',
  height = 14,
  animated = true,
  borderRadius = 5,
}: {
  width?: DimensionValue;
  height?: number;
  animated?: boolean;
  borderRadius?: number;
}) {
  return (
    <View
      accessible={false}
      style={{
        width,
        height,
        borderRadius,
        overflow: 'hidden',
        backgroundColor: theme.colors.raised,
      }}
    >
      {animated && <Shimmer />}
    </View>
  );
}
