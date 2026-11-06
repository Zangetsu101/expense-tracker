// Categories' selected shared-root treatment. Keep the palette together for reuse.
export const theme = {
  colors: {
    background: '#101820',
    surface: '#1d2a34',
    root: '#15212a',
    raised: '#263641',
    line: '#35434d',
    text: '#f1f5f4',
    muted: '#b1c0c7',
    accent: '#8be0be',
    selected: '#52766c',
    onSelected: '#f2f4f0',
    warning: '#f4c998',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, indent: 24 },
  radius: { group: 10, control: 12, elbow: 6 },
  type: { body: 16, caption: 12, heading: 18 },
  controlHeight: 48,
} as const;
