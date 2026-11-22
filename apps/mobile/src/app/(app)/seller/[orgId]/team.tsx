import { PersonField } from '../../../../components/PersonField';
import type { Person } from '../../../../people/logic';
import type { OrgMember, OrgRole } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { alertConfirm } from '../../../../lib/confirm';
import { useMembership } from '../../../../seller/api';
import { assignableRoles, canEditMember, canViewTeam, ROLE_PERMISSIONS, ROLES, TEAM_PERMISSIONS } from '../../../../seller/team-logic';
import { changeMemberRole, fetchMembers, inviteMember, removeMember, teamKeys } from '../../../../seller/team-api';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Text, TextField } from '../../../../ui';

/** Équipe d'une organisation : membres et invitations, changement de rôle, retrait, invitation et matrice « qui peut quoi ». */
export default function SellerTeam() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = canViewTeam(role);
  const roleOptions = (list: readonly OrgRole[]) => list.map((r) => ({ value: r, label: t(`seller.role.${r}` as MessageKey) }));
  const [handle, setHandle] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [inviteRole, setInviteRole] = useState<OrgRole>('employee');
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: teamKeys.members(orgId),
    queryFn: ({ pageParam }) => fetchMembers(orgId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!orgId && allowed,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: teamKeys.members(orgId) });
  const fail = (e: unknown) => {
    const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
    const text =
      e instanceof ApiRequestError && e.status === 404 ? t('mc.team.errUserNotFound')
      : reason === 'already_member' ? t('mc.team.errAlready')
      : reason === 'last_owner' ? t('mc.team.errLastOwner')
      : e instanceof ApiRequestError && e.status === 403 ? t('mc.team.errOwnersOnly')
      : sellerErrorMessage(e, t, locale);
    setNotice({ text, ok: false });
  };
  const invite = useMutation({
    mutationFn: () => inviteMember(orgId, handle, inviteRole),
    onSuccess: () => { setHandle(''); setNotice({ text: t('mc.team.sent'), ok: true }); void refresh(); },
    onError: fail,
  });
  const change = useMutation({
    mutationFn: (v: { userId: string; role: OrgRole }) => changeMemberRole(orgId, v.userId, v.role),
    onSuccess: () => { setEditing(null); setNotice(null); void refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(orgId, userId),
    onSuccess: () => { setNotice(null); void refresh(); },
    onError: fail,
  });

  const title = <Stack.Screen options={{ title: t('mc.team.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<EmptyState icon="lock-closed-outline" title={t('mc.team.forbidden')} /></>;
  const mine = assignableRoles(role);

  const header = (
    <View style={styles.pad}>
      {notice ? (
        <Text color={notice.ok ? colors.success : colors.danger} accessibilityLiveRegion="polite">
          {notice.text}
        </Text>
      ) : null}
      {mine.length > 0 ? (
        <View style={styles.col}>
          <SectionTitle>{t('mc.team.invite')}</SectionTitle>
          <PersonField label={t('mc.team.handle')} placeholder={t('pp.choose')} value={handle ? { handle, displayName: person?.displayName ?? handle, avatarUrl: person?.avatarUrl } : null} onChange={(x) => { setPerson(x); setHandle(x?.handle ?? ''); }} />
          <Text variant="small" muted>{t('mc.team.role')}</Text>
          <Chips flush options={roleOptions(mine)} value={inviteRole} onChange={setInviteRole} />
          <Button label={t('mc.team.send')} loading={invite.isPending} disabled={handle.trim().length < 3} onPress={() => invite.mutate()} />
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.pad}>
      <SectionTitle>{t('mc.team.matrix')}</SectionTitle>
      <Text variant="small" muted>{t('mc.team.matrixHint')}</Text>
      {ROLES.map((r) => (
        <Card key={r}>
          <Text variant="bodyStrong">{t(`seller.role.${r}` as MessageKey)}</Text>
          <Text variant="small" muted>
            {ROLE_PERMISSIONS[r].length === 0 ? t('mc.perm.none') : TEAM_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[r].includes(p)).map((p) => t(`mc.perm.${p}` as MessageKey)).join(' · ')}
          </Text>
        </Card>
      ))}
    </View>
  );

  const members = q.data?.pages.flatMap((pg) => pg.items) ?? [];
  const list = q.isPending ? (
    <Loading />
  ) : q.isError && members.length === 0 ? (
    <ErrorState error={q.error} onRetry={() => q.refetch()} />
  ) : members.length === 0 ? (
    <EmptyState icon="people-outline" title={t('mc.team.empty')} />
  ) : (
    <View style={styles.pad}>
      {members.map((item) => {
        const isSelf = item.userId === me?.id;
        const editable = canEditMember(role, item.role, isSelf);
        return (
          <Card key={item.userId}>
            <View style={styles.line}>
              <Text variant="bodyStrong" style={styles.flex}>
                {item.displayName} · @{item.handle}
                {isSelf ? ` (${t('mc.team.you')})` : ''}
              </Text>
              <Badge tone={item.status === 'active' ? 'primary' : 'neutral'} label={item.status === 'active' ? t(`seller.role.${item.role}` as MessageKey) : t('mc.team.invited')} />
            </View>
            {item.status === 'invited' ? <Text variant="small" muted>{t(`seller.role.${item.role}` as MessageKey)}</Text> : null}
            {editable ? (
              <View style={styles.col}>
                {editing === item.userId ? (
                  <Chips flush options={roleOptions(mine)} value={item.role} onChange={(r) => change.mutate({ userId: item.userId, role: r })} />
                ) : (
                  <Button variant="secondary" label={t('mc.team.changeRole', { name: item.displayName })} onPress={() => setEditing(item.userId)} />
                )}
                <Button
                  variant="ghost"
                  label={t('mc.team.remove', { name: item.displayName })}
                  onPress={() =>
                    alertConfirm(t('mc.team.removeTitle'), t('mc.team.removeBody', { name: item.displayName }), [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('mc.team.removeYes'), style: 'destructive', onPress: () => remove.mutate(item.userId) },
                    ])
                  }
                />
              </View>
            ) : null}
          </Card>
        );
      })}
      {q.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : null}
    </View>
  );

  return (
    <>
      {title}
      <ScrollView>
        {header}
        {list}
        {footer}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.sm },
  col: { gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
