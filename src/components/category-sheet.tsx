import type { ReactElement } from 'react';
import { Modal, Pressable, View } from 'react-native';

export type CategorySheetProps = { children: ReactElement; pending: boolean; onDismiss: () => void };

export function CategorySheet({ children, pending, onDismiss }: CategorySheetProps) {
  return <Modal transparent animationType="slide" onRequestClose={() => { if (!pending) onDismiss(); }}>
    <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss category form" disabled={pending} onPress={onDismiss} style={{ flex: 1 }} />
      {children}
    </View>
  </Modal>;
}
