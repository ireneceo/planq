// 개인 일정 드로어 마운트 — 선택된 id 로 이벤트를 찾아 열고, 수정/삭제 결과를 목록에 반영한다.
//
// QCalendarPage 에서 분리 (god-file 가드: 컴포넌트 800줄). 로직은 그대로 옮겼다.
import PersonalEventDrawer from './PersonalEventDrawer';
import type { PersonalCalendarEvent } from './types';

interface Props {
  selectedId: string | null;
  events: PersonalCalendarEvent[];
  businessId: number | null;
  onClose: () => void;
  setEvents: React.Dispatch<React.SetStateAction<PersonalCalendarEvent[]>>;
}

export default function PersonalEventDrawerHost({ selectedId, events, businessId, onClose, setEvents }: Props) {
  if (!selectedId || !businessId) return null;
  const p = events.find((e) => e.id === selectedId);
  if (!p) return null;
  return (
    <PersonalEventDrawer
      event={p}
      businessId={businessId}
      onClose={onClose}
      onChanged={(next) => {
        // 삭제(null)면 목록에서 내린다 — 남겨두면 다른 기기에서 영영 잔존한다.
        setEvents((prev) => (next
          ? prev.map((e) => (e.id === p.id ? next : e))
          : prev.filter((e) => e.id !== p.id)));
        if (!next) onClose();
      }}
    />
  );
}
