import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { glass, onMedia } from '../../theme/tokens';
import { Avatar, Text } from '../../ui';
import type { LiveComment } from './types';

/** Commentaires en bulles translucides, en bas à gauche. */
export function LiveChatOverlay({ comments }: { comments: LiveComment[] }) {
  return (
    <View style={styles.col} pointerEvents="none">
      {comments.map((c) => (
        <View key={c.id} style={styles.bubble} accessible accessibilityLabel={`${c.user} : ${c.text}`}>
          <Avatar name={c.user} size={28} />
          <View style={styles.flex}>
            <Text variant="caption" color={onMedia}>
              <Text variant="caption" color="#C9C6FF">
                {c.user}
                {'  '}
              </Text>
              {c.text}
            </Text>
            {c.replyTo ? (
              <View style={styles.reply}>
                <Ionicons name="return-down-forward" size={12} color={onMedia} />
                <Text variant="caption" color={onMedia}>
                  {c.replyTo}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 8, alignItems: 'flex-start' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
  flex: { flexShrink: 1 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
});
