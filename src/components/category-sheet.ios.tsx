import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { interactiveDismissDisabled } from '@expo/ui/swift-ui/modifiers';
import type { CategorySheetProps } from './category-sheet';
import { theme } from '../theme';

export function CategorySheet({ children, pending, onDismiss }: CategorySheetProps) {
  return <Host><BottomSheet isPresented onDismiss={onDismiss} containerColor={theme.colors.surface}
    contentPadding={0} modifiers={[interactiveDismissDisabled(pending)]}>
    <RNHostView matchContents>{children}</RNHostView>
  </BottomSheet></Host>;
}
