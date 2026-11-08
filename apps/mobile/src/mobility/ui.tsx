import type { CancelReason, RidePoint } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n, type MessageKey } from '../i18n';
import { getDevicePosition } from '../places/device-location';
import { GOMA_CENTER, roundCoordinate } from '../places/geo';
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

/**
 * Feuille de choix d'un lieu : position de l'appareil (demandée à ce moment, jamais conservée), lieu favori ou saisie
 * du nom et des coordonnées.
 */
export function PlaceSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (p: RidePoint) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const favorites = useQuery({ queryKey: rideKeys.favorites, queryFn: fetchFavorites, enabled: visible, retry: false });
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState(String(GOMA_CENTER.lat));
  const [lng, setLng] = useState(String(GOMA_CENTER.lng));
  const [invalid, setInvalid] = useState(false);

  function done(p: RidePoint) {
    setNote(null);
    setInvalid(false);
    onPick(p);
  }
  async function useDevice() {
    setLocating(true);
    setNote(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) {
      return done({ lat: roundCoordinate(r.position.lat), lng: roundCoordinate(r.position.lng), label: t('mobility.place.deviceLabel') });
    }
    setNote(t(r.reason === 'denied' ? 'mobility.place.denied' : 'mobility.place.unavailable'));
  }
  function useManual() {
    const p = parsePoint(label, lat, lng);
    if (!p) return setInvalid(true);
    done(p);
  }

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {t('mobility.place.title')}
        </Text>
        <Button variant="secondary" label={t('mobility.place.device')} loading={locating} onPress={() => void useDevice()} />
        <Text variant="small" muted>
          {t('mobility.place.deviceBody')}
        </Text>
        {note ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {note}
          </Text>
        ) : null}

        <Text variant="bodyStrong">{t('mobility.place.favorites')}</Text>
        {favorites.data && favorites.data.items.length > 0 ? (
          favorites.data.items.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={`${f.label}, ${f.address}`}
              onPress={() => done({ lat: f.lat, lng: f.lng, label: f.label })}
              style={({ pressed }) => [styles.fav, { backgroundColor: pressed ? colors.primarySoft : colors.surfaceAlt }]}
            >
              <Ionicons name={f.kind === 'home' ? 'home-outline' : f.kind === 'work' ? 'briefcase-outline' : 'location-outline'} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {f.label}
                </Text>
                <Text variant="small" muted numberOfLines={1}>
                  {f.address}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Text variant="small" muted>
            {t('mobility.place.noFavorites')}
          </Text>
        )}

        <Text variant="bodyStrong">{t('mobility.place.manual')}</Text>
        <TextField label={t('mobility.place.label')} value={label} onChangeText={setLabel} maxLength={160} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField label={t('mobility.place.lat')} value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" autoCorrect={false} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={t('mobility.place.lng')} value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" autoCorrect={false} />
          </View>
        </View>
        {invalid ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {t('mobility.place.invalid')}
          </Text>
        ) : null}
        <Button label={t('mobility.place.use')} onPress={useManual} />
        <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
      </ScrollView>
    </SheetModal>
  );
}

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
