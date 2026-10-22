// 메일 상세 밴드2 — «답변 담당» 칩 (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7).
//
// Irene: *"메일별 답변 담당자 지정 … 내가 답변 할 예정인지 다른 사람에게 답변요청할건지 … 업무로 연결해서 자동등록"*
//   지정하면 서버(services/mailReplyTask)가 «메일 답변: …» 업무를 만들고 메일과 잇는다. 담당자가 답장하면 업무가 닫힌다.
//   옛 «담당» 칩을 그대로 대신한다 — 같은 자리·같은 껍데기(ChipPopover)·같은 고르기 목록.
// ★ 팝오버 안에 PlanQSelect 를 쓰지 않는다(포털 메뉴가 바깥클릭으로 읽혀 선택 전에 닫힌다 — CLAUDE.md 밴드2 절).
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChipPopover from '../../components/Common/ChipPopover';
import { tabStore } from '../../stores/tabStore';
import { PickerFilter, PickerList, PickerItem, PickerHint } from './MailPage.styles';

interface Props {
  assigneeId: number | null | undefined;
  assigneeName: string | null | undefined;
  replyTask: { id: number; status: string } | null | undefined;
  members: Array<{ user_id: number; name: string }>;
  myUserId: number | null | undefined;
  personal: boolean;              // 개인 메일 계정 — 주인(나)만 맡을 수 있다(서버도 막는다)
  error: string | null;
  onAssign: (uid: number | null) => void;
}

const CLOSED = ['completed', 'canceled'];

const MailReplyOwnerChip: React.FC<Props> = ({ assigneeId, assigneeName, replyTask, members, myUserId, personal, error, onAssign }) => {
  const { t } = useTranslation('qmail');
  const [query, setQuery] = useState('');
  const taskDone = !!replyTask && replyTask.status === 'completed';
  const label = assigneeId
    ? `${assigneeName || ''}${taskDone ? ` · ${t('replyOwner.doneShort', { defaultValue: '답변함' })}` : ''}`
    : (t('replyOwner.none', { defaultValue: '없음' }) as string);
  const others = members.filter((m) => m.user_id !== myUserId)
    .filter((m) => !query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (uid: number | null, close: () => void) => { onAssign(uid); setQuery(''); close(); };

  return (
    <ChipPopover
      data-testid="mail-assign-chip"
      prefix={t('replyOwner.prefix', { defaultValue: '답변 담당' }) as string}
      label={label}
      active={!!assigneeId}
      ariaLabel={t('replyOwner.aria', { defaultValue: '답변 담당 정하기' }) as string}
      width={280}
    >
      {(close) => (
        <>
          <Intro>{t('replyOwner.intro', { defaultValue: '정하면 «메일 답변» 업무가 생기고, 담당자가 답장하면 끝납니다.' })}</Intro>
          {error && <Err role="alert">{error}</Err>}
          <PickerList>
            {myUserId ? (
              <PickerItem type="button" $on={assigneeId === myUserId} data-testid="mail-assign-me"
                onClick={() => pick(assigneeId === myUserId ? null : myUserId, close)}>
                {t('replyOwner.me', { defaultValue: '내가 답변할게요' })}
              </PickerItem>
            ) : null}
          </PickerList>
          {!personal && (
            <>
              <Divider>{t('replyOwner.askOther', { defaultValue: '다른 멤버에게 답변 요청' })}</Divider>
              {members.length > 8 && (
                <PickerFilter value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('actions.assignSearch', { defaultValue: '이름으로 찾기' }) as string}
                  aria-label={t('actions.assignSearch', { defaultValue: '이름으로 찾기' }) as string} />
              )}
              <PickerList>
                {others.map((m) => (
                  <PickerItem key={m.user_id} type="button" $on={assigneeId === m.user_id}
                    /* 재클릭 토글 — 이미 담당인 사람을 다시 누르면 해제 (CLAUDE.md UI 규칙) */
                    onClick={() => pick(assigneeId === m.user_id ? null : m.user_id, close)}>
                    {m.name}
                  </PickerItem>
                ))}
              </PickerList>
            </>
          )}
          {(assigneeId || replyTask) && (
            <Foot>
              {assigneeId && (
                <PickerItem type="button" onClick={() => pick(null, close)}>
                  {t('replyOwner.clear', { defaultValue: '담당 없음으로' })}
                </PickerItem>
              )}
              {replyTask && (
                <PickerItem type="button" data-testid="mail-reply-task-open"
                  onClick={() => { tabStore.openInNewTab(`/tasks?task=${replyTask.id}`); close(); }}>
                  {t('replyOwner.openTask', { defaultValue: '연결된 업무 보기' })}
                  <PickerHint>{CLOSED.includes(replyTask.status)
                    ? t(`replyOwner.taskState.${replyTask.status}`, { defaultValue: replyTask.status === 'completed' ? '완료' : '취소' })
                    : t('replyOwner.taskState.open', { defaultValue: '진행 중' })}</PickerHint>
                </PickerItem>
              )}
            </Foot>
          )}
        </>
      )}
    </ChipPopover>
  );
};

export default MailReplyOwnerChip;

const Intro = styled.div`
  font-size: 0.75rem; color: #64748B; line-height: 1.45; padding: 2px 2px 8px;
`;
const Err = styled.div`
  font-size: 0.75rem; color: #B91C1C; background: #FEF2F2; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;
`;
const Divider = styled.div`
  font-size: 0.6875rem; font-weight: 600; color: #94A3B8; padding: 10px 2px 4px;
`;
const Foot = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  margin-top: 8px; padding-top: 6px; border-top: 1px solid #F1F5F9;
`;
