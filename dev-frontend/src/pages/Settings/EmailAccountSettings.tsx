// EmailAccountSettings — Q mail M1 사용자 등록 UI
// 워크스페이스 설정 → 메일 계정. admin 전용.
// PageShell + 계정 목록 + 등록/수정 모달 (DetailDrawer) + 서비스 preset + 연결 테스트.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { startAuthRedirect } from '../../services/oauth';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import DetailDrawer from '../../components/Common/DetailDrawer';
import TrustNote from '../../components/Common/TrustNote';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import {
  listEmailAccounts, createEmailAccount, updateEmailAccount, deleteEmailAccount,
  testEmailAccount, setDefaultEmailAccount, syncNowEmailAccount,
  MAIL_PRESETS,
  type EmailAccountRow, type EmailAccountInput,
} from '../../services/mail';
import MailRulesSection from './MailRulesSection';
import MailSignatureSection from './MailSignatureSection';
import MailNotifyScopeSection from './MailNotifyScopeSection';
import MailAliasSection from './MailAliasSection';
import MailExtraFoldersSection from './MailExtraFoldersSection';
import MailDomainRuleSection from './MailDomainRuleSection';
import MailAuthDiagSection from './MailAuthDiagSection';
import { useSettingsHeaderAction } from './settingsHeaderAction';
import { formatDay } from '../../utils/dateFormat';
import {
  APP_PASSWORD_GUIDES, IMAP_ERROR_GUIDE, hostToGuideKey, detectPresetByEmail, ConnectGuide,
  type TwoStepAnswer, type MailFormField,
} from './MailConnectGuide';

// Gmail 원클릭(OAuth) 연결 버튼 — Google 앱 심사(mail.google.com 제한 scope) 통과 전까지 숨긴다.
// 심사 완료 시 true 로만 바꾸면 됨. 그 전에도 Gmail 을 포함한 모든 메일이 "앱 비밀번호" 방식으로 정상 연결된다.
const GMAIL_ONECLICK_ENABLED = false;

const EmailAccountSettings: React.FC = () => {
  const { t } = useTranslation('qmail');
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
          <AccountEditForm
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

// ─── 등록/편집 form ─────────────────────────────
interface FormProps {
  initial: EmailAccountRow | null;
  businessId: number;
  scope: 'team' | 'personal';
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

const AccountEditForm: React.FC<FormProps> = ({ initial, businessId, scope, onSaved, onClose }) => {
  const { t } = useTranslation('qmail');
  const isEdit = !!initial;
  const [preset, setPreset] = useState<string>(isEdit ? 'custom' : 'gmail');
  const [form, setForm] = useState<EmailAccountInput & { imap_password: string; smtp_password: string }>({
    email: initial?.email || '',
    display_name: initial?.display_name || '',
    imap_host: initial?.imap_host || MAIL_PRESETS[0].imap_host,
    imap_port: initial?.imap_port || MAIL_PRESETS[0].imap_port,
    imap_username: initial?.imap_username || '',
    imap_password: '',
    imap_tls: initial?.imap_tls ?? true,
    imap_folder: initial?.imap_folder || 'INBOX',
    smtp_host: initial?.smtp_host || MAIL_PRESETS[0].smtp_host,
    smtp_port: initial?.smtp_port || MAIL_PRESETS[0].smtp_port,
    smtp_username: initial?.smtp_username || '',
    smtp_password: '',
    smtp_tls: initial?.smtp_tls ?? true,
    is_active: initial?.is_active ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  // ★ 실패는 «어느 칸» 과 함께 둔다 — 옛날엔 폼 맨 아래 상자 하나라 데스크탑·태블릿에서는 스크롤 밖에 떠
  //   «눌렀는데 아무 일도 안 일어남» 으로 읽혔다(2026-11-06 Irene «경고문구가 맨 아래에 떠서 모르는데»).
  //   빈칸·형식(화면 검사) = 그 칸으로 보내고 칸 밑에 이유 / 서버 거절 = 드로어 맨 위 경고 줄 + 문제 칸 표시 + [해당 칸으로 이동].
  const [error, setError] = useState<{ msg: string; field: MailFormField | null; server: boolean } | null>(null);
  const [twoStep, setTwoStep] = useState<TwoStepAnswer>(null);
  const [guideEmph, setGuideEmph] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<MailFormField, HTMLInputElement | null>>>({});
  const bindField = (f: MailFormField) => (el: HTMLInputElement | null) => { fieldRefs.current[f] = el; };
  const focusField = useCallback((f: MailFormField | null) => {
    const el = f ? fieldRefs.current[f] : null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!error) return;
    if (error.server) {
      // 경고는 폼 첫 줄이다 — 굴러가는 상자를 맨 위로 올린다. scrollIntoView 는 폰에서 상자 안 고정 머리줄(뒤로·제목)
      //   밑으로 경고를 밀어 넣어 가렸다(390 실측). 상자를 못 찾으면 그때만 scrollIntoView.
      const el = alertRef.current;
      let box: HTMLElement | null = el?.parentElement || null;
      while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTo({ top: 0, behavior: 'smooth' });
      else el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    } else {
      focusField(error.field);
    }
  }, [error, focusField]);
  const isBad = (f: MailFormField) => error?.field === f;
  // 그 칸을 다시 고치기 시작하면 표시를 거둔다(다른 칸을 고칠 때는 그대로)
  const touch = (f: MailFormField) => { if (error?.field === f) { setError(null); setGuideEmph(false); } };
  const fieldError = (f: MailFormField) => (error && !error.server && error.field === f)
    ? <FieldError data-testid={`mail-field-error-${f}`}>{error.msg}</FieldError> : null;

  const onPresetChange = (key: string) => {
    setPreset(key);
    const p = MAIL_PRESETS.find(x => x.key === key);
    if (p && p.imap_host) {
      setForm(prev => ({
        ...prev,
        imap_host: p.imap_host,
        imap_port: p.imap_port,
        smtp_host: p.smtp_host,
        smtp_port: p.smtp_port,
      }));
    }
  };

  // Gmail·Naver·Outlook·iCloud 는 계정 비밀번호로 IMAP 연결이 안 되고 앱 비밀번호를 발급해야 한다.
  // 항목명을 "비밀번호" 로만 두면 계정 비밀번호를 넣고 실패하는 사고가 반복 → 항목명 자체를 바꾼다.
  const appPwHost = hostToGuideKey(form.imap_host);
  const usesAppPassword = appPwHost === 'gmail' || appPwHost === 'naver' || appPwHost === 'outlook' || appPwHost === 'icloud';
  const passwordLabel = usesAppPassword
    ? (t('settings.fieldAppPassword', '앱 비밀번호') as string)
    : (t('settings.fieldPassword', '비밀번호') as string);

  const onSubmit = async () => {
    setError(null);
    setGuideEmph(false);
    const local = (msg: string, field: MailFormField) => setError({ msg, field, server: false });
    if (!form.email || !form.email.includes('@')) {
      local(t('settings.emailInvalid', '올바른 이메일을 입력하세요') as string, 'email');
      return;
    }
    if (!form.imap_host) { local(t('settings.imapHostRequired') as string, 'imap_host'); return; }
    if (!form.imap_username) { local(t('settings.imapUserRequired') as string, 'imap_username'); return; }
    if (!isEdit && !form.imap_password) {
      local(usesAppPassword
        ? (t('settings.appPasswordRequired', '앱 비밀번호를 입력하세요') as string)
        : (t('settings.passwordRequired', '비밀번호를 입력하세요') as string), 'imap_password');
      return;
    }
    setSubmitting(true);
    try {
      const payload: EmailAccountInput = {
        email: form.email,
        display_name: form.display_name || null,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_username: form.imap_username,
        imap_tls: form.imap_tls,
        imap_folder: form.imap_folder,
        smtp_host: form.smtp_host || null,
        smtp_port: form.smtp_port || null,
        smtp_username: form.smtp_username || null,
        smtp_tls: form.smtp_tls,
        is_active: form.is_active,
      };
      // 비밀번호는 입력된 경우에만 전송 (편집 시 변경 안 함)
      if (form.imap_password) payload.imap_password = form.imap_password;
      if (form.smtp_password) payload.smtp_password = form.smtp_password;

      if (isEdit) {
        await updateEmailAccount(businessId, initial!.id, payload);
      } else {
        await createEmailAccount(businessId, { ...payload, scope });
      }
      await onSaved();
    } catch (e) {
      const code = (e as Error).message;
      const guide = IMAP_ERROR_GUIDE[code];
      if (guide?.preset && guide.preset !== preset) setPreset(guide.preset); // 해당 provider 안내 박스 표시
      if (guide?.twoStepOff) setTwoStep('off');   // 구글이 거절 = 2단계 인증부터 의심 → 그 안내를 펼친다
      setGuideEmph(!!guide?.preset && guide.field === 'imap_password');
      setError({ msg: guide ? (t(guide.key, guide.def) as string) : code, field: guide?.field || null, server: true });
    } finally {
      setSubmitting(false);
    }
  };

  const currentPreset = MAIL_PRESETS.find(p => p.key === preset);

  return (
    <>
      <DetailDrawer.Header onClose={onClose}>
        <DrawerTitle>{isEdit ? t('settings.editTitle', '메일 계정 편집') as string : t('settings.addTitle', '메일 계정 등록') as string}</DrawerTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <Form>
          {error?.server && (
            <ErrorBox ref={alertRef} role="alert" tabIndex={-1} data-testid="mail-form-alert">
              <span>{error.msg}</span>
              {error.field && (
                <JumpBtn type="button" onClick={() => focusField(error.field)}>
                  {t('settings.jumpToField') as string}
                </JumpBtn>
              )}
            </ErrorBox>
          )}
          {!isEdit && (
            <ScopeNote $personal={scope === 'personal'}>
              {scope === 'personal'
                ? t('settings.scopeNotePersonal', '개인 메일 — 나에게만 보입니다.') as string
                : t('settings.scopeNoteTeam', '회사 공용 메일 — 모든 팀원이 인박스에서 함께 봅니다.') as string}
            </ScopeNote>
          )}
          {!isEdit && (
            <Field>
              <Label>{t('settings.preset', '서비스') as string}</Label>
              <PlanQSelect
                size="sm" isSearchable={false}
                value={{ value: preset, label: currentPreset?.label || 'Custom' }}
                onChange={(opt) => onPresetChange((opt as PlanQSelectOption | null)?.value as string || 'custom')}
                options={MAIL_PRESETS.map(p => ({ value: p.key, label: p.label }))}
              />
              {APP_PASSWORD_GUIDES[preset] && (
                <ConnectGuide guide={APP_PASSWORD_GUIDES[preset]} twoStep={twoStep} onTwoStep={setTwoStep} emphasize={guideEmph} />
              )}
            </Field>
          )}
          {isEdit && hostToGuideKey(form.imap_host) && APP_PASSWORD_GUIDES[hostToGuideKey(form.imap_host)!] && (
            <ConnectGuide guide={APP_PASSWORD_GUIDES[hostToGuideKey(form.imap_host)!]} twoStep={twoStep} onTwoStep={setTwoStep} emphasize={guideEmph} />
          )}

          <Field>
            <Label>{t('settings.fieldEmail', '이메일') as string} <Required>*</Required></Label>
            <Input
              type="email" value={form.email}
              ref={bindField('email')} $invalid={isBad('email')} aria-invalid={isBad('email') || undefined}
              onChange={e => {
                touch('email');
                const email = e.target.value;
                // ★ 아이디 칸은 이메일을 **계속 따라간다**(사용자가 따로 고치기 전까지). 여태 `빈 칸일 때만` 채워서
                //   첫 글자에서 멈췄다 — 운영 네이버 계정의 보내기 아이디가 한 글자로 저장돼 발송이 전부 거절됐다.
                const follows = (v?: string | null) => !v || v === form.email;
                setForm({
                  ...form, email,
                  imap_username: follows(form.imap_username) ? email : form.imap_username,
                  smtp_username: follows(form.smtp_username) ? email : form.smtp_username,
                });
                // 도메인 자동 감지 → 서버 정보 자동 완성 + provider 안내 표시
                const auto = detectPresetByEmail(email);
                if (!isEdit && auto && auto !== preset) onPresetChange(auto);
              }}
              placeholder={t('settings.emailPh', 'contact@회사.com') as string}
              disabled={isEdit}
            />
            {fieldError('email')}
          </Field>

          <Field>
            {/* 이 값이 그대로 고객 메일함의 발신자 이름이 된다 — 항목명을 표시 이름이라고만 두니
                구글이 정한 계정명(예: IRENE WP)이 브랜드 대신 나가는 사고가 났다. */}
            <Label>{t('settings.fieldFromName', '발신 이름') as string}</Label>
            <Input
              type="text" value={form.display_name || ''}
              onChange={e => setForm({ ...form, display_name: e.target.value })}
              placeholder={t('settings.fromNamePh', '예: PlanQ · 회사 고객지원') as string}
            />
            <FieldHint>{t('settings.fromNameHint', '받는 사람 메일함에 이 이름으로 표시돼요. 비우면 메일 주소만 보입니다.') as string}</FieldHint>
          </Field>

          <SectionTitle>{t('settings.imapSection', '받기 (IMAP)') as string}</SectionTitle>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string} <Required>*</Required></Label>
              <Input
                type="text" value={form.imap_host}
                ref={bindField('imap_host')} $invalid={isBad('imap_host')} aria-invalid={isBad('imap_host') || undefined}
                onChange={e => { touch('imap_host'); setForm({ ...form, imap_host: e.target.value }); }}
                placeholder={t('settings.imapHostPh', 'imap.회사.com') as string}
              />
              {fieldError('imap_host')}
            </Field>
            <Field>
              <Label>{t('settings.fieldPort', '포트') as string}</Label>
              <Input
                type="number" value={form.imap_port}
                onChange={e => setForm({ ...form, imap_port: Number(e.target.value) || 993 })}
              />
            </Field>
          </Grid2>
          <Field>
            <Label>{t('settings.fieldUsername', '사용자명') as string} <Required>*</Required></Label>
            <Input
              type="text" value={form.imap_username}
              ref={bindField('imap_username')} $invalid={isBad('imap_username')} aria-invalid={isBad('imap_username') || undefined}
              onChange={e => { touch('imap_username'); setForm({ ...form, imap_username: e.target.value }); }}
              placeholder={form.email}
            />
            {fieldError('imap_username')}
          </Field>
          <Field>
            <Label>
              {passwordLabel}
              {!isEdit && <Required>*</Required>}
              {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}
            </Label>
            <Input
              type="password" value={form.imap_password}
              ref={bindField('imap_password')} $invalid={isBad('imap_password')} aria-invalid={isBad('imap_password') || undefined}
              /* 앱비밀번호 provider 만 공백 제거 — 일반 IMAP 은 중간 공백이 유효한 비밀번호일 수 있어
                 입력 자체를 막으면 안 된다 (백엔드 normalizeImapPassword 와 같은 기준). */
              onChange={e => (touch('imap_password'), setForm({
                ...form,
                imap_password: usesAppPassword ? e.target.value.replace(/[\s\u00A0]/g, '') : e.target.value,
              }))}
              autoComplete="new-password"
              placeholder={usesAppPassword ? (t('settings.appPasswordPh', '계정 비밀번호가 아닌, 발급받은 앱 비밀번호') as string) : undefined}
            />
            {fieldError('imap_password')}
          </Field>

          <SectionTitle>{t('settings.smtpSection', '보내기 (SMTP)') as string} <Optional>{t('settings.optional', '선택') as string}</Optional></SectionTitle>
          <SmtpHint>{t('settings.smtpHint', 'SMTP 정보를 비우면 PlanQ 기본 발송 서버를 사용합니다.') as string}</SmtpHint>
          <Grid2>
            <Field>
              <Label>{t('settings.fieldHost', '서버') as string}</Label>
              <Input
                type="text" value={form.smtp_host || ''}
                ref={bindField('smtp_host')} $invalid={isBad('smtp_host')} aria-invalid={isBad('smtp_host') || undefined}
                onChange={e => { touch('smtp_host'); setForm({ ...form, smtp_host: e.target.value }); }}
                placeholder={t('settings.smtpHostPh', 'smtp.회사.com') as string}
              />
            </Field>
            <Field>
              <Label>{t('settings.fieldPort', '포트') as string}</Label>
              <Input
                type="number" value={form.smtp_port || ''}
                onChange={e => setForm({ ...form, smtp_port: Number(e.target.value) || null })}
              />
            </Field>
          </Grid2>
          <Field>
            <Label>{t('settings.fieldUsername', '사용자명') as string}</Label>
            <Input
              type="text" value={form.smtp_username || ''}
              ref={bindField('smtp_username')} $invalid={isBad('smtp_username')} aria-invalid={isBad('smtp_username') || undefined}
              onChange={e => { touch('smtp_username'); setForm({ ...form, smtp_username: e.target.value }); }}
            />
          </Field>
          <Field>
            <Label>{passwordLabel} {isEdit && <PasswordHint>{t('settings.passwordEditHint', '(비워두면 기존 유지)') as string}</PasswordHint>}</Label>
            <Input
              type="password" value={form.smtp_password}
              ref={bindField('smtp_password')} $invalid={isBad('smtp_password')} aria-invalid={isBad('smtp_password') || undefined}
              onChange={e => { touch('smtp_password'); setForm({ ...form, smtp_password: e.target.value }); }}
              autoComplete="new-password"
            />
          </Field>

          <TrustNote spot="mailConnect" />
        </Form>
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionBtn type="button" onClick={onClose} disabled={submitting}>
          {t('settings.cancel', '취소') as string}
        </ActionBtn>
        <PrimaryBtn type="button" onClick={onSubmit} disabled={submitting}>
          {submitting ? t('settings.saving', '저장 중...') as string : isEdit ? t('settings.save', '저장') as string : t('settings.add', '등록') as string}
        </PrimaryBtn>
      </DetailDrawer.Footer>
    </>
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
const ScopeNote = styled.div<{ $personal: boolean }>`
  font-size: 0.75rem; font-weight: 600; line-height: 1.5;
  padding: 10px 12px; border-radius: 8px;
  background: ${p => p.$personal ? '#F8FAFC' : '#EFF6FF'};
  color: ${p => p.$personal ? '#475569' : '#1E40AF'};
  border: 1px solid ${p => p.$personal ? '#E2E8F0' : '#BFDBFE'};
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
const AddBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600;
  cursor: pointer;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const PrimaryBtn = styled(AddBtn)``;
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
const EmailRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const Email = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
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
const ActionBtn = styled.button`
  height: 30px; padding: 0 12px;
  background: transparent; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const DangerActionBtn = styled(ActionBtn)`
  color: #B91C1C; border-color: #FECACA;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;
const DangerBtn = styled(AddBtn)`
  background: #EF4444;
  &:hover { background: #DC2626; }
`;
// 모달 (DetailDrawer)
const DrawerTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Form = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 5px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 4px;`;
const FieldHint = styled.span`font-size: 0.6875rem; font-weight: 500; color: #94A3B8; line-height: 1.5;`;
const Required = styled.span`color: #EF4444;`;
const PasswordHint = styled.span`font-size: 0.6875rem; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Optional = styled.span`font-size: 0.6875rem; color: #94A3B8; font-weight: 500; margin-left: 4px;`;
const Input = styled.input<{ $invalid?: boolean }>`
  height: 36px; padding: 0 10px;
  border: 1px solid ${p => p.$invalid ? '#FCA5A5' : '#E2E8F0'}; border-radius: 6px;
  background: ${p => p.$invalid ? '#FEF2F2' : '#FFFFFF'};
  font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const Grid2 = styled.div`display: grid; grid-template-columns: 2fr 1fr; gap: 10px;`;
const SectionTitle = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
  margin-top: 8px; padding-top: 12px;
  border-top: 1px solid #E2E8F0;
  display: flex; align-items: center;
`;
const SmtpHint = styled.div`font-size: 0.6875rem; color: #64748B; line-height: 1.5; padding: 8px 10px; background: #F8FAFC; border-radius: 6px;`;
const ErrorBox = styled.div`
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 10px 12px; line-height: 1.55;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 0.75rem; color: #B91C1C;
  &:focus { outline: none; }
`;
const JumpBtn = styled.button`
  all: unset; cursor: pointer; font-weight: 700; color: #991B1B; text-decoration: underline;
  &:focus-visible { outline: 2px solid #FCA5A5; outline-offset: 2px; border-radius: 2px; }
`;
const FieldError = styled.span`font-size: 0.6875rem; font-weight: 600; color: #B91C1C; line-height: 1.5;`;
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
