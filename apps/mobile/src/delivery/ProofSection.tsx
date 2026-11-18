import type { DeliveryProofFile, DeliveryStatus } from '@caselind/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { imageMime, uploadImage } from '../media/upload';
import { Card, SectionTitle } from '../seller/ui';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Button, Text } from '../ui';
import { proofKeys, setProof, useDeliveryProof } from './proof-api';
import { canAttachProof, hasProof, isProofMime, showsProof } from './proof-logic';
import { deliveryErrorMessage } from './errors';

function ProofFile({ file, label }: { file: DeliveryProofFile; label: string }) {
  const { t, locale } = useI18n();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="bodyStrong">{label}</Text>
      <AuthImage contentUrl={file.contentUrl} label={label} style={styles.image} />
      <Text variant="small" muted>
        {t('delivery.proof.takenAt', { date: new Date(file.takenAt).toLocaleString(locale) })}
      </Text>
    </View>
  );
}

/** Photo et signature jointes à la livraison, en lecture seule (acheteur et vendeur). Rien tant qu'il n'y en a pas. */
export function ProofView({ deliveryId, status, bare }: { deliveryId: string; status: DeliveryStatus; bare?: boolean }) {
  const { t } = useI18n();
  const q = useDeliveryProof(deliveryId, showsProof(status));
  if (!q.data || !hasProof(q.data)) return null;
  const files = (
    <>
      {q.data.photo ? <ProofFile file={q.data.photo} label={t('delivery.proof.photo')} /> : null}
      {q.data.signature ? <ProofFile file={q.data.signature} label={t('delivery.proof.signature')} /> : null}
    </>
  );
  // `bare` : dans une carte existante (suivi acheteur), sans second cadre.
  if (bare) {
    return (
      <View style={{ gap: spacing.md }}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('delivery.proof.title')}
        </Text>
        {files}
      </View>
    );
  }
  return (
    <>
      <SectionTitle>{t('delivery.proof.title')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>{files}</Card>
    </>
  );
}

/**
 * Écran livreur : joindre (caméra ou galerie), remplacer ou retirer la photo de remise.
 * La signature du client reste affichée si elle existe, mais son tracé n'est pas encore proposé sur mobile.
 */
export function CourierProof({ deliveryId, status }: { deliveryId: string; status: DeliveryStatus }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useDeliveryProof(deliveryId, canAttachProof(status));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useMutation({
    mutationFn: (photoAssetId: string | null) => setProof(deliveryId, { photoAssetId }),
    onSuccess: (p) => qc.setQueryData(proofKeys.one(deliveryId), p),
    onError: (e) => setError(deliveryErrorMessage(e, t, locale)),
  });

  if (!canAttachProof(status)) return null;
  const photo = q.data?.photo ?? null;

  async function pick(fromCamera: boolean) {
    setError(null);
    setBusy(true);
    try {
      let res: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setError(t('delivery.proof.denied'));
        res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      }
      const a = res.canceled ? null : res.assets[0];
      if (!a) return;
      const mime = imageMime(a.mimeType, a.uri);
      if (!isProofMime(mime)) return setError(t('delivery.proof.badType'));
      const assetId = await uploadImage(a.uri, mime, 'delivery_proof');
      await save.mutateAsync(assetId);
    } catch (e) {
      setError(deliveryErrorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>{t('delivery.proof.title')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Text variant="small" muted>
          {t('delivery.proof.hint')} {t('delivery.proof.seen')}
        </Text>
        {photo ? <ProofFile file={photo} label={t('delivery.proof.photo')} /> : null}
        {q.data?.signature ? <ProofFile file={q.data.signature} label={t('delivery.proof.signature')} /> : null}
        <View style={{ gap: spacing.sm }}>
          {Platform.OS !== 'web' ? <Button variant="secondary" label={photo ? t('delivery.proof.replace') : t('delivery.proof.camera')} loading={busy} onPress={() => void pick(true)} /> : null}
          <Button variant="secondary" label={t('delivery.proof.gallery')} loading={busy} onPress={() => void pick(false)} />
          {photo ? <Button variant="ghost" label={t('delivery.proof.remove')} disabled={busy} loading={save.isPending && save.variables === null} onPress={() => save.mutate(null)} /> : null}
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({ image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden' } });
