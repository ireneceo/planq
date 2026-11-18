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
//   ★ 몸통은 공용 `Common/ListSectionsMenu`(2026-11-18 — 폰 메일 목록이 두 번째로 쓰면서 뺐다). 여기는 칸 이름·저장 키·옛 접기 키 이어받기만.
import ListSectionsMenu, { useListSections } from '../Common/ListSectionsMenu';
import { scopedStorage } from '../../services/accounts';

export type PopoutSectionKey = 'cue' | 'add' | 'view';
export type PopoutSections = Record<PopoutSectionKey, boolean>;

const KEY = 'planq:taskPopout:sections';
const OLD_FOLD_KEY = 'planq:taskPopout:toolsOpen';
// 기본: Cue·입력은 보이고, 보기 설정 줄은 가림(10-12 «보기 설정은 늘 쓰던 대로» 그대로).
const DEFAULTS: PopoutSections = { cue: true, add: true, view: false };
const migrateOldFold = (): Partial<PopoutSections> | null => (scopedStorage.get(OLD_FOLD_KEY) === '1' ? { view: true } : null);

export function usePopoutSections(): [PopoutSections, (k: PopoutSectionKey) => void] {
  return useListSections<PopoutSectionKey>(KEY, DEFAULTS, migrateOldFold);
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
  <ListSectionsMenu<PopoutSectionKey>
    sections={sections} onToggle={onToggle} order={ORDER} labels={labels}
    label={label} groupLabel={groupLabel} hiddenActive={hiddenFilterActive}
    testId="task-popout-sections" itemTestIdPrefix="task-popout-section-"
  />
);

export default PopoutSectionsMenu;
