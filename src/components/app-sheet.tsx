import type { ReactElement } from 'react';
import { Modal, Pressable, View } from 'react-native';

export type AppSheetProps = { children: ReactElement; pending: boolean; onDismiss: () => void };

export function AppSheet({ children, pending, onDismiss }: AppSheetProps) {
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!pending) onDismiss();
      }}
    >
      <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          disabled={pending}
          onPress={onDismiss}
          style={{ flex: 1 }}
        />
        {children}
      </View>
    </Modal>
  );
}
