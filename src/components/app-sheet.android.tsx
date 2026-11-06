import { Host, RNHostView } from '@expo/ui';
import { ModalBottomSheet } from '@expo/ui/jetpack-compose';
import type { AppSheetProps } from './app-sheet';
import { theme } from '../theme';

export function AppSheet({ children, pending, onDismiss }: AppSheetProps) {
  return (
    <Host style={{ position: 'absolute' }} pointerEvents="none">
      <ModalBottomSheet
        onDismissRequest={onDismiss}
        skipPartiallyExpanded
        sheetGesturesEnabled={!pending}
        properties={{ shouldDismissOnBackPress: !pending, shouldDismissOnClickOutside: !pending }}
        containerColor={theme.colors.surface}
      >
        <RNHostView matchContents>{children}</RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
