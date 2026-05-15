// 사이클 N+15-E — 발신자 클릭 시 유저 정보 popover.
// 채팅에서 누구의 메시지인지 빠르게 파악 (이메일·직책·회사). 본인도 동일하게 표시.
//
// 데이터 소스:
//   - BusinessMember (워크스페이스 멤버) → User join 으로 name/email/phone/job_title/organization
//   - Client (고객 user) → display_name + company_name
//
// UX:
//   - 클릭 → 패널 오픈 / 배경 클릭 또는 Esc 닫힘
//   - portal 없이 anchor 옆 absolute (간단)
//   - 모바일 (≤640): 화면 중앙 bottom sheet 형태
import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import LetterAvatar from './LetterAvatar';

interface MemberRow {
  user_id: number;
  role: string;
  name?: string | null;
  job_title?: string | null;
  organization?: string | null;
  user: { id: number; name: string; email: string; phone?: string | null; job_title?: string | null; organization?: string | null; avatar_url?: string | null };
}

interface ClientRow {
  id: number;
  user_id: number | null;
  display_name: string | null;
  company_name: string | null;
}

interface UserInfo {
  scope: 'member' | 'client' | 'unknown';
  name: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  organization?: string | null;
  role?: string | null;
  company_name?: string | null;
  avatar_url?: string | null;
}

// 워크스페이스별 캐시 — 첫 열림 시 1회 fetch, 이후 popover 재오픈 빠름
const memberCache = new Map<number, { ts: number; members: MemberRow[]; clients: ClientRow[] }>();
const CACHE_TTL = 60 * 1000;

async function fetchAndResolve(businessId: number, userId: number): Promise<UserInfo | null> {
  const cached = memberCache.get(businessId);
  const fresh = cached && Date.now() - cached.ts < CACHE_TTL;
  let members: MemberRow[] = [];
  let clients: ClientRow[] = [];
  if (fresh && cached) {
    members = cached.members;
    clients = cached.clients;
  } else {
    try {
      const [mRes, cRes] = await Promise.all([
        apiFetch(`/api/businesses/${businessId}/members`),
        apiFetch(`/api/clients/${businessId}`),
      ]);
      const mJson = await mRes.json().catch(() => null);
      const cJson = await cRes.json().catch(() => null);
      if (mJson?.success) members = mJson.data || [];
      if (cJson?.success) clients = cJson.data || [];
      memberCache.set(businessId, { ts: Date.now(), members, clients });
    } catch { return null; }
  }
  const member = members.find((m) => m.user_id === userId);
  if (member) {
    return {
      scope: 'member',
      name: member.name || member.user.name,
      email: member.user.email,
      phone: member.user.phone,
      job_title: member.job_title || member.user.job_title,
      organization: member.organization || member.user.organization,
      role: member.role,
      avatar_url: member.user.avatar_url,
    };
  }
  const client = clients.find((c) => c.user_id === userId);
  if (client) {
    return {
      scope: 'client',
      name: client.display_name || '(이름 없음)',
      company_name: client.company_name || null,
    };
  }
  return { scope: 'unknown', name: '(외부 사용자)' };
}

interface Props {
  open: boolean;
  userId: number;
  businessId: number;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const UserInfoPopover: React.FC<Props> = ({ open, userId, businessId, anchorEl, onClose }) => {
  const { t } = useTranslation('qtalk');
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    fetchAndResolve(businessId, userId).then((r) => {
      if (cancelled) return;
      setInfo(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, userId, businessId]);

  const handleOutside = useCallback((e: MouseEvent) => {
    if (!popoverRef.current) return;
    if (popoverRef.current.contains(e.target as Node)) return;
    if (anchorEl && anchorEl.contains(e.target as Node)) return;
    onClose();
  }, [anchorEl, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, handleOutside, onClose]);

  if (!open) return null;

  // anchor 기준 위치 — desktop: anchor 의 bottom + 6. 모바일은 CSS 가 fixed bottom sheet 처리.
  let top: number | undefined;
  let left: number | undefined;
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    top = rect.bottom + 6;
    left = rect.left;
  }

  return (
    <Backdrop>
      <Popover ref={popoverRef} role="dialog" aria-modal="true" style={{ top, left }}>
        {loading ? (
          <LoadingRow>
            <SkeletonAvatar />
            <div style={{ flex: 1 }}>
              <SkeletonLine $w="60%" />
              <SkeletonLine $w="40%" $sub />
            </div>
          </LoadingRow>
        ) : info ? (
          <>
            <HeaderRow>
              <LetterAvatar name={info.name} size={48} />
              <NameBlock>
                <Name>{info.name}</Name>
                {info.scope === 'member' && info.role && <RoleTag>{info.role === 'owner' ? t('userInfo.owner', '오너') : t('userInfo.member', '멤버')}</RoleTag>}
                {info.scope === 'client' && <RoleTag $client>{t('userInfo.client', '고객')}</RoleTag>}
              </NameBlock>
            </HeaderRow>
            <FieldList>
              {info.email && (
                <Field>
                  <FieldLabel>{t('userInfo.email', '이메일')}</FieldLabel>
                  <FieldValue><a href={`mailto:${info.email}`}>{info.email}</a></FieldValue>
                </Field>
              )}
              {info.job_title && (
                <Field>
                  <FieldLabel>{t('userInfo.jobTitle', '직책')}</FieldLabel>
                  <FieldValue>{info.job_title}</FieldValue>
                </Field>
              )}
              {info.organization && (
                <Field>
                  <FieldLabel>{t('userInfo.organization', '소속')}</FieldLabel>
                  <FieldValue>{info.organization}</FieldValue>
                </Field>
              )}
              {info.company_name && (
                <Field>
                  <FieldLabel>{t('userInfo.company', '회사')}</FieldLabel>
                  <FieldValue>{info.company_name}</FieldValue>
                </Field>
              )}
              {info.phone && (
                <Field>
                  <FieldLabel>{t('userInfo.phone', '전화')}</FieldLabel>
                  <FieldValue>{info.phone}</FieldValue>
                </Field>
              )}
              {!info.email && !info.job_title && !info.organization && !info.company_name && !info.phone && (
                <NoInfo>{t('userInfo.noInfo', '추가 정보가 없습니다')}</NoInfo>
              )}
            </FieldList>
          </>
        ) : (
          <NoInfo>{t('userInfo.notFound', '정보를 불러올 수 없습니다')}</NoInfo>
        )}
      </Popover>
    </Backdrop>
  );
};

export default UserInfoPopover;

// 모바일에서만 backdrop 활성 — 데스크탑은 popover 자체가 absolute 라 backdrop 안 보이게.
const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 2000;
  background: transparent;
  @media (max-width: 640px) {
    background: rgba(15, 23, 42, 0.35);
  }
`;

const Popover = styled.div`
  position: fixed;
  z-index: 2001;
  width: 280px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  padding: 14px 16px;
  animation: pq-userinfo-in 0.15s ease-out;
  @keyframes pq-userinfo-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* 모바일: 화면 하단 시트 */
  @media (max-width: 640px) {
    top: auto !important;
    left: 0 !important;
    bottom: 0;
    width: 100%;
    border-radius: 16px 16px 0 0;
    padding: 18px 20px max(20px, env(safe-area-inset-bottom, 20px));
  }
`;

const HeaderRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
`;
const NameBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;
const Name = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #0F172A;
`;
const RoleTag = styled.span<{ $client?: boolean }>`
  display: inline-block;
  padding: 1px 8px;
  background: ${(p) => (p.$client ? 'rgba(244,63,94,0.10)' : '#F0FDFA')};
  color: ${(p) => (p.$client ? '#BE123C' : '#0F766E')};
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  width: fit-content;
`;
const FieldList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const Field = styled.div`
  display: flex;
  gap: 10px;
  font-size: 12px;
`;
const FieldLabel = styled.div`
  min-width: 60px;
  color: #94A3B8;
  font-weight: 500;
`;
const FieldValue = styled.div`
  color: #0F172A;
  word-break: break-all;
  a { color: #0D9488; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;
const NoInfo = styled.div`
  font-size: 12px;
  color: #94A3B8;
  text-align: center;
  padding: 12px 0;
`;
const LoadingRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;
const SkeletonAvatar = styled.div`
  width: 48px; height: 48px; border-radius: 50%;
  background: #F1F5F9;
  animation: pq-skel 1.4s ease-in-out infinite;
  @keyframes pq-skel { 0%,100%{opacity:1} 50%{opacity:0.5} }
`;
const SkeletonLine = styled.div<{ $w: string; $sub?: boolean }>`
  width: ${(p) => p.$w};
  height: ${(p) => p.$sub ? '8px' : '12px'};
  background: #F1F5F9;
  border-radius: 4px;
  margin-top: 6px;
  animation: pq-skel 1.4s ease-in-out infinite;
`;
