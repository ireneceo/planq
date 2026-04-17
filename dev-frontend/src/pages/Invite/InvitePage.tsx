import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

interface InviteInfo {
  project_name: string;
  client_company: string | null;
  workspace_name: string;
  contact_name: string | null;
  contact_email: string | null;
  already_linked: boolean;
}

const InvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const navigate = useNavigate();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`/api/projects/invite/${token}`);
        const body = await r.json();
        if (!body.success) throw new Error(body.message || 'Invalid invite');
        setInfo(body.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load invite');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!token || !user) return;
    setAccepting(true);
    try {
      const r = await fetch(`/api/projects/invite/${token}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json',
        },
      });
      const body = await r.json();
      if (!body.success) throw new Error(body.message);
      navigate('/talk');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return <Wrapper><Card><Message>Loading...</Message></Card></Wrapper>;
  if (error) return (
    <Wrapper>
      <Card>
        <Logo>PlanQ</Logo>
        <ErrorText>{error === 'invalid_or_expired_invite' ? t('invite.invalid', 'Invalid or expired invite link') : error}</ErrorText>
        <ActionBtn onClick={() => navigate('/login')}>{t('invite.goLogin', 'Go to login')}</ActionBtn>
      </Card>
    </Wrapper>
  );
  if (!info) return null;

  if (info.already_linked) {
    return (
      <Wrapper>
        <Card>
          <Logo>PlanQ</Logo>
          <Title>{info.workspace_name}</Title>
          <Subtitle>{info.project_name}</Subtitle>
          <Message>{t('invite.alreadyAccepted', 'This invite has already been accepted.')}</Message>
          <ActionBtn onClick={() => navigate('/talk')}>{t('invite.goToTalk', 'Go to Q talk')}</ActionBtn>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Card>
        <Logo>PlanQ</Logo>
        <Title>{info.workspace_name}</Title>
        <Subtitle>{t('invite.invitedTo', 'You are invited to join')}</Subtitle>
        <ProjectName>{info.project_name}</ProjectName>
        {info.client_company && <CompanyName>{info.client_company}</CompanyName>}
        {info.contact_name && <ContactInfo>{info.contact_name} {info.contact_email ? `(${info.contact_email})` : ''}</ContactInfo>}

        {user ? (
          <ActionBtn onClick={handleAccept} disabled={accepting}>
            {accepting ? t('invite.accepting', 'Accepting...') : t('invite.accept', 'Accept invite')}
          </ActionBtn>
        ) : (
          <>
            <Message>{t('invite.loginRequired', 'Please log in or sign up to accept this invite.')}</Message>
            <ActionBtn onClick={() => navigate(`/login?redirect=/invite/${token}`)}>
              {t('invite.login', 'Log in')}
            </ActionBtn>
            <SecondaryBtn onClick={() => navigate(`/register?redirect=/invite/${token}`)}>
              {t('invite.register', 'Sign up')}
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

const Logo = styled.div`
  font-size: 20px;
  font-weight: 800;
  color: #0D9488;
  margin-bottom: 24px;
  letter-spacing: -0.5px;
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
  width: 100%;
  padding: 12px;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 8px;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const SecondaryBtn = styled.button`
  width: 100%;
  padding: 12px;
  background: transparent;
  color: #0D9488;
  border: 1px solid #99F6E4;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
  &:hover { background: #F0FDFA; }
`;
