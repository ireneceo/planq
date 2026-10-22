// 이메일을 누르면 «우리 메일 작성» — 사람 화면(멤버·고객·프로젝트 고객·팝오버)이 같이 쓰는 한 벌.
//   2026-10-22 Irene: *"이메일은 클릭하면 우리 이메일 작성이 새창으로 열리게 해줘. 모바일은 보내고 뒤로가게 해주고."*
//   Fable 판정 2(docs/PEOPLE_PROFILE_UNIFY_DESIGN.md): 별창 대신 **새 탭**(tabStore.newTab) — 폰(미러)은 같은 창 이동.
//   작성 화면은 Q mail 본체(MailPage ?compose=1&to=&back=1) 하나. 보내거나 취소하면 탭을 닫거나(탭 모드) 뒤로 간다(폰).
//   Q mail 권한이 없거나 연결된 메일 계정이 없으면 기기 메일 앱(mailto:)으로 떨어진다 — 막다른 길을 만들지 않는다.
//   고객 역할 화면에는 링크를 두지 않는다(평문).
import React, { useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { tabStore } from '../../stores/tabStore';
import { listEmailAccounts } from '../../services/mail';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 워크스페이스별 «메일 계정이 있나» — 한 화면에 이메일이 여럿이라 누를 때마다 묻지 않는다(60초)
const accountCache = new Map<number, { at: number; has: boolean }>();
async function hasMailAccount(bizId: number): Promise<boolean> {
  const c = accountCache.get(bizId);
  if (c && Date.now() - c.at < 60_000) return c.has;
  try {
    const rows = await listEmailAccounts(bizId);
    const has = Array.isArray(rows) && rows.length > 0;
    accountCache.set(bizId, { at: Date.now(), has });
    return has;
  } catch { return false; }
}

// back = 돌아갈 곳. 탭 모드면 **연 탭의 id**(작성 탭을 닫고 그 탭으로 — 옆 탭으로 떨어지지 않게), 폰(미러)이면 1(뒤로).
export function composePath(email: string): string {
  const snap = tabStore.getSnapshot();
  const back = !snap.mirror && snap.activeId ? encodeURIComponent(snap.activeId) : '1';
  return `/mail?compose=1&to=${encodeURIComponent(email)}&back=${back}`;
}

interface Props {
  email: string | null | undefined;
  className?: string;
  /** 비었을 때 보일 글자 */
  empty?: React.ReactNode;
}

export default function EmailLink({ email, className, empty = null }: Props) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const addr = (email || '').trim();
  const bizId = Number(user?.business_id || 0);
  const isClient = user?.business_role === 'client';

  const onClick = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 수정 키(새 창으로 열기 등)는 브라우저에 맡긴다 — mailto 그대로
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const canMail = user?.menu_levels?.qmail !== 'none' && bizId > 0 && await hasMailAccount(bizId);
    if (!canMail) { window.location.href = `mailto:${addr}`; return; }
    tabStore.newTab(composePath(addr));
  }, [addr, bizId, user?.menu_levels?.qmail]);

  if (!addr) return <>{empty}</>;
  if (isClient || !EMAIL_RE.test(addr)) return <Plain className={className}>{addr}</Plain>;
  return (
    <Link
      href={`mailto:${addr}`}
      className={className}
      onClick={onClick}
      title={t('people.composeTo', { defaultValue: '{{email}} 에게 메일 쓰기', email: addr }) as string}
      data-testid="people-email-link"
    >
      {addr}
    </Link>
  );
}

const Plain = styled.span`word-break:break-all;`;
const Link = styled.a`
  color: #0F766E;
  text-decoration: none;
  word-break: break-all;
  cursor: pointer;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
  /* 폰 — 주소 글자 자체가 누르는 자리(터치 44px) */
  @media (max-width: 640px) { display: inline-flex; align-items: center; min-height: 44px; }
`;
