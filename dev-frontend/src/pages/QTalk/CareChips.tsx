// Q talk 채팅 밴드2 — 고객 문의 «응대 상태 · 담당자» 칩 2개 (2026-11-12 · docs/QTALK_CARE_DESIGN.md, Fable DESIGN: READY).
//
//   [고객] [● 응대 중 ▾] [담당 이디자 ▾]  최고객 ›  소속: …   — «고객» 칩 바로 뒤, 줄바꿈 없이.
//   행 없음(문의 없음): [응대 상태 정하기 ▾] [담당 없음 ▾].
// ★ 직원 화면만 — 고객·게스트·내부·안내방에는 그리지 않는다(부르는 쪽 ChatPanel 이 고객 방 ∧ 직원일 때만 놓는다).
// ★ 껍데기는 ChipPopover · 고르기 목록은 pickerList(메일 답변 담당 칩과 같은 것). PlanQSelect 금지(포털 메뉴가 바깥클릭으로 읽힌다).
// ★ 낙관 갱신 → 실패면 되돌리고 `!`. 성공 토스트 없음.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChipPopover from '../../components/Common/ChipPopover';
import { PickerFilter, PickerList, PickerItem } from '../../components/Common/pickerList';
import * as qtalkApi from '../../services/qtalk';
import { CARE_STATES, careAssigneeName, isKnownCareState, type ConvCare } from './careList';

interface Props {
  businessId: number;
  conversationId: number;
  care: ConvCare | null | undefined;
  myUserId: number | null;
  /** 낙관 갱신·서버 결과·되돌리기 — 부모(QTalkPage)가 목록 상태에 합친다 */
  onCareChange?: (conversationId: number, care: ConvCare | null) => void;
}

type Member = { user_id: number; name: string };

const CareChips: React.FC<Props> = ({ businessId, conversationId, care, myUserId, onCareChange }) => {
  const { t, i18n } = useTranslation('qtalk');
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [openTasks, setOpenTasks] = useState<number>(0);

  useEffect(() => { setFailed(false); setOpenTasks(0); setQuery(''); }, [conversationId]);
  useEffect(() => {
    let alive = true;
    import('../../services/workspace').then(({ listMembers }) => listMembers(businessId)).then((ms) => {
      if (!alive) return;
      setMembers((ms || [])
        .filter((m) => m.user_id && m.user && m.role !== 'ai' && !m.user.is_ai)
        .map((m) => ({ user_id: Number(m.user_id), name: m.user!.display_name || m.user!.name })));
    }).catch(() => { /* 고르기 목록만 빈다 — «내가 맡기»·«담당 없음» 은 그대로 된다 */ });
    return () => { alive = false; };
  }, [businessId]);

  const save = async (body: { state?: string; assignee_user_id?: number | null }, optimistic: ConvCare) => {
    const prev = care ?? null;
    setFailed(false);
    onCareChange?.(conversationId, optimistic);
    try {
      const r = await qtalkApi.updateConversationCare(businessId, conversationId, body);
      setOpenTasks(r.open_task_count || 0);
      onCareChange?.(conversationId, {
        state: r.state, state_changed_at: r.state_changed_at, assignee_user_id: r.assignee_user_id, assignee: r.assignee,
      });
    } catch {
      onCareChange?.(conversationId, prev);
      setFailed(true);
    }
  };
  const base: ConvCare = care ?? { state: 'open', assignee_user_id: null, assignee: null };
  const pickState = (s: string, close: () => void) => {
    close();
    if (care && care.state === s) return;
    void save({ state: s }, { ...base, state: s });
  };
  const pickAssignee = (uid: number | null, close: () => void) => {
    close(); setQuery('');
    if ((care?.assignee_user_id ?? null) === uid) return;
    const m = uid ? members.find((x) => x.user_id === uid) : null;
    void save({ assignee_user_id: uid }, {
      ...base, assignee_user_id: uid,
      assignee: uid ? { id: uid, name: m?.name || null } : null,
    });
  };
  const loadOpenTasks = () => {
    qtalkApi.fetchConversationOpenTaskCount(businessId, conversationId).then(setOpenTasks).catch(() => {});
  };

  const st = care?.state;
  const stateLabel = !care
    ? t('care.setState', '응대 상태 정하기')
    : isKnownCareState(st) ? `${st === 'open' ? '● ' : ''}${t(`care.state.${st}`)}` : String(st);   // 모르는 값은 글자 그대로(회색)
  const who = careAssigneeName(care, i18n.language);
  const assigneeLabel = care?.assignee_user_id
    ? t('care.assignee', { name: who || `#${care.assignee_user_id}`, defaultValue: '담당 {{name}}' })
    : t('care.noAssignee', '담당 없음');
  const q = query.trim().toLowerCase();
  const others = members.filter((m) => m.user_id !== myUserId).filter((m) => !q || m.name.toLowerCase().includes(q));

  return (
    <ChipRow>
      <span onClickCapture={loadOpenTasks}>
        <ChipPopover
          data-testid="chat-care-state"
          label={stateLabel as string}
          active={st === 'open'}
          ariaLabel={t('care.stateAria', '응대 상태') as string}
          width={260}
        >
          {(close) => (
            <>
              <PickerList>
                {CARE_STATES.map((s) => (
                  <PickerItem key={s} type="button" $on={st === s} data-testid={`chat-care-state-opt-${s}`} onClick={() => pickState(s, close)}>
                    {t(`care.state.${s}`)}
                  </PickerItem>
                ))}
              </PickerList>
              {openTasks > 0 && <Hint data-testid="chat-care-open-tasks">{t('care.openTasks', { count: openTasks })}</Hint>}
              <Hint>{t('care.reopenHint')}</Hint>
            </>
          )}
        </ChipPopover>
      </span>
      <ChipPopover
        data-testid="chat-care-assignee"
        label={assigneeLabel as string}
        active={!!care?.assignee_user_id}
        ariaLabel={t('care.assigneeAria', '담당자') as string}
        width={260}
      >
        {(close) => (
          <>
            <PickerList>
              {myUserId ? (
                <PickerItem type="button" $on={care?.assignee_user_id === myUserId} data-testid="chat-care-take" onClick={() => pickAssignee(myUserId, close)}>
                  {t('care.takeIt')}
                </PickerItem>
              ) : null}
            </PickerList>
            {members.length > 8 && (
              <PickerFilter value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('care.assigneeAria', '담당자') as string} aria-label={t('care.assigneeAria', '담당자') as string} />
            )}
            <PickerList>
              {others.map((m) => (
                <PickerItem key={m.user_id} type="button" $on={care?.assignee_user_id === m.user_id} data-testid={`chat-care-assignee-opt-${m.user_id}`}
                  onClick={() => pickAssignee(m.user_id, close)}>
                  {m.name}
                </PickerItem>
              ))}
              <PickerItem type="button" $on={!care?.assignee_user_id} data-testid="chat-care-assignee-none" onClick={() => pickAssignee(null, close)}>
                {t('care.noAssignee')}
              </PickerItem>
            </PickerList>
            <Hint>{t('care.joinHint')}</Hint>
          </>
        )}
      </ChipPopover>
      {failed && <Fail role="alert" title={t('care.failed') as string} aria-label={t('care.failed') as string} data-testid="chat-care-failed">!</Fail>}
    </ChipRow>
  );
};

export default CareChips;

/** 좌측 목록 행의 짧은 표시 — [보류]/[해결] 태그, 응대 중이면 담당 이름 또는 «미배정». 행 없음·고객 화면이면 그리지 않는다. */
export const CareRowTag: React.FC<{ care: ConvCare | null | undefined }> = ({ care }) => {
  const { t, i18n } = useTranslation('qtalk');
  if (!care) return null;
  if (care.state === 'open') {
    const who = careAssigneeName(care, i18n.language);
    return <RowTag $tone="open" data-testid="qtalk-care-tag">{care.assignee_user_id ? (who || `#${care.assignee_user_id}`) : t('care.unassigned')}</RowTag>;
  }
  return <RowTag $tone="muted" data-testid="qtalk-care-tag">{isKnownCareState(care.state) ? t(`care.state.${care.state}`) : care.state}</RowTag>;
};

// 밴드2 안 묶음 — 폰 밴드2 는 글자 한 줄(20px) 높이라, 칩이 공용 폰 규격(36px)으로 커지면 밴드2 가 자라
//   본문 시작 y 가 내려간다(카나리 실측 39 → 55, 28px 로도 47). 밴드 안에서는 같은 줄 «고객» 칩·소속 링크와 같은 글자 한 줄 높이로 두고,
//   누르는 자리만 위아래로 넓혀(::before) 터치 40px 을 지킨다.
const ChipRow = styled.span`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  > span { display: inline-flex; align-items: center; }
  @media (max-width: 640px) {
    /* 높이는 글자 줄높이가 정한다(≈16px · «고객» 칩 17px 안) — 숫자 높이를 적지 않는다(규격 토큰 밖 값은 UI 래칫이 센다) */
    button[aria-haspopup='dialog'] { height: auto; line-height: 1.25; position: relative; font-size: 0.6875rem; padding: 0 6px 0 8px; }
    button[aria-haspopup='dialog']::before { content: ''; position: absolute; left: 0; right: 0; top: -12px; bottom: -12px; }
  }
`;
const Hint = styled.div`
  font-size: 0.6875rem; color: #64748B; line-height: 1.45; padding: 4px 2px 0;
`;
const Fail = styled.span`
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  padding: 1px 6px; line-height: 1.4; border-radius: 999px;
  background: #FEF2F2; color: #B91C1C; font-size: 0.6875rem; font-weight: 700;
`;
const RowTag = styled.span<{ $tone: 'open' | 'muted' }>`
  flex-shrink: 0; max-width: 88px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
  background: ${(p) => (p.$tone === 'open' ? '#F0FDFA' : '#F1F5F9')};
  color: ${(p) => (p.$tone === 'open' ? '#0F766E' : '#64748B')};
`;
