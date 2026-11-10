import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { theme } from '@/theme';

/** The x and y of each point, with a 5 px margin above and below the line. */
export function chartPoints(values: number[], width: number, height: number) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * width,
    y: height - 5 - (high === low ? 0.5 : (value - low) / (high - low)) * (height - 10),
  }));
}

/** The index of the point nearest to a touch at `x`. */
export function pointAt(x: number, width: number, count: number) {
  return Math.round(Math.min(1, Math.max(0, x / width)) * (count - 1));
}

/**
 * A balance line. Press and hold, then drag, to read a day. The long press lets a swipe that starts on
 * the chart still move the deck.
 */
export function TrendChart({
  values,
  width,
  height,
  rising,
  label,
  onScrub,
}: {
  values: number[];
  width: number;
  height: number;
  rising: boolean;
  label: string;
  onScrub: (index: number | null) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const points = chartPoints(values, width, height);
  const path = points
    .map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join('');
  const color = rising ? theme.colors.accent : theme.colors.warning;
  const scrub = (x: number | null) => {
    const index = x === null ? null : pointAt(x, width, values.length);
    setActive(index);
    onScrub(index);
  };
  const gesture = Gesture.Pan()
    .activateAfterLongPress(200)
    .runOnJS(true)
    .onStart((event) => scrub(event.x))
    .onUpdate((event) => scrub(event.x))
    .onFinalize(() => scrub(null));
  const marker = points[active ?? points.length - 1];
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        accessibilityHint="Press and hold, then drag, to read the balance on a day"
        style={{ width, height }}
      >
        <Svg width={width} height={height}>
          <Path d={`${path}L${width},${height}L0,${height}Z`} fill="rgba(139,224,190,0.10)" />
          <Path d={path} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
          {active !== null && (
            <Line
              x1={marker.x}
              x2={marker.x}
              y1={0}
              y2={height}
              stroke={theme.colors.text}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          <Circle
            cx={marker.x}
            cy={marker.y}
            r={active === null ? 4 : 5}
            fill={theme.colors.text}
          />
        </Svg>
      </View>
    </GestureDetector>
  );
}
