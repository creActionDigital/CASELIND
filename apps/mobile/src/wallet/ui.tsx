import { Ionicons } from '@expo/vector-icons';
import type { WalletCounterparty, WalletTransaction } from '@caselind/contracts';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { shareMessage } from '../lib/share';
import { useI18n, type MessageKey } from '../i18n';
import { formatMoney } from '../shop/format';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { PIN_LENGTH, appendDigit } from './pin';
import { signedMinor } from './history';

/** Bandeau présent sur chaque écran du wallet : l'argent est fictif (CDC §17, ADR-017). */
export function SandboxBanner() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${t('wallet.sandbox')}. ${t('wallet.sandboxHint')}`}
      style={[styles.banner, { backgroundColor: colors.primarySoft }]}
    >
      <Ionicons name="flask-outline" size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
          {t('wallet.sandbox')}
        </Text>
        <Text variant="caption" muted>
          {t('wallet.sandboxHint')}
        </Text>
      </View>
    </View>
  );
}

export function counterpartyName(cp: WalletCounterparty | null, t: (k: MessageKey) => string): string {
  if (!cp) return t('wallet.tx.system');
  if (cp.kind === 'user') return cp.displayName;
  if (cp.kind === 'org') return cp.name;
  return cp.label;
}

const KIND_KEY: Record<WalletTransaction['kind'], MessageKey> = {
  p2p: 'wallet.kind.p2p',
  merchant_payment: 'wallet.kind.merchant',
  sandbox_topup: 'wallet.kind.topup',
  refund: 'wallet.kind.refund',
  adjustment: 'wallet.kind.adjustment',
};

export function TxRow({ tx, onPress }: { tx: WalletTransaction; onPress: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const name = counterpartyName(tx.counterparty, t);
  const amount = formatMoney(signedMinor(tx), tx.currency, locale);
  const signed = `${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amountMinor, tx.currency, locale)}`;
  const dir = t(tx.direction === 'in' ? 'wallet.tx.in' : 'wallet.tx.out');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dir}, ${name}, ${amount}${tx.note ? `, ${tx.note}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.dirIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={tx.direction === 'in' ? 'arrow-down' : 'arrow-up'} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontWeight: '600' }}>
          {name}
        </Text>
        <Text variant="small" muted numberOfLines={1}>
          {tx.note ?? t(KIND_KEY[tx.kind])}
        </Text>
      </View>
      <Text color={tx.direction === 'in' ? colors.success : colors.text} style={{ fontWeight: '600' }}>
        {signed}
      </Text>
    </Pressable>
  );
}

/** Fiche détail d'une transaction (feuille). */
export function TxSheet({ tx, onClose }: { tx: WalletTransaction | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const lines = useMemo(() => {
    if (!tx) return [];
    const cp = tx.counterparty;
    const handle = cp?.kind === 'user' ? `@${cp.handle}` : cp?.kind === 'org' ? cp.slug : null;
    return [
      [t(tx.direction === 'in' ? 'wallet.tx.from' : 'wallet.tx.to'), counterpartyName(cp, t) + (handle ? ` (${handle})` : '')],
      [t('wallet.tx.type'), t(KIND_KEY[tx.kind])],
      [t('wallet.tx.date'), new Date(tx.createdAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })],
      [t('wallet.tx.note'), tx.note ?? t('wallet.tx.noNote')],
      [t('wallet.tx.ref'), tx.id],
    ] as const;
  }, [tx, t, locale]);
  return (
    <SheetModal visible={!!tx} onClose={onClose}>
      {tx ? (
        <View style={{ gap: spacing.md }}>
          <SandboxBanner />
          <Text variant="display" color={tx.direction === 'in' ? colors.success : colors.text} accessibilityRole="header">
            {tx.direction === 'in' ? '+' : '−'}
            {formatMoney(tx.amountMinor, tx.currency, locale)}
          </Text>
          {lines.map(([k, v]) => (
            <View key={k} accessible accessibilityLabel={`${k}: ${v}`}>
              <Text variant="caption" muted>
                {k}
              </Text>
              <Text variant="small" selectable={k === t('wallet.tx.ref')}>
                {v}
              </Text>
            </View>
          ))}
          <Button
            variant="secondary"
            label={t('wallet.tx.share')}
            onPress={() =>
              void shareMessage(
                {
                  title: t('wallet.tx.shareTitle'),
                  message: t('wallet.tx.shareText', {
                    amount: `${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amountMinor, tx.currency, locale)}`,
                    party: `${t(tx.direction === 'in' ? 'wallet.tx.from' : 'wallet.tx.to')} ${lines[0]![1]}`,
                    date: new Date(tx.createdAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' }),
                    ref: tx.id,
                  }),
                },
                t('wallet.tx.copied'),
              )
            }
          />
        </View>
      ) : null}
    </SheetModal>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

/**
 * Pavé PIN maison à 6 chiffres. Le code n'est jamais affiché (points seulement) ni annoncé : le lecteur d'écran
 * n'entend que la progression. Chaque touche est un bouton de 44 pt minimum.
 */
export function PinPad({ value, onChange, disabled, error, length = PIN_LENGTH }: { value: string; onChange: (v: string) => void; disabled?: boolean; error?: string | null; length?: number }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.padWrap}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('wallet.pad.progress', { n: value.length, total: length })}
        style={styles.dots}
      >
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: error ? colors.danger : colors.primary, backgroundColor: i < value.length ? (error ? colors.danger : colors.primary) : 'transparent' },
            ]}
          />
        ))}
      </View>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityRole="alert" style={{ textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {KEYS.map((k, i) => {
          if (k === '') return <View key={i} style={styles.key} />;
          const del = k === '⌫';
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={del ? t('wallet.pad.delete') : t('wallet.pad.digit', { n: k })}
              disabled={disabled || (del && value.length === 0)}
              onPress={() => onChange(del ? value.slice(0, -1) : value.length < length ? appendDigit(value, k) : value)}
              style={({ pressed }) => [styles.key, { backgroundColor: del ? 'transparent' : pressed ? colors.primarySoft : colors.surfaceAlt, opacity: disabled ? 0.5 : 1 }]}
            >
              {del ? <Ionicons name="backspace-outline" size={26} color={colors.text} /> : <Text style={typography.title}>{k}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, minHeight: TOUCH + 12 },
  dirIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  padWrap: { alignItems: 'center', gap: spacing.lg },
  dots: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 84 + 2 * 12, gap: 12, justifyContent: 'center' },
  key: { width: 84, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
