// 팝아웃 «오늘 내 업무» — 위쪽 세 칸(Cue 에게 말하기 · 할 일 입력 · 보기 기준·정렬)을 **각각** 보이고 가린다.
//
//   Irene 2026-11-10: *"Cue에게 말하기, 오늘할일 입력란, 필터라인 이렇게 3개 있잖아. 이거 각각 하이드했다 보이게 했다
//   해주면 안돼? 열고 접기하는 건 필요한 것만 딱 보기가 어려워. 우리 고객은 오늘 할일입력만 쓴대 …
//   필요할 때만 쓰고 가리고 하면 좋겠다."*
//   → 옛 PopoutToolsFold(10-12, 입력+보기 설정을 한 번에 접기)를 대신한다. 한 묶음 접기는 «입력만» 이 안 됐다.
//
//   ★ 새 메뉴를 그리지 않는다 — 헤더의 공용 OverflowMenu(체크 표시 항목) 하나.
//   ★ 사람마다(계정 축 scopedStorage) 기억한다 — 창마다가 아니다. 옛 접기 키가 «열림» 이면 보기 설정도 보이게 이어받는다.
//   ★ 보기 설정 줄을 가렸는데 «완료 가리기» 가 켜져 있으면 버튼에 점 — 안 보이는 필터가 행을 거르면 «업무가 없어졌다» 로 읽힌다
//     (옛 접기 요약 줄이 하던 일).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import OverflowMenu from '../Common/OverflowMenu';
import { scopedStorage } from '../../services/accounts';

export type PopoutSectionKey = 'cue' | 'add' | 'view';
export type PopoutSections = Record<PopoutSectionKey, boolean>;

const KEY = 'planq:taskPopout:sections';
const OLD_FOLD_KEY = 'planq:taskPopout:toolsOpen';
// 기본: Cue·입력은 보이고, 보기 설정 줄은 가림(10-12 «보기 설정은 늘 쓰던 대로» 그대로).
const DEFAULTS: PopoutSections = { cue: true, add: true, view: false };

function readSections(): PopoutSections {
  try {
    const raw = scopedStorage.get(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PopoutSections>;
      return {
        cue: typeof p.cue === 'boolean' ? p.cue : DEFAULTS.cue,
        add: typeof p.add === 'boolean' ? p.add : DEFAULTS.add,
        view: typeof p.view === 'boolean' ? p.view : DEFAULTS.view,
      };
    }
    if (scopedStorage.get(OLD_FOLD_KEY) === '1') return { ...DEFAULTS, view: true };
  } catch { /* 저장소 막힘 — 기본값 */ }
  return { ...DEFAULTS };
}

export function usePopoutSections(): [PopoutSections, (k: PopoutSectionKey) => void] {
  const [sections, setSections] = useState<PopoutSections>(readSections);
  useEffect(() => { scopedStorage.set(KEY, JSON.stringify(sections)); }, [sections]);
  const toggle = useCallback((k: PopoutSectionKey) => setSections((s) => ({ ...s, [k]: !s[k] })), []);
  return [sections, toggle];
}

interface Props {
  sections: PopoutSections;
  onToggle: (k: PopoutSectionKey) => void;
  label: string;
  groupLabel: string;
  labels: Record<PopoutSectionKey, string>;
  /** 가려진 보기 설정이 지금 행을 거르고 있다(완료 가림 등) */
  hiddenFilterActive: boolean;
}

const ORDER: PopoutSectionKey[] = ['cue', 'add', 'view'];

const PopoutSectionsMenu: React.FC<Props> = ({ sections, onToggle, label, groupLabel, labels, hiddenFilterActive }) => (
  <Slot
    label={label}
    data-testid="task-popout-sections"
    triggerActive={hiddenFilterActive}
    triggerIcon={(
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.2" fill="#fff" />
        <line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2.2" fill="#fff" />
      </svg>
    )}
    items={ORDER.map((k, i) => ({
      key: k,
      label: labels[k],
      checked: sections[k],
      testId: `task-popout-section-${k}`,
      groupLabel: i === 0 ? groupLabel : undefined,
      onClick: () => onToggle(k),
    }))}
  />
);

// 헤더 아이콘(보기 밀도·핀)과 같은 32px — 공용 트리거는 36 / 폰 44 라 이 줄에서만 맞춘다.
const Slot = styled(OverflowMenu)`
  & > button { min-width: 32px; width: 32px; height: 32px; }
  @media (max-width: 640px) { & > button { min-width: 32px; width: 32px; height: 32px; } }
`;

export default PopoutSectionsMenu;
