// #462 — 일정 등록 창의 «참석자에게 알림 보내기 (N명)» + 한 줄 메시지(선택).
//   기본은 보냄. 끄면 서버(services/eventNotify)는 초대 알림을 보내지 않는다.
//   N 은 실제로 받을 수 있는 사람 수(나 자신·계정 없는 고객 제외) — 부르는 쪽이 계산해 넘긴다.
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

/** 알림을 실제로 받을 수 있는 참석자 수 — 나 자신·계정 없는 고객은 뺀다(서버 eventNotify.recipientsOf 와 같은 기준). */
export function notifyCountOf(keys: string[], clients: Array<{ id: number; user_id?: number | null }>, myId: number): number {
  return keys.filter((k) => {
    const id = Number(k.slice(2));
    if (k.startsWith('c:')) return !!clients.find((c) => Number(c.id) === id)?.user_id;
    return id !== myId;
  }).length;
}

export default function AttendeeNotifyField({ count, value, onChange }: {
  count: number; value: { send: boolean; message: string }; onChange: (v: { send: boolean; message: string }) => void;
}) {
  const { send, message } = value;
  const { t } = useTranslation('qcalendar');
  return (
    <Wrap>
      <Check>
        <input type="checkbox" checked={send} onChange={(e) => onChange({ ...value, send: e.target.checked })}
          data-testid="new-event-notify-attendees" />
        <span>{t('notify.onCreate', { count })}</span>
      </Check>
      {send && (
        // draft-exempt: 알림과 함께 보내는 한 줄 — 등록 창 안에서 쓰고 등록과 함께 나간다(창을 닫으면 등록도 없다)
        <Input value={message} maxLength={300} onChange={(e) => onChange({ ...value, message: e.target.value })}
          placeholder={t('notify.messagePh') as string} data-testid="new-event-notify-message" />
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:8px;margin-top:6px;`;
const Check = styled.label`
  display:inline-flex;align-items:center;gap:8px;font-size:0.8125rem;color:#334155;cursor:pointer;
`;
const Input = styled.input`
  height:36px;padding:0 12px;border:1px solid #E2E8F0;border-radius:8px;font-size:0.8125rem;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}
`;
