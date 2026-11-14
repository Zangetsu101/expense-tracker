import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export function useClippedChips(maxHeight: number) {
  const [clippedIds, setClippedIds] = useState<Set<number>>(() => new Set());
  return {
    clippedIds,
    onLayout: (id: number) => (event: LayoutChangeEvent) => {
      const hidden = event.nativeEvent.layout.y >= maxHeight;
      setClippedIds((old) => {
        if (old.has(id) === hidden) return old;
        const next = new Set(old);
        if (hidden) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    accessibilityProps: (id: number, disabled: boolean) => ({
      accessibilityElementsHidden: clippedIds.has(id),
      importantForAccessibility: clippedIds.has(id)
        ? ('no-hide-descendants' as const)
        : ('auto' as const),
      disabled: disabled || clippedIds.has(id),
    }),
  };
}
