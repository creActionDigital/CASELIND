import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/auth-context';
import { useI18n } from '../../i18n';
import { shareMessage } from '../../lib/share';
import { alertConfirm } from '../../lib/confirm';
import { ApiRequestError } from '../../lib/api';
import { fetchExport, requestDeletion } from '../../privacy/api';
import { canRequestDeletion, exportJson, sectionLabel, summarizeExport } from '../../privacy/logic';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../ui';

/** Mes données : export (RGPD, droit d'accès) et demande de suppression du compte (délai de grâce, annulée en se reconnectant). */
export default function MyData() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { signOut } = useAuth();
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [shareError, setShareError] = useState(false);

  const exportQuery = useMutation({ mutationFn: fetchExport, onMutate: () => setShareError(false) });
  const deletion = useMutation({
    mutationFn: () => requestDeletion(password),
    onSuccess: (res) => {
      const date = new Date(res.deletionScheduledFor).toLocaleDateString(locale);
      // La session est déjà révoquée côté serveur : on affiche la date puis on ramène à la connexion.
      // Sur le web, confirm() n'appelle le bouton que sur « OK » : on déconnecte dans tous les cas.
      const web = Platform.OS === 'web';
      alertConfirm(t('mydata.delete.doneTitle'), t('mydata.delete.doneBody', { date }), [{ text: t('common.close'), onPress: web ? undefined : () => void signOut() }]);
      if (web) void signOut();
    },
  });

  const share = async (json: string) => {
    await shareMessage({ message: json }, t('share.copied'));
  };

  const confirmDelete = () =>
    alertConfirm(t('mydata.delete.confirmTitle'), t('mydata.delete.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mydata.delete.run'), style: 'destructive', onPress: () => deletion.mutate() },
    ]);

  const summary = exportQuery.data ? summarizeExport(exportQuery.data, locale) : null;
  const lastOwner = deletion.error instanceof ApiRequestError && deletion.error.detail<string>('reason') === 'last_owner';

  return (
    <Screen edges={['bottom']}>
      <Text muted>{t('mydata.intro')}</Text>
      <Button variant="secondary" label={t('mydata.consents.link')} accessibilityLabel={`${t('mydata.consents.link')} : ${t('mydata.consents.linkHint')}`} onPress={() => router.push('/consents')} style={{ marginTop: spacing.md }} />

      <Text variant="heading" accessibilityRole="header" style={styles.h}>{t('mydata.export.title')}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="small" muted>{t('mydata.export.warn')}</Text>
        <Button label={t('mydata.export.run')} loading={exportQuery.isPending} onPress={() => exportQuery.mutate()} />
        {exportQuery.isError ? <ErrorState error={exportQuery.error} /> : null}
        {exportQuery.data && summary ? (
          <View style={{ gap: spacing.xs }}>
            <Text variant="bodyStrong">{t('mydata.export.summary')}</Text>
            <Text variant="small" muted>{t('mydata.export.at', { date: new Date(String(exportQuery.data['exportedAt'] ?? Date.now())).toLocaleString(locale) })}</Text>
            {summary.rows.length === 0 ? <Text variant="small">{t('mydata.export.empty')}</Text> : null}
            {summary.rows.map((r) => (
              <View key={r.key} style={styles.line}>
                <Text variant="small" style={{ flex: 1 }}>{sectionLabel(r.key, locale)}</Text>
                <Text variant="small">{r.count}</Text>
              </View>
            ))}
            <Text variant="small" muted>{t('mydata.export.total', { n: summary.total })}</Text>
            <Button variant="secondary" label={t('mydata.export.share')} onPress={() => void share(exportJson(exportQuery.data))} />
            {shareError ? <Text variant="small" color={colors.danger}>{t('mydata.export.shareFailed')}</Text> : null}
          </View>
        ) : null}
      </View>

      <Text variant="heading" accessibilityRole="header" style={styles.h}>{t('mydata.delete.title')}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger }]}>
        <Text variant="small">{t('mydata.delete.body')}</Text>
        <TextField label={t('mydata.delete.word')} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} />
        <TextField label={t('mydata.delete.password')} value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" />
        {deletion.isError ? (lastOwner ? <Text variant="small" color={colors.danger}>{t('mydata.delete.lastOwner')}</Text> : <ErrorState error={deletion.error} />) : null}
        <Button variant="danger" label={t('mydata.delete.run')} disabled={!canRequestDeletion(word, password)} loading={deletion.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  line: { flexDirection: 'row', gap: spacing.md },
});
