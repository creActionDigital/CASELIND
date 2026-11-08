import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useI18n } from '../../i18n';
import { brandColor, fonts, glass, onMedia, TOUCH } from '../../theme/tokens';

interface Props {
  onSend: (text: string) => void;
  onClose: () => void;
  onLike?: () => void;
  onGift?: () => void;
}

type RoundIcon = 'send' | 'heart-outline' | 'gift-outline' | 'close';

const noop = () => {};

/** Barre de message : champ, cœur, cadeau et fermer. */
export function LiveComposer({ onSend, onClose, onLike, onGift }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const has = text.trim().length > 0;
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText('');
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        returnKeyType="send"
        placeholder={t('live.messagePlaceholder')}
        placeholderTextColor="rgba(255,255,255,0.8)"
        accessibilityLabel={t('live.messagePlaceholder')}
        style={styles.input}
        maxLength={200}
      />
      <Round icon={has ? 'send' : 'heart-outline'} label={has ? t('live.send') : t('live.like')} onPress={has ? send : (onLike ?? noop)} />
      <Round icon="gift-outline" label={t('live.gift')} onPress={onGift ?? noop} />
      <Round icon="close" label={t('live.close')} onPress={onClose} solid />
    </View>
  );
}

function Round({ icon, label, onPress, solid }: { icon: RoundIcon; label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.round, solid && { backgroundColor: brandColor }, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={onMedia} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minHeight: TOUCH,
    paddingHorizontal: 18,
    borderRadius: 999,
    color: onMedia,
    fontFamily: fonts.regular,
    fontSize: 14,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
  round: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
