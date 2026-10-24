import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { interactiveDismissDisabled } from '@expo/ui/swift-ui/modifiers';
import type { AppSheetProps } from './app-sheet';
import { theme } from '../theme';

export function AppSheet({ children, pending, onDismiss }: AppSheetProps) {
  return <Host><BottomSheet isPresented onDismiss={onDismiss} containerColor={theme.colors.surface}
    contentPadding={0} modifiers={[interactiveDismissDisabled(pending)]}>
    <RNHostView matchContents>{children}</RNHostView>
  </BottomSheet></Host>;
}
