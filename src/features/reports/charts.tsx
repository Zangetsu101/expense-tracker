import { View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '@/theme';

const c = theme.colors;
export type ChartLine = { values: number[]; color: string; dashed?: boolean; thin?: boolean };

const path = (points: { x: number; y: number }[]) =>
  points.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/**
 * Lines on one scale. Each line has one value for each slot from the left, so a line can stop
 * before the right end. `band` is a shaded area between two lines.
 */
export function LineChart({
  width,
  height,
  slots,
  lines,
  band,
  zeroBased = false,
  axis,
  labels,
  accessibilityLabel,
}: {
  width: number;
  height: number;
  slots: number;
  lines: ChartLine[];
  band?: { low: number[]; high: number[] };
  zeroBased?: boolean;
  /** Text for the lowest, middle and highest grid lines. */
  axis?: (value: number) => string;
  /** Text under the left end and the right end. */
  labels?: [string, string];
  accessibilityLabel: string;
}) {
  const left = axis ? 40 : 0;
  const bottom = labels ? 18 : 0;
  const all = [
    ...lines.flatMap((line) => line.values),
    ...(band ? [...band.low, ...band.high] : []),
  ];
  const low = zeroBased ? 0 : Math.min(...all);
  const high = Math.max(...all, low + 1);
  const x = (index: number) => left + (index / Math.max(1, slots - 1)) * (width - left - 2);
  const y = (value: number) => 4 + (1 - (value - low) / (high - low)) * (height - bottom - 8);
  const at = (values: number[]) => values.map((value, index) => ({ x: x(index), y: y(value) }));
  const area =
    band &&
    `${path(at(band.high))}${at(band.low)
      .reverse()
      .map(({ x: px, y: py }) => `L${px.toFixed(1)},${py.toFixed(1)}`)
      .join('')}Z`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={width} height={height}>
        {axis &&
          [low, (low + high) / 2, high].map((value) => (
            <G key={value}>
              <Line x1={left} x2={width} y1={y(value)} y2={y(value)} stroke={c.line} />
              <SvgText x={0} y={y(value) + 4} fill={c.muted} fontSize={11}>
                {axis(value)}
              </SvgText>
            </G>
          ))}
        {area && <Path d={area} fill={c.muted} opacity={0.22} />}
        {lines.map((line, index) => (
          <Path
            key={index}
            d={path(at(line.values))}
            fill="none"
            stroke={line.color}
            strokeWidth={line.thin ? 1.5 : 2.5}
            strokeDasharray={line.dashed ? '4 4' : undefined}
            strokeLinejoin="round"
          />
        ))}
        {labels && (
          <>
            <SvgText x={left} y={height - 2} fill={c.muted} fontSize={11}>
              {labels[0]}
            </SvgText>
            <SvgText x={width - 2} y={height - 2} fill={c.muted} fontSize={11} textAnchor="end">
              {labels[1]}
            </SvgText>
          </>
        )}
      </Svg>
    </View>
  );
}

/** Horizontal bars that grow right for an increase and left for a decrease, from a center line. */
export function ChangeBars({
  changes,
  width,
  height,
}: {
  changes: number[];
  width: number;
  height: number;
}) {
  const largest = Math.max(1, ...changes.map(Math.abs));
  const middle = width / 2;
  const row = height / Math.max(1, changes.length);
  return (
    <Svg width={width} height={height}>
      <Line x1={middle} x2={middle} y1={0} y2={height} stroke={c.muted} />
      {changes.map((change, index) => {
        const size = (Math.abs(change) / largest) * (middle - 4);
        return (
          <Rect
            key={index}
            x={change >= 0 ? middle : middle - size}
            y={index * row + row * 0.2}
            width={size}
            height={row * 0.6}
            rx={3}
            fill={change >= 0 ? c.warning : c.accent}
          />
        );
      })}
    </Svg>
  );
}

/** Marks for the full periods that usual still needs. */
export function ProgressMarks({ done, total }: { done: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 1.5,
            borderColor: index < done ? c.accent : c.line,
            backgroundColor: index < done ? c.accent : 'transparent',
          }}
        />
      ))}
    </View>
  );
}
