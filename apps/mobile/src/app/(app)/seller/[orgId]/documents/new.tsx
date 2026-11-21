import { useMutation, useQueryClient } from '@tanstack/react-query';
import { safeBack } from '../../../../../lib/back-target';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { createDocument, dk } from '../../../../../seller/api';
import { emptyLine, toDocumentRequest, type DocumentDraft } from '../../../../../seller/documents';
import { SELLER_CURRENCIES } from '../../../../../seller/money';
import { Chips, SectionTitle, sellerErrorMessage } from '../../../../../seller/ui';
import { useI18n } from '../../../../../i18n';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../../../ui';

/** Nouveau devis ou nouvelle facture : client, devise, lignes. Le total et le numéro sont calculés par le serveur. */
export default function NewDocument() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [d, setD] = useState<DocumentDraft>({ kind: 'quote', customerName: '', customerContact: '', currency: 'USD', lines: [emptyLine()] });
  const [error, setError] = useState<string | null>(null);
  const setLine = (i: number, patch: Partial<DocumentDraft['lines'][number]>) => setD((c) => ({ ...c, lines: c.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  const create = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof toDocumentRequest>>) => createDocument(orgId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dk.all(orgId) });
      safeBack(router, `/seller/${orgId}/documents`);
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  function submit() {
    setError(null);
    const body = toDocumentRequest(d);
    if (!body) return setError(t('docs.err.invalid'));
    create.mutate(body);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('docs.new') }} />
      <Chips
        scroll={false}
        options={[
          { value: 'quote' as const, label: t('docs.type.quote') },
          { value: 'invoice' as const, label: t('docs.type.invoice') },
        ]}
        value={d.kind}
        onChange={(kind) => setD((c) => ({ ...c, kind }))}
      />
      <Chips scroll={false} options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={d.currency} onChange={(currency) => setD((c) => ({ ...c, currency }))} />
      <TextField label={t('docs.customer')} value={d.customerName} onChangeText={(customerName) => setD((c) => ({ ...c, customerName }))} maxLength={120} />
      <TextField label={t('docs.contact')} value={d.customerContact} onChangeText={(customerContact) => setD((c) => ({ ...c, customerContact }))} maxLength={120} autoCapitalize="none" />
      {d.lines.map((l, i) => (
        <React.Fragment key={i}>
          <SectionTitle>{t('docs.line', { n: i + 1 })}</SectionTitle>
          <TextField label={t('docs.description')} value={l.description} onChangeText={(description) => setLine(i, { description })} maxLength={200} />
          <TextField label={t('docs.quantity')} value={l.quantity} onChangeText={(quantity) => setLine(i, { quantity })} keyboardType="number-pad" />
          <TextField label={t('docs.price', { currency: d.currency })} value={l.price} onChangeText={(price) => setLine(i, { price })} keyboardType="decimal-pad" />
        </React.Fragment>
      ))}
      {d.lines.length < 50 ? <Button variant="secondary" label={t('docs.addLine')} onPress={() => setD((c) => ({ ...c, lines: [...c.lines, emptyLine()] }))} /> : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('docs.create')} loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
