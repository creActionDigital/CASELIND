import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { manualPerson, type Person } from '../people/logic';
import { usePeople } from '../people/usePeople';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Button, Text } from '../ui';
import { FadeInView, PressableScale, Skeleton } from '../ui/premium';

export type { Person } from '../people/logic';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Sélection simple : appelé avec la personne touchée. */
  onPick?: (p: Person) => void;
  /** Sélection multiple (groupes) : `onPickMany` reçoit la liste à la validation. */
  multiple?: boolean;
  onPickMany?: (list: Person[]) => void;
  initial?: Person[];
  max?: number;
  /** Pseudos à ne pas proposer (déjà membres, déjà choisis…). */
  exclude?: string[];
  title?: string;
}

type Row =
  | { k: 'head'; id: string; label: string }
  | { k: 'person'; id: string; p: Person }
  | { k: 'note'; id: string; text: string; action?: { label: string; onPress: () => void } }
  | { k: 'skeleton'; id: string };

/** Sélecteur de personnes plein écran : récents, contacts du téléphone sur CASELIND, abonnements, abonnés, recherche. */
export function PersonPicker({ visible, onClose, onPick, multiple, onPickMany, initial, max = 50, exclude, title }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Person[]>(initial ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const people = usePeople(query, visible);
  useEffect(() => {
    if (visible) setChosen(initial ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // Le web démonte la modale fermée (voir SheetModal : portail orphelin).
  if (Platform.OS === 'web' && !visible) return null;

  const hidden = new Set((exclude ?? []).map((h) => h.toLowerCase()));
  const isChosen = (p: Person) => chosen.some((c) => c.handle.toLowerCase() === p.handle.toLowerCase());
  const s = people.sections;
  const keep = (l: Person[]) => l.filter((p) => !hidden.has(p.handle.toLowerCase()));

  function close() {
    setQuery('');
    setNotice(null);
    onClose();
  }
  function press(p: Person) {
    if (!multiple) {
      setQuery('');
      onPick?.(p);
      return;
    }
    if (isChosen(p)) return setChosen(chosen.filter((c) => c.handle.toLowerCase() !== p.handle.toLowerCase()));
    if (chosen.length >= max) return setNotice(t('pp.max', { max }));
    setNotice(null);
    setChosen([...chosen, p]);
  }

  const rows: Row[] = [];
  const add = (id: string, label: string, list: Person[]) => {
    const l = keep(list);
    if (l.length === 0) return;
    rows.push({ k: 'head', id: `h-${id}`, label });
    l.forEach((p) => rows.push({ k: 'person', id: `${id}-${p.handle}`, p }));
  };
  const typing = query.trim().length > 0;
  if (!typing && people.loading) for (let i = 0; i < 6; i++) rows.push({ k: 'skeleton', id: `sk${i}` });
  add('recent', t('pp.recent'), s.recent);
  // Carte « contacts du téléphone » : explication, refus ou résultat.
  if (people.access === 'unsupported') rows.push({ k: 'note', id: 'web', text: t('pp.contacts.web') });
  else if (people.access === 'unknown') rows.push({ k: 'note', id: 'ask', text: `${t('pp.contacts.title')}. ${t('pp.contacts.body')}`, action: { label: t('pp.contacts.allow'), onPress: () => void people.askContacts() } });
  else if (people.access === 'denied') rows.push({ k: 'note', id: 'denied', text: t('pp.contacts.denied') });
  else if (people.phoneLoading && s.phone.length === 0) rows.push({ k: 'note', id: 'ploading', text: t('pp.contacts.loading') });
  add('phone', t('pp.phone'), s.phone);
  if (people.access === 'granted' && !people.phoneLoading && s.phone.length === 0 && !typing) rows.push({ k: 'note', id: 'pnone', text: t('pp.contacts.none') });
  add('following', t('pp.following'), s.following);
  add('followers', t('pp.followers'), s.followers);
  add('search', t('pp.results'), s.search);
  if (people.searching) rows.push({ k: 'note', id: 'searching', text: t('pp.searching') });
  const manual = typing ? manualPerson(query) : null;
  const anyPerson = rows.some((r) => r.k === 'person');
  if (manual && !hidden.has(manual.handle) && !rows.some((r) => r.k === 'person' && r.p.handle.toLowerCase() === manual.handle) && !people.searching) {
    rows.push({ k: 'head', id: 'h-manual', label: t('pp.manualHint') });
    rows.push({ k: 'person', id: 'manual', p: manual });
  }
  if (typing && !anyPerson && !manual && !people.searching) rows.push({ k: 'note', id: 'empty', text: t('pp.empty') });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} hitSlop={8} style={styles.close}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text variant="heading" accessibilityRole="header" numberOfLines={1} style={styles.flex}>
            {title ?? (multiple ? t('pp.titleMany') : t('pp.title'))}
          </Text>
        </View>
        <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('pp.search')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('pp.search')}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        {multiple && chosen.length > 0 ? (
          <View style={styles.chosen} accessibilityLabel={t('pp.selected', { count: chosen.length })}>
            {chosen.map((p) => (
              <PressableScale key={p.handle} accessibilityLabel={t('pp.remove', { name: p.displayName })} onPress={() => press(p)} style={[styles.pill, { backgroundColor: colors.primarySoft }]}>
                <Avatar name={p.displayName} size={22} contentUrl={p.avatarUrl} />
                <Text variant="small" numberOfLines={1} style={{ maxWidth: 110 }}>
                  {p.displayName}
                </Text>
                <Ionicons name="close" size={14} color={colors.textMuted} />
              </PressableScale>
            ))}
          </View>
        ) : null}
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + (multiple ? 120 : spacing.xl) }}
          renderItem={({ item, index }) => {
            if (item.k === 'skeleton') return <Skeleton height={56} style={{ marginHorizontal: spacing.lg, marginBottom: spacing.sm }} />;
            if (item.k === 'head')
              return (
                <Text variant="caption" muted accessibilityRole="header" style={styles.head}>
                  {item.label.toUpperCase()}
                </Text>
              );
            if (item.k === 'note')
              return (
                <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text variant="small" muted>
                    {item.text}
                  </Text>
                  {item.action ? <Button label={item.action.label} onPress={item.action.onPress} style={{ marginTop: spacing.md }} /> : null}
                </View>
              );
            const sel = multiple && isChosen(item.p);
            return (
              <FadeInView index={Math.min(index, 8)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.p.displayName}, @${item.p.handle}`}
                  accessibilityState={{ selected: !!sel }}
                  onPress={() => press(item.p)}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
                >
                  <Avatar name={item.p.displayName} size={44} contentUrl={item.p.avatarUrl} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {item.p.displayName}
                    </Text>
                    <Text variant="small" muted numberOfLines={1}>
                      @{item.p.handle}
                    </Text>
                  </View>
                  {multiple ? <Ionicons name={sel ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={sel ? colors.primary : colors.border} /> : null}
                </Pressable>
              </FadeInView>
            );
          }}
        />
        {multiple ? (
          <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}>
            {notice ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm }}>
                {notice}
              </Text>
            ) : null}
            <Button
              label={t('pp.done', { count: chosen.length })}
              onPress={() => {
                onPickMany?.(chosen);
                setQuery('');
              }}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  // outlineStyle : pas de contour de focus du navigateur en plus de la pilule (web seulement), comme src/ui/TextField.
  input: { ...typography.body, flex: 1, minHeight: 44, minWidth: 0, ...({ outlineStyle: 'none' } as object) },
  chosen: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 4, paddingLeft: 4, paddingRight: spacing.sm, borderRadius: 999 },
  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
  note: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
