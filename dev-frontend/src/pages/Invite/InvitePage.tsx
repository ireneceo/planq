import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import PublicPageShell from '../../components/Layout/PublicPageShell';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';

type InviteType = 'project_client' | 'workspace_client' | 'workspace_member';
interface InviteInfo {
  type: InviteType;
  already_linked: boolean;
  workspace_name?: string;
  project_name?: string;
  client_company?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  role?: string;
}

// 이 화면이 직접 사람 말로 바꾸는 코드 — 공용 매퍼로 보내면 «처리 중 오류 (…)» 가 된다.
const INVITE_CODES = ['already_accepted', 'already_member', 'email_mismatch', 'invalid_or_expired_invite', 'invite_expired', 'invite_not_found'];

const InvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`/api/invites/${token}`);
        const body = await r.json();
        if (!body.success) {
          // 404(없는 초대 — 취소·이미 처리)와 410(30일 지남)을 가른다. 한 문장으로 뭉치면 «30일인데 만료라니» 가 된다.
          if (body.message === 'invalid_or_expired_invite') { setError(r.status === 410 ? 'invite_expired' : 'invite_not_found'); return; }
          throw new Error(body.message || 'invalid_or_expired_invite');
        }
        setInfo(body.data);
      } catch (err: unknown) {
        setError(mapApiError(err, tErr));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!token || !user) return;
    setAccepting(true);
    try {
      const r = await apiFetch(`/api/invites/${token}/accept`, { method: 'POST' });
      const body = await r.json();
      // 같은 사람의 재수락(가입 직후·경합)은 서버가 성공으로 돌려준다. already_accepted 는 **남이 이미 받은 초대**다 —
      //   예전처럼 성공으로 삼키면 그 사람을 자기 대시보드로 보내 «합류했다» 고 오해하게 된다. 그대로 알린다.
      if (!body.success) {
        if (body.message === 'invalid_or_expired_invite') throw new Error(r.status === 410 ? 'invite_expired' : 'invite_not_found');
        throw new Error(body.message);
      }
      // 수락으로 새로 연결된 워크스페이스(고객)를 user 에 반영 — 무워크스페이스 가입 직후 진입 보장
      try { await refreshUser(); } catch { /* noop */ }
      navigate(body.data?.redirect || (info?.type === 'workspace_member' ? '/dashboard' : '/talk'));
    } catch (err: unknown) {
      // 초대 고유 코드는 이 화면의 errorLabel 이 사람 말로 바꾼다 — 공용 매퍼로 보내면 «처리 중 오류 (already_accepted)» 가 된다.
      const code = err instanceof Error ? err.message : '';
      setError(INVITE_CODES.includes(code) ? code : mapApiError(err, tErr));
    } finally {
      setAccepting(false);
    }
  };

  // 초대받은 주소와 로그인한 계정의 주소가 다르면 자동 수락하지 않는다(2026-10-12 신고).
  //   다른 계정으로 로그인한 채 링크를 열면 그 계정이 대신 합류하거나, 이미 멤버인 계정이면 초대가 지워졌다.
  //   서버 규칙(토큰 = 자격)은 그대로 — 묻고, 사람이 고르면 지금 계정으로도 받을 수 있다.
  const invitedEmail = (info?.contact_email || '').trim();
  const emailMismatch = !!(user && info && !info.already_linked && invitedEmail
    && invitedEmail.toLowerCase() !== String(user.email || '').trim().toLowerCase());
  const loginAsInvited = () => { logout({ next: `/invite/${token}` }); };

  // 자동 수락 — 로그인 상태로 초대 링크 도착 시 (가입/로그인 후 redirect 포함) 버튼 클릭 없이 즉시 연결.
  //  링크 토큰 자체가 자격증명(token-is-proof) 이라 안전.
  //  ★ 이미 연결된 초대도 로그인 상태면 부른다(2026-10-09 새 팀 첫 길 점검) — 초대 링크로 **가입하면 가입이 곧 합류**라
  //    돌아온 이 화면에서는 늘 already_linked 다. 예전엔 여기서 멈춰 방금 합류한 사람에게 «이미 수락된 초대입니다» 를
  //    보여 줬다. 서버 acceptInvite 는 같은 사람이면 멱등으로 받아 그 워크스페이스로 착지시키고(landOn), 남이면 거절한다.
  const autoAcceptedRef = useRef(false);
  useEffect(() => {
    if (autoAcceptedRef.current) return;
    if (!token || !user || !info || accepting || error) return;
    if (emailMismatch) return;
    autoAcceptedRef.current = true;
    handleAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, info]);

  const errorLabel = (code: string) => {
    if (code === 'invalid_or_expired_invite') return t('invite.invalid', '유효하지 않거나 만료된 초대 링크입니다.');
    if (code === 'invite_expired') return t('invite.expired', '초대 기간(30일)이 지났습니다. 초대한 분께 다시 보내 달라고 요청해 주세요.');
    if (code === 'invite_not_found') return t('invite.notFound', '이 초대를 찾을 수 없습니다. 취소됐거나 이미 처리된 초대일 수 있어요. 초대한 분께 다시 보내 달라고 요청해 주세요.');
    if (code === 'already_member') return t('invite.alreadyMember', '지금 로그인한 계정({{current}})은 이미 이 워크스페이스에 들어와 있습니다. 초대받은 이메일로 받으려면 그 이메일로 다시 로그인해 주세요.', { current: user?.email || '' });
    if (code === 'email_mismatch') return t('invite.emailMismatch', '이 초대는 다른 이메일 주소로 발송되었습니다. 초대받은 이메일로 로그인해 주세요.');
    if (code === 'already_accepted') return t('invite.alreadyAcceptedError', '이미 수락된 초대입니다.');
    return code;
  };

  const subtitleKey = (type?: InviteType) => {
    if (type === 'project_client') return t('invite.subtitle.project', '이 프로젝트에 초대되었습니다');
    if (type === 'workspace_client') return t('invite.subtitle.workspaceClient', '이 워크스페이스에 고객으로 초대되었습니다');
    if (type === 'workspace_member') return t('invite.subtitle.workspaceMember', '이 워크스페이스에 팀원으로 초대되었습니다');
    return '';
  };

  if (loading) return <PublicPageShell layout="card" width="sm" brand={false} center print={false}><Inner><Message>{t('invite.loading', '초대 정보를 불러오는 중...')}</Message></Inner></PublicPageShell>;
  if (error) return (
    <PublicPageShell layout="card" width="sm" brand={false} center print={false}>
      <Inner>
        <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ErrorText>{errorLabel(error)}</ErrorText>
        {error === 'already_member' && user ? (
          <>
            <ActionBtn onClick={loginAsInvited} data-testid="invite-switch-account">{t('invite.switchAccount', '다른 계정으로 로그인')}</ActionBtn>
            <SecondaryBtn onClick={() => navigate('/dashboard')}>{t('invite.goToApp', 'PlanQ 로 이동')}</SecondaryBtn>
          </>
        ) : (
          <ActionBtn onClick={() => navigate('/login')}>{t('invite.goLogin', '로그인 페이지로')}</ActionBtn>
        )}
      </Inner>
    </PublicPageShell>
  );
  if (!info) return null;

  // 로그인 상태면 위 자동 수락이 곧 이동시킨다 — 그 사이 «이미 수락된 초대» 를 비추지 않는다.
  if (info.already_linked && user) {
    return <PublicPageShell layout="card" width="sm" brand={false} center print={false}><Inner><Message>{t('invite.joining', '워크스페이스로 이동하는 중...')}</Message></Inner></PublicPageShell>;
  }
  if (info.already_linked) {
    return (
      <PublicPageShell layout="card" width="sm" brand={false} center print={false}>
        <Inner>
          <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
          <Title>{info.workspace_name}</Title>
          {info.project_name && <Subtitle>{info.project_name}</Subtitle>}
          <Message>{t('invite.alreadyAccepted', '이미 수락된 초대입니다.')}</Message>
          <ActionBtn onClick={() => navigate(info.type === 'workspace_member' ? '/dashboard' : '/talk')}>
            {t('invite.goToApp', 'PlanQ 로 이동')}
          </ActionBtn>
        </Inner>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell layout="card" width="sm" brand={false} center print={false}>
      <Inner>
        <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
        <Title>{info.workspace_name}</Title>
        <Subtitle>{subtitleKey(info.type)}</Subtitle>
        {info.project_name && <ProjectName>{info.project_name}</ProjectName>}
        {info.client_company && <CompanyName>{info.client_company}</CompanyName>}
        {info.company_name && <CompanyName>{info.company_name}</CompanyName>}
        {info.contact_name && <ContactInfo>{info.contact_name} {info.contact_email ? `(${info.contact_email})` : ''}</ContactInfo>}

        {user && emailMismatch ? (
          <>
            <Message data-testid="invite-email-mismatch">
              {t('invite.mismatch', '이 초대는 {{invited}} 로 보냈습니다. 지금은 {{current}} 계정으로 로그인되어 있어요.', { invited: invitedEmail, current: user.email })}
            </Message>
            <ActionBtn onClick={loginAsInvited} data-testid="invite-login-invited">
              {t('invite.loginAsInvited', '{{invited}} 로 로그인', { invited: invitedEmail })}
            </ActionBtn>
            <SecondaryBtn onClick={handleAccept} disabled={accepting} data-testid="invite-accept-current">
              {accepting ? t('invite.accepting', '수락 중...') : t('invite.acceptAsCurrent', '지금 계정으로 수락')}
            </SecondaryBtn>
          </>
        ) : user ? (
          <ActionBtn onClick={handleAccept} disabled={accepting}>
            {accepting ? t('invite.accepting', '수락 중...') : t('invite.accept', '초대 수락')}
          </ActionBtn>
        ) : (
          <>
            <Message>{t('invite.loginRequired', '초대를 수락하려면 로그인 또는 회원가입이 필요합니다.')}</Message>
            <ActionBtn onClick={() => navigate(`/login?redirect=/invite/${token}`)}>
              {t('invite.login', '로그인')}
            </ActionBtn>
            <SecondaryBtn onClick={() => navigate(`/register?redirect=/invite/${token}`)}>
              {t('invite.register', '회원가입')}
            </SecondaryBtn>
          </>
        )}
      </Inner>
    </PublicPageShell>
  );
};

export default InvitePage;

// 옛 Card 가 갖고 있던 것 중 **껍데기가 대신 못 하는 것**만 — 가운데 정렬.
const Inner = styled.div`text-align: center;`;

const Logo = styled.img`
  display: block;
  width: 110px;
  height: auto;
  margin: 0 auto 32px;
  user-select: none;
`;

const Title = styled.h1`
  font-size: 1.125rem;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 4px;
`;

const Subtitle = styled.p`
  font-size: 0.8125rem;
  color: #64748B;
  margin: 0 0 16px;
`;

const ProjectName = styled.div`
  font-size: 1.25rem;
  font-weight: 700;
  color: #0F766E;
  margin-bottom: 6px;
`;

const CompanyName = styled.div`
  font-size: 0.875rem;
  color: #475569;
  margin-bottom: 4px;
`;

const ContactInfo = styled.div`
  font-size: 0.75rem;
  color: #94A3B8;
  margin-bottom: 24px;
`;

const Message = styled.p`
  font-size: 0.8125rem;
  color: #64748B;
  margin: 16px 0;
`;

const ErrorText = styled.p`
  font-size: 0.8125rem;
  color: #DC2626;
  margin: 16px 0;
`;

const ActionBtn = styled.button`
  display: inline-block;
  padding: 13px 28px;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  margin-top: 20px;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const SecondaryBtn = styled.button`
  display: inline-block;
  padding: 13px 28px;
  background: transparent;
  color: #0D9488;
  border: 1px solid #99F6E4;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  &:hover { background: #F0FDFA; }
`;
