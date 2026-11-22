import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { PeopleField, PersonField } from '../components/PersonField';
import { SheetModal } from '../components/SheetModal';
import type { Person } from '../people/logic';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { createDirect, createGroup, lookupHandle, startChatErrorKey } from './api';
import { qk } from './keys';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

/** Nouvelle conversation : direct (un @handle) ou groupe (titre + @handles). */
export function NewConversationSheet({ visible, onClose, onCreated }: Props) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [person, setPerson] = useState<Person | null>(null);
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  function explain(err: unknown): string {
    const key = startChatErrorKey(err);
    return key ? t(key) : errorMessage(err, t, locale);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      let conversationId: string;
      if (mode === 'direct') {
        if (!person) return setError(t('field.required'));
        conversationId = (await createDirect(person.id ?? (await lookupHandle(person.handle)).id)).id;
      } else {
        if (!title.trim()) return setError(t('field.required'));
        const ids = await Promise.all(members.map(async (m) => m.id ?? (await lookupHandle(m.handle)).id));
        conversationId = (await createGroup(title.trim(), ids)).id;
      }
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
      setPerson(null);
      setTitle('');
      setMembers([]);
      onClose();
      onCreated(conversationId);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} onClose={close}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <Text variant="heading" accessibilityRole="header" style={styles.gap}>
          {t('chat.new.title')}
        </Text>
        <View style={[styles.row, styles.gap]}>
          <Button
            label={t('chat.new.direct')}
            variant={mode === 'direct' ? 'primary' : 'secondary'}
            onPress={() => setMode('direct')}
            style={styles.flex}
          />
          <Button
            label={t('chat.new.group')}
            variant={mode === 'group' ? 'primary' : 'secondary'}
            onPress={() => setMode('group')}
            style={styles.flex}
          />
        </View>
        {mode === 'direct' ? (
          <PersonField label={t('chat.new.handle')} value={person} onChange={setPerson} />
        ) : (
          <>
            <TextField label={t('chat.new.groupTitle')} value={title} onChangeText={setTitle} maxLength={100} />
            <PeopleField label={t('chat.new.groupHandles')} value={members} onChange={setMembers} />
          </>
        )}
        {error ? (
          <Text color={colors.danger} variant="small" accessibilityLiveRegion="polite" style={styles.gap}>
            {error}
          </Text>
        ) : null}
        <Button label={mode === 'direct' ? t('chat.new.start') : t('chat.new.create')} onPress={submit} loading={busy} />
        <Button label={t('common.cancel')} variant="ghost" onPress={close} style={{ marginTop: spacing.sm }} />
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  gap: { marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1, paddingHorizontal: spacing.sm },
});
