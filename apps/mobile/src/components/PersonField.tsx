import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import type { Person } from '../people/logic';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Text } from '../ui';
import { PressableScale } from '../ui/premium';
import { PersonPicker } from './PersonPicker';

interface Props {
  label?: string;
  /** Texte du bouton quand rien n'est choisi (« Choisir un destinataire » par défaut). */
  placeholder?: string;
  value: Person | null;
  onChange: (p: Person | null) => void;
  error?: string | null;
  exclude?: string[];
}

/** Remplace la saisie d'un @pseudo : bouton « Choisir… » qui ouvre le sélecteur ; la personne choisie s'affiche en puce avec avatar. */
export function PersonField({ label, placeholder, value, onChange, error, exclude }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="small" muted style={styles.label}>
          {label}
        </Text>
      ) : null}
      <PressableScale
        accessibilityLabel={value ? `${value.displayName}, @${value.handle}. ${t('pp.change')}` : (placeholder ?? t('pp.chooseRecipient'))}
        onPress={() => setOpen(true)}
        pressedScale={0.98}
        style={[styles.box, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
      >
        {value ? (
          <>
            <Avatar name={value.displayName} size={40} contentUrl={value.avatarUrl} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {value.displayName}
              </Text>
              <Text variant="small" muted numberOfLines={1}>
                @{value.handle}
              </Text>
            </View>
            <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
              {t('pp.change')}
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            </View>
            <Text variant="bodyStrong" color={colors.primary} style={styles.flex} numberOfLines={2}>
              {placeholder ?? t('pp.chooseRecipient')}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </>
        )}
      </PressableScale>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : null}
      <PersonPicker
        visible={open}
        onClose={() => setOpen(false)}
        exclude={exclude}
        onPick={(p) => {
          setOpen(false);
          onChange(p);
        }}
      />
    </View>
  );
}

interface ManyProps {
  label?: string;
  placeholder?: string;
  value: Person[];
  onChange: (list: Person[]) => void;
  max?: number;
  exclude?: string[];
}

/** Sélection multiple (groupes, invitations) : puces avec avatar et bouton « Choisir des personnes ». */
export function PeopleField({ label, placeholder, value, onChange, max, exclude }: ManyProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="small" muted style={styles.label}>
          {label}
        </Text>
      ) : null}
      {value.length > 0 ? (
        <View style={styles.pills}>
          {value.map((p) => (
            <PressableScale key={p.handle} accessibilityLabel={t('pp.remove', { name: p.displayName })} onPress={() => onChange(value.filter((x) => x.handle !== p.handle))} style={[styles.pill, { backgroundColor: colors.primarySoft }]}>
              <Avatar name={p.displayName} size={24} contentUrl={p.avatarUrl} />
              <Text variant="small" numberOfLines={1} style={{ maxWidth: 120 }}>
                {p.displayName}
              </Text>
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </PressableScale>
          ))}
        </View>
      ) : null}
      <PressableScale accessibilityLabel={placeholder ?? t('pp.chooseMany')} onPress={() => setOpen(true)} pressedScale={0.98} style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="people-outline" size={20} color={colors.primary} />
        </View>
        <Text variant="bodyStrong" color={colors.primary} style={styles.flex} numberOfLines={2}>
          {placeholder ?? t('pp.chooseMany')}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </PressableScale>
      <PersonPicker
        visible={open}
        multiple
        max={max}
        exclude={exclude}
        initial={value}
        onClose={() => setOpen(false)}
        onPickMany={(list) => {
          setOpen(false);
          onChange(list);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  flex: { flex: 1 },
  label: { marginBottom: spacing.xs },
  box: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 60, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 4, paddingLeft: 4, paddingRight: spacing.sm, borderRadius: 999 },
});
