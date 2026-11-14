// EmailAccountSettings — Q mail M1 사용자 등록 UI
// 워크스페이스 설정 → 메일 계정. admin 전용.
// PageShell + 계정 목록 + 등록/수정 모달 (DetailDrawer) + 서비스 preset + 연결 테스트.
import React, { useState, useEffect, useCallback } from 'react';
import { startAuthRedirect } from '../../services/oauth';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import DetailDrawer from '../../components/Common/DetailDrawer';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import {
  listEmailAccounts, updateEmailAccount, deleteEmailAccount,
  testEmailAccount, setDefaultEmailAccount, syncNowEmailAccount,
  type EmailAccountRow,
} from '../../services/mail';
import MailRulesSection from './MailRulesSection';
import MailSignatureSection from './MailSignatureSection';
import MailNotifyScopeSection from './MailNotifyScopeSection';
import MailAliasSection from './MailAliasSection';
import MailExtraFoldersSection from './MailExtraFoldersSection';
import MailDomainRuleSection from './MailDomainRuleSection';
import MailAuthDiagSection from './MailAuthDiagSection';
import MailAccountEditForm, { ActionBtn, PrimaryBtn, AddBtn } from './MailAccountEditForm';
import MailResponsibleSection, { type MailMemberOption } from './MailResponsibleSection';
import { displayName, type NameLocalizable } from '../../utils/displayName';
import { useSettingsHeaderAction } from './settingsHeaderAction';
import { formatDay } from '../../utils/dateFormat';
import { IMAP_ERROR_GUIDE } from './MailConnectGuide';

// Gmail 원클릭(OAuth) 연결 버튼 — Google 앱 심사(mail.google.com 제한 scope) 통과 전까지 숨긴다.
// 심사 완료 시 true 로만 바꾸면 됨. 그 전에도 Gmail 을 포함한 모든 메일이 "앱 비밀번호" 방식으로 정상 연결된다.
const GMAIL_ONECLICK_ENABLED = false;

const EmailAccountSettings: React.FC = () => {
  const { t, i18n } = useTranslation('qmail');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const isAdmin = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';
  // 스코프 뷰 — ?scope=personal (내 메일 계정) vs 회사 공용(회사 메일). 메뉴 진입로가 범위를 결정.
  const [searchParams, setSearchParams] = useSearchParams();
  const personalView = searchParams.get('scope') === 'personal';

  // 화면의 주요 액션은 PageShell 헤더 우측이 정본 자리다(페이지 레이아웃 표준).
  //   ★ 권한 술어(personalView || isAdmin)는 여기 한 곳에만 둔다 — 부모의 isAdmin 은
  //     'admin' 역할이 빠져 있어 부모가 그리면 워크스페이스 admin 이 버튼을 못 본다.
  const openNewAccount = useCallback(() => setEditing('new'), []);
  const canAddAccount = personalView || isAdmin;
  const addLabel = t('settings.add', '계정 추가') as string;
  useSettingsHeaderAction(canAddAccount ? { label: addLabel, onClick: openNewAccount, add: true } : null);
  // Gmail OAuth 콜백 실패 (?gmail_error=) — 심사 전 거부를 사용자가 인지하게 배너 표시
  const gmailError = searchParams.get('gmail_error');
  const dismissGmailError = () => setSearchParams((prev) => {
    const n = new URLSearchParams(prev);
    n.delete('gmail_error');
    return n;
  }, { replace: true });
  // F-2 — 뷰가 범위를 결정. 개인 뷰=개인, 회사 뷰=회사 공용. (옛 ScopeToggle 은 회사 뷰에서 개인
  //   계정을 추가하면 리스트에서 즉시 사라지는 유령계정 함정을 만들어 제거.)
  const addScope: 'team' | 'personal' = personalView ? 'personal' : 'team';

  const [accounts, setAccounts] = useState<EmailAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailAccountRow | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; error: string | null; imap_ok?: boolean; smtp_ok?: boolean | null; smtp_error?: string | null }>>({});

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const rows = await listEmailAccounts(businessId);
      setAccounts(rows);
    } catch (_) { /* skip */ } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // 책임자 고르기·표시용 멤버(ai·수락 전 초대 제외). 이름은 워크스페이스 표시명(공용 헬퍼).
  const [members, setMembers] = useState<MailMemberOption[]>([]);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    (async () => {
      try {
        const j = await apiFetch(`/api/businesses/${businessId}/members`).then(r => r.json());
        if (!alive || !j.success) return;
        setMembers((j.data || [])
          .filter((m: { user_id: number | null; role?: string }) => m.user_id && m.role !== 'ai')
          .map((m: { user_id: number; user?: NameLocalizable | null }) => ({
            user_id: m.user_id, name: displayName(m.user, i18n.language) || `#${m.user_id}`,
          })));
      } catch { /* 이름 없이도 화면은 돈다 */ }
    })();
    return () => { alive = false; };
  }, [businessId, i18n.language]);
  const memberName = (uid?: number | null) => (uid ? members.find(m => m.user_id === uid)?.name : undefined);

  // ★ 훅은 전부 early return **위**에. 아래에 두면 businessId 가 늦게 잡히는 렌더(새로고침 직후)
  //   다음에 훅이 7→8 개로 늘어 React 가 "Rendered more hooks than during the previous render"
  //   (프로덕션 React #310) 로 페이지를 통째로 죽인다. AiTaskCreateModal 과 같은 종류 —
  //   tsc·가드는 못 잡고 eslint `react-hooks/rules-of-hooks` 만 잡는다.
  const [connErr, setConnErr] = useState<string | null>(null);

  if (!businessId) {
    return <Empty>{t('settings.noWorkspace', '워크스페이스를 먼저 선택하세요') as string}</Empty>;
  }

  // 보내기 실패 코드 → 같은 안내 문구 표(IMAP_ERROR_GUIDE)에서 읽는다. 문구를 두 곳에 쓰지 않는다
  const smtpErrorText = (code?: string | null) => {
    const g = code ? IMAP_ERROR_GUIDE[code] : undefined;
    return g ? (t(g.key, g.def) as string) : '';
  };
  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const r = await testEmailAccount(businessId, id);
      setTestResult(prev => ({ ...prev, [id]: r }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultEmailAccount(businessId, id);
      await load();
    } catch (_) { /* skip */ }
  };

  const handleSyncNow = async (id: number) => {
    try {
      await syncNowEmailAccount(businessId, id);
      await load();
    } catch (_) { /* skip */ }
  };

  // #109 — 개인 ↔ 회사 공용 전환 (실수로 반대로 추가한 경우 되돌리기). admin 만 노출.
  const handleChangeScope = async (acc: EmailAccountRow) => {
    try {
      await updateEmailAccount(businessId, acc.id, { scope: acc.is_personal ? 'team' : 'personal' });
      await load();
    } catch (_) { /* skip */ }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteEmailAccount(businessId, id);
      await load();
      setDeletingId(null);
    } catch (_) { /* skip */ }
  };

  const formatLastSync = (iso: string | null): string => {
    if (!iso) return t('settings.neverSynced', '아직 sync 안 됨') as string;
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('settings.justNow', '방금') as string;
    if (mins < 60) return t('settings.minutesAgo', '{{n}}분 전', { n: mins }) as string;
    if (mins < 1440) return t('settings.hoursAgo', '{{n}}시간 전', { n: Math.floor(mins / 60) }) as string;
    return formatDay(d, { year: 'always' });
  };

  const connectGmail = async () => {
    // #82/#72 — apiFetch(Bearer) 로 auth_url 받아 이동. 옛 window.location 직접진입은
    // 브라우저 네비게이션이 토큰 미전달 → 401 "Access token required".
    setConnErr(null);
    // F-3 — 개인 뷰면 ?scope=personal 로 복귀(콜백이 쿼리 보존하도록 백엔드 수정 동반).
    const ret = encodeURIComponent(personalView
      ? '/business/settings/mail-accounts?scope=personal'
      : '/business/settings/mail-accounts');
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/oauth/gmail/initiate?return_to=${ret}&scope=${addScope}`);
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) throw new Error(j.message || 'init_failed');
      startAuthRedirect(j.data.auth_url);
    } catch (e) {
      setConnErr((e as Error).message || (t('settings.connectFailed', { defaultValue: 'Gmail 연결을 시작하지 못했어요. 잠시 후 다시 시도해주세요.' }) as string));
    }
  };

  const renderCard = (acc: EmailAccountRow) => (
    <AccountCard key={acc.id}>
      <CardHeader>
        <EmailInfo>
          <EmailRow>
            <Email>{acc.email}</Email>
            {acc.is_personal
              ? <PersonalBadge>{t('settings.scopePersonal', '개인') as string}</PersonalBadge>
              : <TeamBadge>{t('settings.scopeTeam', '회사 공용') as string}</TeamBadge>}
            {/* 책임자 — 지정했을 때만(Irene «설정을 한 경우에만 나오는 거야») */}
            {!acc.is_personal && memberName(acc.responsible_user_id) && (
              <ResponsibleBadge>{t('responsible.chip', { name: memberName(acc.responsible_user_id) }) as string}</ResponsibleBadge>
            )}
            {acc.is_default && <DefaultBadge>{t('settings.default', '기본') as string}</DefaultBadge>}
            {!acc.is_active && <InactiveBadge>{t('settings.inactive', '비활성') as string}</InactiveBadge>}
            {acc.needs_reconnect && <ErrorBadge>{t('settings.needsReconnect') as string}</ErrorBadge>}
          </EmailRow>
          {acc.display_name && <DisplayName>{acc.display_name}</DisplayName>}
          <MetaRow>
            <MetaItem>IMAP: {acc.imap_host}:{acc.imap_port}</MetaItem>
            <MetaItem>•</MetaItem>
            <MetaItem>{t('settings.lastSync', '마지막 동기화') as string}: {formatLastSync(acc.last_sync_at)}</MetaItem>
            {acc.fail_count > 0 && <ErrorBadge>{t('settings.failCount', '{{n}}회 실패', { n: acc.fail_count }) as string}</ErrorBadge>}
          </MetaRow>
          {acc.last_sync_error && <ErrorMsg>⚠️ {acc.last_sync_error}</ErrorMsg>}
          {/* 재인증 안내 — 판정은 서버(needs_reconnect) 단일 원천. 근거: services/emailAccountHealth.js */}
          {acc.needs_reconnect && (
            <FixHint>
              {acc.reauth_kind === 'oauth'
                // 원클릭 재연결은 구글 앱 심사 통과 전까지 막혀 있다. 그 상태에서 "다시 연결하세요" 라고만
                //   안내하면 사용자는 누를 버튼이 없다 — 실제로 할 수 있는 길(앱 비밀번호)로 보낸다.
                ? (GMAIL_ONECLICK_ENABLED
                    ? t('settings.fixAuthOauth') as string
                    : t('settings.fixAuthOauthToPassword') as string)
                : (acc.imap_host || '').includes('gmail')
                  ? t('settings.fixAuthGmail') as string
                  : t('settings.fixAuthGeneric') as string}
              <ReconnectRow>
                {acc.reauth_kind === 'oauth' && GMAIL_ONECLICK_ENABLED ? (
                  <PrimaryBtn type="button" onClick={connectGmail}>
                    {t('settings.reconnectNow') as string}
                  </PrimaryBtn>
                ) : (
                  <PrimaryBtn type="button" onClick={() => setEditing(acc)}>
                    {t('settings.switchToAppPassword') as string}
                  </PrimaryBtn>
                )}
              </ReconnectRow>
            </FixHint>
          )}
          {testResult[acc.id] && (
            testResult[acc.id].ok ? (
              <TestSuccess>✓ {t('settings.testOk', '연결 성공') as string}</TestSuccess>
            ) : (
              /* 받기·보내기를 **따로** 말한다 — 받기는 되는데 보내기만 막힌 계정이 실제로 있었다(2026-09-21) */
              <TestError>✗ {testResult[acc.id].imap_ok && testResult[acc.id].smtp_ok === false
                ? `${t('settings.testSmtpFail', '받기는 정상이지만 보내기 로그인이 거절됐습니다.') as string} ${smtpErrorText(testResult[acc.id].smtp_error)}`
                : (testResult[acc.id].error || t('settings.testFail', '연결 실패') as string)}</TestError>
            )
          )}
        </EmailInfo>
        <CardActions>
          <ActionBtn type="button" onClick={() => handleTest(acc.id)} disabled={testingId === acc.id}>
            {testingId === acc.id ? t('settings.testing', '테스트 중...') as string : t('settings.test', '연결 테스트') as string}
          </ActionBtn>
          {!acc.is_default && !acc.is_personal && (
            <ActionBtn type="button" onClick={() => handleSetDefault(acc.id)}>
              {t('settings.setDefault', '기본으로') as string}
            </ActionBtn>
          )}
          <ActionBtn type="button" onClick={() => handleSyncNow(acc.id)}>
            {t('settings.syncNow', '지금 동기화') as string}
          </ActionBtn>
          <ActionBtn type="button" onClick={() => setEditing(acc)}>
            {t('settings.edit', '편집') as string}
          </ActionBtn>
          {isAdmin && (
            <ActionBtn type="button" onClick={() => handleChangeScope(acc)}
              title={t('settings.changeScopeHint', '이 계정을 개인/회사 공용으로 전환') as string}>
              {acc.is_personal
                ? t('settings.toTeam', '회사 공용으로') as string
                : t('settings.toPersonal', '개인으로 전환') as string}
            </ActionBtn>
          )}
          <DangerActionBtn type="button" onClick={() => setDeletingId(acc.id)}>
            {t('settings.deactivate', '비활성화') as string}
          </DangerActionBtn>
        </CardActions>
      </CardHeader>

      {/* ★ 이 세 섹션은 원래 CardHeader **안쪽 왼쪽 칸**에 있었다. 헤더는 좌우 2단(정보 | 버튼)이라
          긴 내용이 왼쪽 절반에 갇히고, 버튼 두 개뿐인 오른쪽 칸이 카드 높이만큼 빈 채로 남았다
          (1600px 화면 실측: 카드 920px 중 내용이 455px, 오른쪽 380px 공백).
          Irene: "버튼들 있는 아래에 내용이 안 나오고 우측에 여백이 너무 많이 생겨".
          카드 직계 자식으로 내려 **전체 폭**을 쓰게 한다. */}
        {/* 회사 공용 메일함 책임자 — 개인 메일함에는 없다 */}
        {!acc.is_personal && (
          <MailResponsibleSection
            key={`responsible-${acc.id}`}
            businessId={businessId}
            accountId={acc.id}
            initial={acc.responsible_user_id ?? null}
            members={members}
            canEdit={isAdmin}
            onSaved={(next) => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, responsible_user_id: next } : a))}
          />
        )}

        {/* 보내는 주소(Send-as) — 여러 도메인을 쓰는 메일함 */}
        <MailAliasSection
          businessId={businessId}
          accountId={acc.id}
          accountEmail={acc.email}
        />

        {/* #207 — 알림 범위. 계정 연결 직후 여기서 바로 고르게 한다 (기본 = 답변필요+확인권장) */}
        <MailNotifyScopeSection
          businessId={businessId}
          accountId={acc.id}
          initialScope={acc.notify_scope || 'recommended'}
        />

        {/* #235 — 업무 자동추출 범위. 같은 껍데기를 필드만 바꿔 쓴다(베끼면 갈라진다).
            기본 'off' — 켜는 것은 사용자 선택이다(비용이 드는 기능이라 opt-in). */}
        <MailNotifyScopeSection
          businessId={businessId}
          accountId={acc.id}
          field="auto_extract_scope"
          i18nPrefix="autoExtract"
          initialScope={acc.auto_extract_scope || 'off'}
          options={[
            { value: 'off', labelKey: 'autoExtract.off', descKey: 'autoExtract.offDesc' },
            { value: 'reply_needed', labelKey: 'autoExtract.replyNeeded', descKey: 'autoExtract.replyNeededDesc' },
            { value: 'recommended', labelKey: 'autoExtract.recommended', descKey: 'autoExtract.recommendedDesc' },
          ]}
        />

        {/* 업체 보낸편지함·스팸함 가져오기 — 계정 속성. 찾은 폴더 이름을 그대로 보여준다.
            key 로 계정마다 인스턴스를 가른다(초기값을 한 번만 읽는 컴포넌트다). */}
        <MailExtraFoldersSection
          key={`extra-folders-${acc.id}`}
          businessId={businessId}
          accountId={acc.id}
          initial={acc.extra_folders}
        />

        {/* 서명 — 계정마다 등록 (발송 시 백엔드가 본문 끝에 붙인다) */}
        <MailSignatureSection
          businessId={businessId}
          accountId={acc.id}
          initialHtml={acc.signature_html ?? null}
          initialHtmlEn={acc.signature_html_en ?? null}
          initialEnabled={acc.signature_enabled !== false}
        />
    </AccountCard>
  );

  const teamAccounts = accounts.filter(a => !a.is_personal);
  const personalAccounts = accounts.filter(a => a.is_personal);
  // 스코프 뷰에 따라 노출 계정 필터 — 개인 뷰=개인만, 회사 뷰=회사 공용만
  const visibleAccounts = personalView ? personalAccounts : teamAccounts;

  return (
    <Wrap>
      <Toolbar>
        {(personalView || isAdmin) ? (
          // "+ 계정 추가" 는 PageShell 헤더 우측으로 올라갔다(화면 표준). 여기 남는 것은
          //   Gmail 원클릭뿐이고 그건 지금 꺼져 있으므로, 켜져 있을 때만 줄을 만든다.
          GMAIL_ONECLICK_ENABLED ? (
          <ActionsRow>
            {GMAIL_ONECLICK_ENABLED && (
              <GoogleConnectBtn type="button" onClick={connectGmail}>
                <GoogleIcon viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </GoogleIcon>
                {t('settings.connectGmail', 'Gmail 로 연결') as string}
              </GoogleConnectBtn>
            )}
          </ActionsRow>
          ) : null
        ) : (
          // 회사 뷰의 비관리자 — 회사 공용 추가 불가. 개인 메일은 내 계정으로 안내.
          <MemberHint>
            {t('settings.teamMemberHintHead', '회사 공용 메일은 관리자만 추가할 수 있어요. 개인 메일은 ') as string}
            <MemberHintLink to="/business/settings/mail-accounts?scope=personal">
              {t('nav.myMailAccounts', '내 메일 계정') as string}
            </MemberHintLink>
            {t('settings.teamMemberHintTail', ' 에서 연결하세요.') as string}
          </MemberHint>
        )}
      </Toolbar>

      <Hint>{t('settings.hintScope', '회사 공용 메일은 모든 팀원이 인박스에서 함께 보고, 개인 메일은 본인에게만 보입니다. (5분마다 자동 동기화)') as string}</Hint>
      <Hint>{GMAIL_ONECLICK_ENABLED
        ? t('settings.hintOauth', 'Gmail 은 "Gmail 로 연결"(원클릭) 또는 앱 비밀번호로 연결할 수 있어요. 원클릭 연결이 안 되면 계정 추가에서 앱 비밀번호 방식을 사용하세요.') as string
        : t('settings.hintAppPassword', 'Gmail·Outlook·Naver 등은 "계정 추가"에서 서비스를 고르면 앱 비밀번호 연결 방법을 단계별로 안내해요. 회사 메일은 "직접 입력"으로 서버 정보를 넣으면 됩니다.') as string}</Hint>
      <Hint>{t('settings.hintNewMailOnly', '연결한 시점 이후에 도착한 새 메일부터 수신됩니다. 과거 메일은 가져오지 않아요.') as string}</Hint>
      {connErr && <ConnErr>{connErr}</ConnErr>}
      {gmailError && (
        <ConnErr>
          {gmailError === 'access_denied'
            ? t('settings.gmailOauthDenied', 'Google 연결이 완료되지 않았습니다 — 권한 요청을 취소했거나, PlanQ 의 Google 앱 심사가 끝나기 전이라 이 계정은 아직 원클릭 연결이 제한될 수 있어요. 아래 "계정 추가"에서 앱 비밀번호 방식으로 연결해 주세요.') as string
            : t('settings.gmailOauthFailed', 'Gmail 연결 실패: {{code}} — 잠시 후 다시 시도하거나 앱 비밀번호 방식을 사용해 주세요.', { code: gmailError }) as string}
          <DismissBtn type="button" onClick={dismissGmailError} aria-label={t('settings.dismiss', '닫기') as string}>×</DismissBtn>
        </ConnErr>
      )}

      {loading ? (
        <Loading>{t('settings.loading', '로드 중...') as string}</Loading>
      ) : visibleAccounts.length === 0 ? (
        <EmptyCard>
          <EmptyIcon>📬</EmptyIcon>
          <EmptyTitle>{t('settings.emptyTitle', '등록된 메일 계정이 없어요') as string}</EmptyTitle>
          <EmptyDesc>{t('settings.emptyDesc', 'Gmail · Outlook · 회사 메일 등 IMAP/SMTP 지원 계정을 등록하세요') as string}</EmptyDesc>
          <PrimaryBtn type="button" onClick={() => setEditing('new')}>{t('settings.addFirst', '첫 계정 등록') as string}</PrimaryBtn>
        </EmptyCard>
      ) : (
        <Group>
          <GroupTitle>
            {personalView
              ? t('settings.groupPersonal', '내 개인 메일') as string
              : t('settings.groupTeam', '회사 공용 메일') as string}
          </GroupTitle>
          <AccountList>{visibleAccounts.map(renderCard)}</AccountList>
        </Group>
      )}

      {/* 등록/편집 모달 */}
      <DetailDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        ariaLabel={editing === 'new' ? t('settings.addTitle', '메일 계정 등록') as string : t('settings.editTitle', '메일 계정 편집') as string}
      >
        {editing !== null && (
          <MailAccountEditForm
            initial={editing === 'new' ? null : editing}
            businessId={businessId}
            scope={editing === 'new' ? addScope : (editing.is_personal ? 'personal' : 'team')}
            onSaved={async () => { setEditing(null); await load(); }}
            onClose={() => setEditing(null)}
          />
        )}
      </DetailDrawer>

      {/* 삭제 확인 */}
      {deletingId !== null && (
        <ConfirmBackdrop onClick={() => setDeletingId(null)}>
          <ConfirmCard onClick={e => e.stopPropagation()}>
            <ConfirmTitle>{t('settings.confirmDeactivate', '계정을 비활성화할까요?') as string}</ConfirmTitle>
            <ConfirmDesc>{t('settings.confirmDeactivateDesc', '메일 동기화가 중단되지만 기존 메일은 보존됩니다.') as string}</ConfirmDesc>
            <ConfirmActions>
              <ActionBtn type="button" onClick={() => setDeletingId(null)}>{t('settings.cancel', '취소') as string}</ActionBtn>
              <DangerBtn type="button" onClick={() => handleDelete(deletingId)}>{t('settings.deactivate', '비활성화') as string}</DangerBtn>
            </ConfirmActions>
          </ConfirmCard>
        </ConfirmBackdrop>
      )}

      {/* 우리 도메인 — 워크스페이스 단위 수신 인식 규칙. 계정별 별칭(발신)과 다른 축이라 밖에 둔다. */}
      {!personalView && (
        <MailDomainRuleSection
          businessId={businessId}
          canEdit={isAdmin}
          accountEmails={teamAccounts.map(a => a.email)}
        />
      )}

      {/* 도메인 인증(발신 축) — "우리 도메인"(수신 축) 과 다른 축이라 옆에 나란히 둔다.
          여기는 "우리가 보낸 메일을 상대 서버가 믿어주는가" 다. */}
      {!personalView && <MailAuthDiagSection businessId={businessId} />}

      {/* 메일 분류 규칙 (학습형) — 워크스페이스 단위. 투명성 화면. */}
      {!personalView && <MailRulesSection businessId={businessId} />}
    </Wrap>
  );
};


export default EmailAccountSettings;

// ─── styled ────────────────────────────────────
const Wrap = styled.div`display: flex; flex-direction: column;`;
const Toolbar = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
`;
const MemberHint = styled.div`
  font-size: 0.8125rem; color: #64748B; line-height: 1.5;
`;
const MemberHintLink = styled(Link)`
  color: #0F766E; font-weight: 600; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const Group = styled.div`margin-bottom: 24px;`;
const GroupTitle = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #334155;
  margin-bottom: 10px;
`;
const TeamBadge = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
  background: #E0F2FE; color: #075985; border-radius: 12px;
`;
const PersonalBadge = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 12px;
`;
const Hint = styled.p`font-size: 0.8125rem; color: #64748B; margin: 0 0 20px; line-height: 1.6;`;
const ConnErr = styled.p`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 10px 12px; margin: 0 0 16px; line-height: 1.5;`;
const DismissBtn = styled.button`all: unset; cursor: pointer; float: right; font-size: 0.9375rem; line-height: 1; color: #B91C1C; padding: 0 2px; &:hover { opacity: 0.7; }`;
const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const EmptyCard = styled.div`
  padding: 40px 24px; text-align: center;
  background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;
`;
const EmptyIcon = styled.div`font-size: 2.5rem; margin-bottom: 12px;`;
const EmptyTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A; margin-bottom: 6px;`;
const EmptyDesc = styled.div`font-size: 0.8125rem; color: #64748B; margin-bottom: 16px;`;
const Empty = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
const ActionsRow = styled.div`display: flex; gap: 8px; align-items: center;`;
const GoogleConnectBtn = styled.button`
  display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px;
  background: #FFFFFF; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600;
  cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const GoogleIcon = styled.svg`width: 16px; height: 16px;`;

const AccountList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const AccountCard = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 18px 20px;
`;
const CardHeader = styled.div`display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap;`;
const EmailInfo = styled.div`display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 240px;`;
const EmailRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Email = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const ResponsibleBadge = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
  background: #F1F5F9; color: #334155; border-radius: 12px; white-space: nowrap;
`;
const DefaultBadge = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
  background: #CCFBF1; color: #0F766E; border-radius: 12px;
`;
const InactiveBadge = styled.span`
  font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
  background: #FEE2E2; color: #B91C1C; border-radius: 12px;
`;
const DisplayName = styled.div`font-size: 0.8125rem; color: #475569;`;
const MetaRow = styled.div`display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px;`;
const MetaItem = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const ErrorBadge = styled.span`
  font-size: 0.6875rem; font-weight: 600; padding: 2px 6px;
  background: #FEF3C7; color: #92400E; border-radius: 10px;
`;
const ErrorMsg = styled.div`font-size: 0.75rem; color: #B91C1C; margin-top: 6px; line-height: 1.4;`;
const FixHint = styled.div`font-size: 0.75rem; color: #B45309; margin-top: 4px; line-height: 1.4; padding: 6px 10px; background: #FFFBEB; border-radius: 6px;`;
const ReconnectRow = styled.div`margin-top: 8px;`;
const TestSuccess = styled.div`font-size: 0.75rem; color: #0F766E; font-weight: 600; margin-top: 6px;`;
const TestError = styled.div`font-size: 0.75rem; color: #B91C1C; font-weight: 600; margin-top: 6px;`;
const CardActions = styled.div`display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-start;`;
const DangerActionBtn = styled(ActionBtn)`
  color: #B91C1C; border-color: #FECACA;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;
const DangerBtn = styled(AddBtn)`
  background: #EF4444;
  &:hover { background: #DC2626; }
`;
// 모달 (DetailDrawer)
// confirm modal
const ConfirmBackdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; z-index: 9000;
  background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
`;
const ConfirmCard = styled.div`
  background: #FFFFFF; border-radius: 12px;
  padding: 20px; max-width: 420px; width: 100%;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 12px 40px rgba(15,23,42,0.2);
`;
const ConfirmTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const ConfirmDesc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const ConfirmActions = styled.div`display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;`;
