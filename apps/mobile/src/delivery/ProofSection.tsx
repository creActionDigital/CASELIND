import type { DeliveryProofFile, DeliveryStatus } from '@caselind/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { imageMime, uploadBytes, uploadImage } from '../media/upload';
import { Card, SectionTitle } from '../seller/ui';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Button, Text } from '../ui';
import { SignaturePad } from './SignaturePad';
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
 * La signature du client se trace au doigt (PNG fabriqué sans lib de capture) ; l'API refuse de remplacer une preuve déjà remise.
 */
export function CourierProof({ deliveryId, status }: { deliveryId: string; status: DeliveryStatus }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useDeliveryProof(deliveryId, canAttachProof(status));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);

  const save = useMutation({
    mutationFn: (body: { photoAssetId?: string | null; signatureAssetId?: string | null }) => setProof(deliveryId, body),
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
      await save.mutateAsync({ photoAssetId: assetId });
    } catch (e) {
      setError(deliveryErrorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  async function sign(png: Uint8Array) {
    setError(null);
    setBusy(true);
    try {
      const assetId = await uploadBytes(png, 'image/png', 'delivery_proof');
      await save.mutateAsync({ signatureAssetId: assetId });
      setSigning(false);
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
          {photo ? <Button variant="ghost" label={t('delivery.proof.remove')} disabled={busy} loading={save.isPending && save.variables?.photoAssetId === null} onPress={() => save.mutate({ photoAssetId: null })} /> : null}
          <Button variant="secondary" label={q.data?.signature ? t('delivery.signature.redo') : t('delivery.signature.open')} disabled={busy} onPress={() => setSigning((v) => !v)} />
        </View>
        {signing ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="small" muted>
              {t('delivery.signature.hint')}
            </Text>
            <SignaturePad onSubmit={(png) => void sign(png)} busy={busy} />
          </View>
        ) : null}
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
