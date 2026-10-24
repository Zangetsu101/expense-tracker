import { Host, RNHostView } from '@expo/ui';
import { ModalBottomSheet } from '@expo/ui/jetpack-compose';
import type { CategorySheetProps } from './category-sheet';
import { theme } from '../theme';

export function CategorySheet({ children, pending, onDismiss }: CategorySheetProps) {
  return <Host style={{ position: 'absolute' }} pointerEvents="none">
    <ModalBottomSheet onDismissRequest={onDismiss} skipPartiallyExpanded sheetGesturesEnabled={!pending}
      properties={{ shouldDismissOnBackPress: !pending, shouldDismissOnClickOutside: !pending }}
      containerColor={theme.colors.surface}>
      <RNHostView matchContents>{children}</RNHostView>
    </ModalBottomSheet>
  </Host>;
}
