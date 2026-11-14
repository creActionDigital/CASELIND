import { Ionicons } from '@expo/vector-icons';
import type { KycIdType, KycStatusView, KycSubmission } from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { FormError } from '../../auth/FormError';
import { useI18n, type MessageKey } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { imageMime, uploadImage } from '../../media/upload';
import { submitKyc } from '../../security/api';
import { ID_TYPES, maskIdNumber, parseBirthDate, validateKycLevel1, type KycFieldIssue } from '../../security/kyc-logic';
import { Card } from '../../security/ui';
import { formatMoney } from '../../shop/format';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../ui';
import { useKyc, walletKeys } from '../../wallet/hooks';

const ID_LABEL: Record<KycIdType, MessageKey> = {
  national_id: 'kyc.id.national_id',
  passport: 'kyc.id.passport',
  driver_license: 'kyc.id.driver_license',
  voter_card: 'kyc.id.voter_card',
};
const ISSUE_LABEL: Record<KycFieldIssue, MessageKey> = {
  legalName: 'kyc.issue.legalName',
  birthDate: 'kyc.issue.birthDate',
  underage: 'kyc.issue.underage',
  idType: 'kyc.issue.idType',
  idNumber: 'kyc.issue.idNumber',
  city: 'kyc.issue.city',
  document: 'kyc.issue.document',
  selfie: 'kyc.issue.selfie',
};

interface Photo {
  uri: string;
  mime: ReturnType<typeof imageMime>;
}

/** Vérification d'identité : état, limites, formulaire niveau 1 (identité) ou niveau 2 (justificatif d'adresse). */
export default function Kyc() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const kyc = useKyc();
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('kyc.title') }} />
      <View style={{ gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {kyc.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : kyc.isError ? (
          <ErrorState error={kyc.error} onRetry={() => void kyc.refetch()} />
        ) : (
          <>
            <Status data={kyc.data} locale={locale} />
            {kyc.data.pending ? null : kyc.data.level === 0 ? (
              <Level1Form />
            ) : kyc.data.level === 1 ? (
              <Level2Form />
            ) : null}
            <Card tone="info">
              <Text variant="bodyStrong">{t('kyc.privacy.title')}</Text>
              <Text variant="small">{t('kyc.privacy.body')}</Text>
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}

function LimitsList({ limits, locale }: { limits: KycStatusView['limits']; locale: string }) {
  const { t } = useI18n();
  return (
    <>
      {limits.map((l) => (
        <View key={l.currency} accessible style={{ gap: 2 }}>
          <Text variant="bodyStrong">{l.currency}</Text>
          <Text variant="small" muted>
            {t('wallet.kyc.limits', {
              single: formatMoney(l.maxSingleTransferMinor, l.currency, locale),
              daily: formatMoney(l.maxDailyOutgoingMinor, l.currency, locale),
              max: formatMoney(l.maxBalanceMinor, l.currency, locale),
            })}
          </Text>
        </View>
      ))}
    </>
  );
}

function SubmissionLine({ s }: { s: KycSubmission }) {
  const { t } = useI18n();
  return (
    <>
      {s.legalName ? <Text variant="small">{s.legalName}</Text> : null}
      {s.idType && s.idNumberLast4 ? (
        <Text variant="small" muted>
          {t(ID_LABEL[s.idType])} · {maskIdNumber(s.idNumberLast4)}
        </Text>
      ) : null}
    </>
  );
}

function Status({ data, locale }: { data: KycStatusView; locale: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const rejected = data.lastDecision?.status === 'rejected' && !data.pending ? data.lastDecision : null;
  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {t('wallet.kyc.level', { n: data.level })}
          </Text>
          {data.level === 2 ? <Badge tone="primary" label={t('kyc.complete')} /> : null}
        </View>
        <LimitsList limits={data.limits} locale={locale} />
      </Card>
      {data.pending ? (
        <Card tone="info">
          <Text variant="bodyStrong">{t('kyc.pending.title', { n: data.pending.level })}</Text>
          <Text variant="small">{t('kyc.pending.body')}</Text>
          <SubmissionLine s={data.pending} />
        </Card>
      ) : null}
      {rejected ? (
        <Card tone="warn">
          <Text variant="bodyStrong" color={colors.danger}>
            {t('kyc.rejected.title', { n: rejected.level })}
          </Text>
          <Text variant="small">{rejected.decisionReason ?? t('kyc.rejected.noReason')}</Text>
          <Text variant="small" muted>
            {t('kyc.rejected.retry')}
          </Text>
        </Card>
      ) : null}
      {data.nextLevelLimits && !data.pending ? (
        <Card>
          <Text variant="bodyStrong">{t('kyc.next.title')}</Text>
          <LimitsList limits={data.nextLevelLimits} locale={locale} />
        </Card>
      ) : null}
    </>
  );
}

/** Sélection d'une image (appareil photo ou galerie) ; l'envoi n'a lieu qu'à la soumission. */
function PhotoField({ label, photo, onPick, camera, front, error }: {
  label: string;
  photo: Photo | null;
  onPick(p: Photo): void;
  camera?: boolean;
  front?: boolean;
  error?: string;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  async function pick(fromCamera: boolean) {
    setBusy(true);
    setDenied(false);
    try {
      let res: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setDenied(true);
        res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      }
      const a = res.canceled ? null : res.assets[0];
      if (a) onPick({ uri: a.uri, mime: imageMime(a.mimeType, a.uri) });
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="small" style={{ fontWeight: '600' }}>
        {label}
      </Text>
      {photo ? <Image source={{ uri: photo.uri }} accessibilityLabel={label} style={styles.preview} resizeMode="cover" /> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {camera && Platform.OS !== 'web' ? (
          <Button variant="secondary" label={t('kyc.photo.camera')} loading={busy} onPress={() => void pick(true)} />
        ) : null}
        <Button variant="secondary" label={photo ? t('kyc.photo.change') : t('kyc.photo.gallery')} loading={busy} onPress={() => void pick(false)} />
      </View>
      {denied ? (
        <Text variant="small" color={colors.danger}>
          {t('kyc.photo.denied')}
        </Text>
      ) : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function kycErrorMessage(e: unknown, t: ReturnType<typeof useI18n>['t'], locale: string): string {
  if (e instanceof ApiRequestError && e.status === 409) {
    const r = e.detail<string>('reason');
    if (r === 'pending_exists') return t('kyc.error.pending_exists');
    if (r === 'already_verified') return t('kyc.error.already_verified');
    if (r === 'level_1_required') return t('kyc.error.level_1_required');
  }
  return errorMessage(e, t, locale);
}

function Level1Form() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [legalName, setLegalName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [idType, setIdType] = useState<KycIdType | null>(null);
  const [idNumber, setIdNumber] = useState('');
  const [city, setCity] = useState('');
  const [doc, setDoc] = useState<Photo | null>(null);
  const [selfie, setSelfie] = useState<Photo | null>(null);
  const [issues, setIssues] = useState<Partial<Record<KycFieldIssue, true>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const msg = (k: KycFieldIssue) => (issues[k] ? t(ISSUE_LABEL[k]) : undefined);

  async function submit() {
    setError(null);
    const found = validateKycLevel1({ legalName, birthDate, idType, idNumber, city, hasDocument: !!doc, hasSelfie: !!selfie });
    setIssues(found);
    const iso = parseBirthDate(birthDate);
    if (Object.keys(found).length || !doc || !selfie || !idType || !iso) return;
    setLoading(true);
    try {
      const docId = await uploadImage(doc.uri, doc.mime, 'kyc_document');
      const selfieId = await uploadImage(selfie.uri, selfie.mime, 'kyc_document');
      await submitKyc({
        level: 1,
        legalName: legalName.trim(),
        birthDate: iso,
        idType,
        idNumber: idNumber.trim(),
        city: city.trim(),
        documentIds: [docId, selfieId],
      });
      setIdNumber('');
      await qc.invalidateQueries({ queryKey: walletKeys.kyc });
    } catch (e) {
      setError(kycErrorMessage(e, t, locale));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.hero, { backgroundColor: colors.primarySoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="person-circle-outline" size={56} color={colors.primary} />
      </View>
      <Text variant="heading" accessibilityRole="header" style={{ marginBottom: 8 }}>
        {t('kyc.l1.title')}
      </Text>
      <FormError message={error} />
      <TextField label={t('kyc.field.legalName')} error={msg('legalName')} value={legalName} onChangeText={setLegalName} autoComplete="name" />
      <TextField
        label={t('kyc.field.birthDate')}
        hint={t('kyc.field.birthDate.hint')}
        error={msg('underage') ?? msg('birthDate')}
        value={birthDate}
        onChangeText={setBirthDate}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />
      <Text variant="small" style={{ fontWeight: '600', marginBottom: spacing.xs }}>
        {t('kyc.field.idType')}
      </Text>
      <View style={styles.list} accessibilityRole="radiogroup">
        {ID_TYPES.map((k) => {
          const on = idType === k;
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setIdType(k)}
              style={({ pressed }) => [styles.row, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name={k === 'passport' ? 'book-outline' : 'id-card-outline'} size={22} color={colors.primary} />
              <Text style={{ flex: 1, fontWeight: '600' }}>{t(ID_LABEL[k])}</Text>
              <Ionicons name={on ? 'checkmark-circle' : 'chevron-forward'} size={20} color={on ? colors.primary : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
      {issues.idType ? (
        <Text variant="small" color={colors.danger} style={{ marginBottom: 8 }}>
          {t(ISSUE_LABEL.idType)}
        </Text>
      ) : null}
      <TextField
        label={t('kyc.field.idNumber')}
        hint={t('kyc.field.idNumber.hint')}
        error={msg('idNumber')}
        value={idNumber}
        onChangeText={setIdNumber}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
      />
      <TextField label={t('kyc.field.city')} error={msg('city')} value={city} onChangeText={setCity} />
      <View style={{ gap: spacing.lg, marginBottom: spacing.lg }}>
        <PhotoField label={t('kyc.photo.document')} photo={doc} onPick={setDoc} camera error={msg('document')} />
        <PhotoField label={t('kyc.photo.selfie')} photo={selfie} onPick={setSelfie} camera front error={msg('selfie')} />
      </View>
      <Button label={t('kyc.submit')} onPress={submit} loading={loading} />
    </View>
  );
}

function Level2Form() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [proof, setProof] = useState<Photo | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setMissing(!proof);
    if (!proof) return;
    setLoading(true);
    try {
      const id = await uploadImage(proof.uri, proof.mime, 'kyc_document');
      await submitKyc({ level: 2, documentIds: [id] });
      await qc.invalidateQueries({ queryKey: walletKeys.kyc });
    } catch (e) {
      setError(kycErrorMessage(e, t, locale));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <Text variant="heading" accessibilityRole="header">
        {t('kyc.l2.title')}
      </Text>
      <Text muted>{t('kyc.l2.body')}</Text>
      <FormError message={error} />
      <PhotoField label={t('kyc.photo.proof')} photo={proof} onPick={setProof} camera error={missing ? t('kyc.issue.proof') : undefined} />
      <Button label={t('kyc.submit')} onPress={submit} loading={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginBottom: spacing.lg },
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  hero: { alignSelf: 'center', width: 96, height: 96, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  preview: { width: '100%', height: 180, borderRadius: radius.md },
});
