import type { CancelReason, RidePoint } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n, type MessageKey } from '../i18n';
import { PlacePicker } from '../places/PlacePicker';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { fetchFavorites, rideKeys } from './api';
import { cancelReasons, parsePoint, type RideRole } from './logic';

/** Ligne « libellé : valeur » des cartes de course. */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="small" muted style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="small" style={{ flex: 2, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

/** Feuille de choix d'un lieu (recherche, ma position, carte) : voir PlacePicker. */
export const PlaceSheet = PlacePicker;

/** Choix d'un motif d'annulation dans la liste fermée du rôle, puis confirmation. */
export function CancelSheet({
  visible,
  role,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  role: RideRole;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: CancelReason) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [reason, setReason] = useState<CancelReason | null>(null);
  return (
    <SheetModal visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {t('mobility.cancel.title')}
        </Text>
        <View accessibilityRole="radiogroup" style={{ gap: spacing.xs }}>
          {cancelReasons(role).map((r) => (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r }}
              onPress={() => setReason(r)}
              style={[styles.fav, { backgroundColor: reason === r ? colors.primarySoft : colors.surfaceAlt }]}
            >
              <Ionicons name={reason === r ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.primary} />
              <Text style={{ flex: 1 }}>{t(`mobility.cancel.reason.${r}` as MessageKey)}</Text>
            </Pressable>
          ))}
        </View>
        {role === 'rider' ? (
          <Text variant="small" muted>
            {t('mobility.cancel.free')}
          </Text>
        ) : null}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button variant="danger" label={t('mobility.cancel.confirm')} disabled={!reason} loading={busy} onPress={() => reason && onConfirm(reason)} />
        <Button variant="ghost" label={t('mobility.cancel.back')} disabled={busy} onPress={onClose} />
      </ScrollView>
    </SheetModal>
  );
}

/** Étoiles 1 à 5 et commentaire facultatif. */
export function RatingForm({
  title,
  busy,
  error,
  onSubmit,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (rating: number, comment: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ selected: stars === n }}
            accessibilityLabel={t('mobility.rate.star', { n })}
            onPress={() => setStars(n)}
            style={styles.star}
          >
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={32} color={colors.primary} />
          </Pressable>
        ))}
      </View>
      <TextField label={t('mobility.rate.comment')} value={comment} onChangeText={setComment} maxLength={500} multiline />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('mobility.rate.send')} disabled={stars === 0} loading={busy} onPress={() => onSubmit(stars, comment.trim())} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  fav: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  star: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
