// #462 — 일정의 시간·장소를 바꿀 때 «변경 알림을 보낼까요?»
//
//   김미정(#462): "구글캘린더는 코멘트(선택) 추가해서 알림 보낼지 말지 정하는데."
//   받는 사람 이름을 적는다 — 어디로 가는지 모르는 확인은 확인이 아니다(CLAUDE.md «외부 발송은 확인을 받는다»).
//   이름은 서버 POST …/notify-recipients 가 준다 — 실제로 보내는 PUT 과 같은 함수(services/eventNotify.recipientsOf).
//
//   세 갈래: [취소](바꾸지 않음) · [알리지 않고 저장] · [알리고 저장](+ 한 줄 메시지).
//   ConfirmDialog 는 본문에 입력칸을 둘 수 없어 같은 껍데기(UI/Modal)로 그린다 — 버튼 3톤도 같은 것을 쓴다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Modal, ModalButton as Button } from '../../components/UI/Modal';

export type NotifyChoice = { send: boolean; message: string | null };

export default function ChangeNotifyDialog({ names, count, onDecide }: {
  names: string[];
  count: number;
  onDecide: (choice: NotifyChoice | 'cancel') => void;
}) {
  const { t } = useTranslation('qcalendar');
  const [message, setMessage] = useState('');
  const shown = names.slice(0, 6).join(', ') + (count > 6 ? ` ${t('notify.andMore', { n: count - 6 })}` : '');
  const footer = (
    <>
      <Button variant="secondary" onClick={() => onDecide('cancel')} data-testid="event-change-notify-cancel">
        {t('notify.cancel')}
      </Button>
      <Button variant="secondary" onClick={() => onDecide({ send: false, message: null })} data-testid="event-change-notify-skip">
        {t('notify.saveOnly')}
      </Button>
      <Button variant="primary" onClick={() => onDecide({ send: true, message: message.trim() || null })} data-testid="event-change-notify-send">
        {t('notify.saveAndSend')}
      </Button>
    </>
  );
  return (
    <Modal isOpen onClose={() => onDecide('cancel')} title={t('notify.changeTitle')} footer={footer} zIndex={2150}>
      <Body data-testid="event-change-notify">
        <Lead>{t('notify.changeLead', { count, names: shown })}</Lead>
        {/* draft-exempt: 변경 알림과 함께 보내는 한 줄 — 이 확인창 안에서 쓰고 저장과 함께 나간다 */}
        <Input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)}
          placeholder={t('notify.messagePh') as string} data-testid="event-change-notify-message" />
      </Body>
    </Modal>
  );
}

const Body = styled.div`display:flex;flex-direction:column;gap:12px;padding:8px 0 4px;`;
const Lead = styled.p`margin:0;font-size:0.875rem;line-height:1.6;color:#334155;white-space:pre-line;`;
const Input = styled.input`
  height:40px;padding:0 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.875rem;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}
`;
