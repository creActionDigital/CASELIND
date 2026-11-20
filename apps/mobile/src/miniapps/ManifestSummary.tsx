import type { MiniAppCertification } from '@caselind/contracts';
import { Linking, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { formatMoney } from '../shop/format';
import { spacing } from '../theme/tokens';
import { Badge, Text, TextLink } from '../ui';
import { costCap, manifestOf } from './consent-logic';

/** Badge du niveau de certification (annuaire, consentement, portail). */
export function CertBadge({ level }: { level: MiniAppCertification | undefined }) {
  const { t } = useI18n();
  const l = level ?? 'unreviewed';
  return <Badge tone={l === 'certified' ? 'accent' : l === 'reviewed' ? 'primary' : 'neutral'} label={t(`mp.cert.${l}` as MessageKey)} />;
}

/** Le manifeste approuvé en clair : données consultées, coûts, événements, conditions, confidentialité, contact. */
export function ManifestSummary({ manifest }: { manifest: unknown }) {
  const { t, locale } = useI18n();
  const m = manifestOf(manifest);
  if (!m) return <Text variant="small" muted>{t('mp.consent.noManifest')}</Text>;
  const cap = costCap(m);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="bodyStrong">{t('mp.m.data')}</Text>
      {m.dataAccessed.map((d) => (
        <View key={d.scope}>
          <Text variant="small">• {t(`miniapps.scope.${d.scope}` as MessageKey)}</Text>
          <Text variant="caption" muted>{t('mp.m.purpose', { purpose: d.purpose })}</Text>
          <Text variant="caption" muted>{t('mp.m.retention', { retention: d.retention })}</Text>
        </View>
      ))}
      <Text variant="bodyStrong">{t('mp.m.costs')}</Text>
      <Text variant="small">{t(`mp.cost.${m.costs.model}` as MessageKey)} : {m.costs.description}</Text>
      {cap ? <Text variant="caption" muted>{t('mp.m.cap', { amount: formatMoney(cap.amountMinor, cap.currency, locale) })}</Text> : null}
      {m.events.length > 0 ? (
        <>
          <Text variant="bodyStrong">{t('mp.m.events')}</Text>
          {m.events.map((e) => <Text key={e} variant="caption" muted>• {t(`mp.event.${e}` as MessageKey)}</Text>)}
        </>
      ) : null}
      <Text variant="caption" muted>{t('mp.m.location', { where: m.dataLocation })}</Text>
      <Text variant="caption" muted>{t('mp.m.support', { email: m.supportEmail })}</Text>
      <TextLink label={t('mp.m.terms')} onPress={() => void Linking.openURL(m.termsUrl)} />
      <TextLink label={t('mp.m.privacy')} onPress={() => void Linking.openURL(m.privacyUrl)} />
    </View>
  );
}
