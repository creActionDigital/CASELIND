import type { Product } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { ApiRequestError } from '../../../../../lib/api';
import { uuidv4 } from '../../../../../lib/uuid';
import { imageMime, uploadProductImage } from '../../../../../media/upload';
import { archiveProduct, createProduct, fetchCategories, fetchProduct, patchProduct, sk, useMembership } from '../../../../../seller/api';
import { minorToDecimalString, SELLER_CURRENCIES } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../../seller/ui';
import {
  hasErrors,
  MAX_OPTIONS,
  MAX_PHOTOS,
  MAX_VARIANTS,
  moveItem,
  toVariantInput,
  validateVariants,
  type VariantDraft,
  type VariantErrors,
} from '../../../../../seller/variants';
import { radius, spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { AuthImage, Button, ErrorState, IconButton, Screen, Text, TextField } from '../../../../../ui';

interface Photo {
  key: string;
  id?: string;
  contentUrl?: string;
  localUri?: string;
  state: 'uploading' | 'ready' | 'failed';
}

const blankVariant = (): VariantDraft => ({
  key: uuidv4(),
  sku: '',
  options: [],
  price: '',
  currency: 'USD',
  stock: '0',
  trackStock: true,
  active: true,
});

/** Éditeur de produit (`new` pour une création). Charge le produit puis monte le formulaire. */
export default function ProductEditorRoute() {
  const { orgId, productId } = useLocalSearchParams<{ orgId: string; productId: string }>();
  const isNew = productId === 'new';
  const q = useQuery({ queryKey: sk.product(orgId, productId), queryFn: () => fetchProduct(orgId, productId), enabled: !isNew });
  if (!isNew && q.isPending) return <Loading />;
  if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Editor orgId={orgId} product={isNew ? undefined : q.data} />;
}

function Editor({ orgId, product }: { orgId: string; product?: Product }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { role } = useMembership(orgId);
  const categories = useQuery({ queryKey: sk.categories, queryFn: fetchCategories, staleTime: 3_600_000 });

  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(product?.categoryId ?? null);
  const [photos, setPhotos] = useState<Photo[]>(
    () => product?.media.map((m) => ({ key: m.id, id: m.id, contentUrl: m.contentUrl, state: 'ready' as const })) ?? [],
  );
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    product
      ? product.variants.map((v) => ({
          key: v.id,
          id: v.id,
          sku: v.sku,
          options: Object.entries(v.options).map(([name, value]) => ({ name, value })),
          price: minorToDecimalString(v.priceMinor, v.currency),
          currency: v.currency,
          stock: String(v.stock),
          trackStock: v.trackStock,
          active: v.active,
        }))
      : [blankVariant()],
  );
  const [attempted, setAttempted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [skuConflict, setSkuConflict] = useState<{ sku: string | null } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pickError, setPickError] = useState(false);

  const status = product?.status;
  const canEdit = can(role, 'catalog.manage');
  const vErrors = validateVariants(variants);
  const titleMissing = !title.trim();

  async function pickPhotos() {
    setPickError(false);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.85,
      });
      if (res.canceled) return;
      for (const a of res.assets.slice(0, remaining)) {
        const key = uuidv4();
        setPhotos((cur) => [...cur, { key, localUri: a.uri, state: 'uploading' }]);
        uploadProductImage(a.uri, imageMime(a.mimeType, a.uri)).then(
          (id) => setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, id, state: 'ready' } : p))),
          () => setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, state: 'failed' } : p))),
        );
      }
    } catch {
      setPickError(true);
    }
  }

  const patchVariant = (key: string, patch: Partial<VariantDraft>) => setVariants((cur) => cur.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const save = useMutation({
    mutationFn: async (target: 'draft' | 'publish' | 'keep') => {
      const inputs = variants.map((v) => toVariantInput(v)!);
      const nextStatus = target === 'publish' ? 'published' : target === 'draft' ? 'draft' : undefined;
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        categoryId,
        mediaIds: photos.map((p) => p.id!),
        variants: inputs,
      };
      return product
        ? patchProduct(orgId, product.id, { ...body, ...(nextStatus ? { status: nextStatus } : {}) })
        : createProduct(orgId, { ...body, status: nextStatus === 'published' ? 'published' : 'draft' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller', orgId] });
      router.back();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409) {
        if (/sku/i.test(e.message)) {
          const named = /:\s*(.+)$/.exec(e.message)?.[1]?.trim() ?? null;
          return setSkuConflict({ sku: named });
        }
        if (/at least one active variant/i.test(e.message)) return setVariantsError(t('seller.product.errNoVariant'));
      }
      setBanner(sellerErrorMessage(e, t, locale));
    },
  });

  const archive = useMutation({
    mutationFn: () => archiveProduct(orgId, product!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller', orgId] });
      router.back();
    },
    onError: (e) => setBanner(sellerErrorMessage(e, t, locale)),
  });

  function submit(target: 'draft' | 'publish' | 'keep') {
    setAttempted(true);
    setBanner(null);
    setVariantsError(null);
    setSkuConflict(null);
    if (titleMissing || hasErrors(vErrors)) return;
    if (photos.some((p) => p.state !== 'ready')) return setBanner(t('seller.photos.pending'));
    if (target === 'publish' && !variants.some((v) => v.active)) return setVariantsError(t('seller.product.errNoVariant'));
    save.mutate(target);
  }

  const busy = save.isPending || archive.isPending;
  const isDraftish = !product || status === 'draft';

  return (
    <Screen>
      <Stack.Screen options={{ title: product ? t('seller.product.edit') : t('seller.product.new') }} />
      {!canEdit ? (
        <Text color={colors.danger} style={{ marginBottom: spacing.md }}>
          {t('error.forbidden')}
        </Text>
      ) : null}

      <TextField
        label={t('seller.product.title')}
        value={title}
        onChangeText={setTitle}
        maxLength={140}
        error={attempted && titleMissing ? t('seller.product.titleRequired') : null}
      />
      <TextField
        label={t('seller.product.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={5000}
      />

      <Text variant="small" style={styles.label}>
        {t('seller.product.category')}
      </Text>
      {categories.data ? (
        <Chips
          scroll={false}
          options={categories.data.items.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={(id) => setCategoryId((cur) => (cur === id ? null : id))}
        />
      ) : (
        <View style={{ height: spacing.lg }} />
      )}

      <SectionTitle>{t('seller.photos.title', { n: photos.length, max: MAX_PHOTOS })}</SectionTitle>
      <Text variant="small" muted style={{ marginBottom: spacing.sm }}>
        {t('seller.photos.hint')}
      </Text>
      <View style={styles.photoGrid}>
        {photos.map((p, i) => (
          <View key={p.key} style={styles.photoCell}>
            <View style={[styles.photo, { backgroundColor: colors.surfaceAlt, borderColor: p.state === 'failed' ? colors.danger : 'transparent' }]}>
              <AuthImage contentUrl={p.contentUrl ?? null} localUri={p.localUri} label={t('seller.photos.photo', { n: i + 1 })} style={StyleSheet.absoluteFill} />
              {p.state !== 'ready' ? (
                <View style={[StyleSheet.absoluteFill, styles.photoState, { backgroundColor: colors.overlay }]}>
                  <Text variant="caption" color="#FFFFFF">
                    {p.state === 'uploading' ? t('seller.photos.uploading') : t('seller.photos.failed')}
                  </Text>
                </View>
              ) : null}
            </View>
            {i === 0 ? (
              <Text variant="caption" muted>
                {t('seller.photos.cover')}
              </Text>
            ) : null}
            <View style={styles.photoActions}>
              <IconButton icon="chevron-back" size={20} label={t('seller.photos.moveLeft')} disabled={i === 0} onPress={() => setPhotos((c) => moveItem(c, i, i - 1))} />
              <IconButton icon="chevron-forward" size={20} label={t('seller.photos.moveRight')} disabled={i === photos.length - 1} onPress={() => setPhotos((c) => moveItem(c, i, i + 1))} />
              <IconButton icon="close-circle-outline" size={20} color={colors.danger} label={t('seller.photos.remove')} onPress={() => setPhotos((c) => c.filter((x) => x.key !== p.key))} />
            </View>
          </View>
        ))}
      </View>
      {pickError ? (
        <Text variant="small" color={colors.danger}>
          {t('compose.pickError')}
        </Text>
      ) : null}
      <Button
        variant="secondary"
        label={t('seller.photos.add')}
        disabled={photos.length >= MAX_PHOTOS}
        onPress={pickPhotos}
        style={{ marginBottom: spacing.md }}
      />

      <SectionTitle>{t('seller.variants.title')}</SectionTitle>
      {variantsError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.sm }}>
          {variantsError}
        </Text>
      ) : null}
      {variants.map((v, i) => (
        <VariantCard
          key={v.key}
          index={i}
          v={v}
          errors={attempted ? vErrors[i] : {}}
          skuConflict={
            skuConflict && (skuConflict.sku ? v.sku.trim().toLowerCase() === skuConflict.sku.toLowerCase() : !v.id) ? t('seller.variant.err.sku_taken') : null
          }
          onChange={(patch) => {
            setSkuConflict(null);
            patchVariant(v.key, patch);
          }}
          onRemove={!v.id && variants.length > 1 ? () => setVariants((c) => c.filter((x) => x.key !== v.key)) : undefined}
        />
      ))}
      <Button
        variant="secondary"
        label={t('seller.variants.add')}
        disabled={variants.length >= MAX_VARIANTS}
        onPress={() => setVariants((c) => [...c, { ...blankVariant(), currency: c[c.length - 1]?.currency ?? 'USD' }])}
        style={{ marginBottom: spacing.xl }}
      />

      {banner ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
          {banner}
        </Text>
      ) : null}

      {confirmArchive ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('seller.product.archiveTitle')}
          </Text>
          <Text muted>{t('seller.product.archiveBody')}</Text>
          <Button variant="danger" label={t('seller.product.archive')} loading={archive.isPending} onPress={() => archive.mutate()} />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirmArchive(false)} />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {status !== 'published' ? (
            <Button label={t('seller.product.publish')} loading={save.isPending && save.variables === 'publish'} disabled={busy || !canEdit} onPress={() => submit('publish')} />
          ) : null}
          <Button
            variant={status === 'published' ? 'primary' : 'secondary'}
            label={isDraftish ? t('seller.product.saveDraft') : t('common.save')}
            loading={save.isPending && save.variables !== 'publish'}
            disabled={busy || !canEdit}
            onPress={() => submit(isDraftish ? 'draft' : 'keep')}
          />
          {product && status !== 'archived' ? (
            <Button variant="ghost" label={t('seller.product.archive')} disabled={busy || !canEdit} onPress={() => setConfirmArchive(true)} />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function VariantCard({
  index,
  v,
  errors,
  skuConflict,
  onChange,
  onRemove,
}: {
  index: number;
  v: VariantDraft;
  errors: VariantErrors;
  skuConflict: string | null;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemove?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const err = (code?: string) => (code ? t(`seller.variant.err.${code}` as MessageKey) : null);
  return (
    <Card style={{ marginBottom: spacing.md, gap: 0 }}>
      <View style={styles.cardHead}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t('seller.variant.n', { n: index + 1 })}
        </Text>
        {onRemove ? <IconButton icon="trash-outline" color={colors.danger} label={t('seller.variant.remove')} onPress={onRemove} /> : null}
      </View>
      <TextField
        label={t('seller.variant.sku')}
        value={v.sku}
        onChangeText={(sku) => onChange({ sku })}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
        error={skuConflict ?? err(errors.sku)}
      />
      <TextField
        label={t('seller.variant.price')}
        value={v.price}
        onChangeText={(price) => onChange({ price })}
        keyboardType="decimal-pad"
        error={err(errors.price)}
      />
      <Chips
        scroll={false}
        options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))}
        value={v.currency as (typeof SELLER_CURRENCIES)[number]}
        onChange={(currency) => onChange({ currency })}
      />

      <Text variant="small" style={styles.label}>
        {t('seller.variant.options')}
      </Text>
      {v.options.map((o, oi) => (
        <View key={oi} style={styles.optionRow}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('seller.variant.optionName')}
              value={o.name}
              maxLength={40}
              onChangeText={(name) => onChange({ options: v.options.map((x, k) => (k === oi ? { ...x, name } : x)) })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('seller.variant.optionValue')}
              value={o.value}
              maxLength={80}
              onChangeText={(value) => onChange({ options: v.options.map((x, k) => (k === oi ? { ...x, value } : x)) })}
            />
          </View>
          <IconButton icon="close-circle-outline" color={colors.danger} label={t('seller.variant.removeOption')} onPress={() => onChange({ options: v.options.filter((_, k) => k !== oi) })} style={{ marginTop: 22 }} />
        </View>
      ))}
      {errors.options ? (
        <Text variant="small" color={colors.danger} style={{ marginBottom: spacing.sm }}>
          {err(errors.options)}
        </Text>
      ) : null}
      <Button
        variant="ghost"
        label={t('seller.variant.addOption')}
        disabled={v.options.length >= MAX_OPTIONS}
        onPress={() => onChange({ options: [...v.options, { name: '', value: '' }] })}
        style={{ marginBottom: spacing.md }}
      />

      {v.id ? (
        <Text variant="small" muted style={{ marginBottom: spacing.md }}>
          {t('seller.variant.stockCurrent', { n: v.stock })}
        </Text>
      ) : (
        <TextField
          label={t('seller.variant.stockInitial')}
          value={v.stock}
          onChangeText={(stock) => onChange({ stock })}
          keyboardType="number-pad"
          error={err(errors.stock)}
        />
      )}
      <View style={styles.switchRow}>
        <Text style={{ flex: 1 }}>{t('seller.variant.trackStock')}</Text>
        <Switch accessibilityLabel={t('seller.variant.trackStock')} value={v.trackStock} onValueChange={(trackStock) => onChange({ trackStock })} trackColor={{ true: colors.primary }} />
      </View>
      <View style={styles.switchRow}>
        <Text style={{ flex: 1 }}>{t('seller.variant.active')}</Text>
        <Switch accessibilityLabel={t('seller.variant.active')} value={v.active} onValueChange={(active) => onChange({ active })} trackColor={{ true: colors.primary }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', marginBottom: spacing.xs },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  photoCell: { width: 104, alignItems: 'center' },
  photo: { width: 104, height: 104, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2 },
  photoState: { alignItems: 'center', justifyContent: 'center' },
  photoActions: { flexDirection: 'row' },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  optionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
});
