import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
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

const InvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { user, refreshUser } = useAuth();
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
        if (!body.success) throw new Error(body.message || 'invalid_or_expired_invite');
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
      // 이미 수락된 초대면 에러 대신 자연스럽게 진입 (자동 수락 경합 방어)
      if (!body.success && body.message !== 'already_accepted') throw new Error(body.message);
      // 수락으로 새로 연결된 워크스페이스(고객)를 user 에 반영 — 무워크스페이스 가입 직후 진입 보장
      try { await refreshUser(); } catch { /* noop */ }
      navigate(body.data?.redirect || (info?.type === 'workspace_member' ? '/dashboard' : '/talk'));
    } catch (err: unknown) {
      setError(mapApiError(err, tErr));
    } finally {
      setAccepting(false);
    }
  };

  // 자동 수락 — 로그인 상태로 초대 링크 도착 시 (가입/로그인 후 redirect 포함) 버튼 클릭 없이 즉시 연결.
  //  링크 토큰 자체가 자격증명(token-is-proof) 이라 안전. 이미 연결된 초대는 skip(아래 already_linked 화면).
  const autoAcceptedRef = useRef(false);
  useEffect(() => {
    if (autoAcceptedRef.current) return;
    if (!token || !user || !info || accepting || error) return;
    if (info.already_linked) return;
    autoAcceptedRef.current = true;
    handleAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, info]);

  const errorLabel = (code: string) => {
    if (code === 'invalid_or_expired_invite') return t('invite.invalid', '유효하지 않거나 만료된 초대 링크입니다.');
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

  if (loading) return <Wrapper><Card><Message>{t('invite.loading', '초대 정보를 불러오는 중...')}</Message></Card></Wrapper>;
  if (error) return (
    <Wrapper>
      <Card>
        <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ErrorText>{errorLabel(error)}</ErrorText>
        <ActionBtn onClick={() => navigate('/login')}>{t('invite.goLogin', '로그인 페이지로')}</ActionBtn>
      </Card>
    </Wrapper>
  );
  if (!info) return null;

  if (info.already_linked) {
    return (
      <Wrapper>
        <Card>
          <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
          <Title>{info.workspace_name}</Title>
          {info.project_name && <Subtitle>{info.project_name}</Subtitle>}
          <Message>{t('invite.alreadyAccepted', '이미 수락된 초대입니다.')}</Message>
          <ActionBtn onClick={() => navigate(info.type === 'workspace_member' ? '/dashboard' : '/talk')}>
            {t('invite.goToApp', 'PlanQ 로 이동')}
          </ActionBtn>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Card>
        <Logo src="/planQ-slogan_color.svg" alt="PlanQ" />
        <Title>{info.workspace_name}</Title>
        <Subtitle>{subtitleKey(info.type)}</Subtitle>
        {info.project_name && <ProjectName>{info.project_name}</ProjectName>}
        {info.client_company && <CompanyName>{info.client_company}</CompanyName>}
        {info.company_name && <CompanyName>{info.company_name}</CompanyName>}
        {info.contact_name && <ContactInfo>{info.contact_name} {info.contact_email ? `(${info.contact_email})` : ''}</ContactInfo>}

        {user ? (
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
      </Card>
    </Wrapper>
  );
};

export default InvitePage;

const Wrapper = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F8FAFC;
  padding: 24px;
`;

const Card = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  padding: 40px 32px;
  max-width: 400px;
  width: 100%;
  text-align: center;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
`;

const Logo = styled.img`
  display: block;
  width: 110px;
  height: auto;
  margin: 0 auto 32px;
  user-select: none;
`;

const Title = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 4px;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: #64748B;
  margin: 0 0 16px;
`;

const ProjectName = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: #0F766E;
  margin-bottom: 6px;
`;

const CompanyName = styled.div`
  font-size: 14px;
  color: #475569;
  margin-bottom: 4px;
`;

const ContactInfo = styled.div`
  font-size: 12px;
  color: #94A3B8;
  margin-bottom: 24px;
`;

const Message = styled.p`
  font-size: 13px;
  color: #64748B;
  margin: 16px 0;
`;

const ErrorText = styled.p`
  font-size: 13px;
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
  font-size: 14px;
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
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  &:hover { background: #F0FDFA; }
`;
