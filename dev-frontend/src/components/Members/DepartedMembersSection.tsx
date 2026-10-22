// «나간 멤버 — 남은 일» — 이미 내보낸 사람에게 아직 열린 일이 남아 있으면 여기 줄로 보이고, 같은 인수인계 칸으로 넘긴다.
//   서버 GET /api/businesses/:biz/members-departed (남은 것 > 0 인 사람만). 설계 docs/ORG_STAGE0_DESIGN.md 9절 1.
//   오너·플랫폼 관리자만(서버 403 이면 아무것도 그리지 않는다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../Common/ActionButton';
import LetterAvatar from '../Common/LetterAvatar';
import MemberHandoverBox, { type HandoverCandidate } from './MemberHandoverBox';
import { formatDay } from '../../utils/dateFormat';

interface Row { member_id: number; user_id: number; removed_at: string; name: string | null; email: string | null; total: number; private_total: number }

const DepartedMembersSection: React.FC<{ businessId: number; candidates: HandoverCandidate[] }> = ({ businessId, candidates }) => {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<Row[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/members-departed`);
      if (!r.ok) { setRows([]); return; }
      const j = await r.json();
      setRows(Array.isArray(j.data) ? j.data : []);
    } catch { setRows([]); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  if (!rows.length) return null;
  return (
    <Wrap data-testid="departed-members">
      <Head>{t('members.departed.title', '나간 멤버 — 남은 일')}</Head>
      <Desc>{t('members.departed.desc', '내보낸 사람에게 아직 끝나지 않은 일이 남아 있습니다. 넘겨받을 사람을 정해 주세요.')}</Desc>
      {rows.map((r) => {
        const name = r.name || r.email || `#${r.user_id}`;
        const open = openId === r.member_id;
        return (
          <Item key={r.member_id}>
            <Line>
              <LetterAvatar name={name} size={28} />
              <Who>
                <Name>{name}</Name>
                <Sub>
                  {t('members.departed.left', '{{date}} 나감', { date: formatDay(r.removed_at, { year: 'always' }) })}
                  {' · '}
                  {t('members.departed.remaining', '남은 일 {{n}}건', { n: r.total + (r.total === 0 ? r.private_total : 0) })}
                </Sub>
              </Who>
              {!open && (
                <ActionButton tone="secondary" size="sm" onClick={() => setOpenId(r.member_id)} data-testid="departed-handover-open">
                  {t('members.departed.open', '넘기기')}
                </ActionButton>
              )}
            </Line>
            {open && (
              <MemberHandoverBox
                businessId={businessId} memberId={r.member_id} fromUserId={r.user_id}
                mode="departed" candidates={candidates}
                onCancel={() => setOpenId(null)}
                onDone={() => void load()}
              />
            )}
          </Item>
        );
      })}
    </Wrap>
  );
};

export default DepartedMembersSection;

const Wrap = styled.div`margin-top: 16px; padding-top: 14px; border-top: 1px solid #F1F5F9; display: flex; flex-direction: column; gap: 8px;`;
const Head = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Item = styled.div`padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;`;
const Line = styled.div`display: flex; align-items: center; gap: 10px;`;
const Who = styled.div`flex: 1; min-width: 0;`;
const Name = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Sub = styled.div`font-size: 0.75rem; color: #64748B;`;
