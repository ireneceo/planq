// 목록 위쪽 칸(검색·필터·입력 …)을 **각각** 보이고 가리는 공용 메뉴 — «보일 칸 고르기».
//
//   처음: 팝아웃 «오늘 내 업무» 세 칸(Irene 2026-11-10, QTask/PopoutSectionsMenu 머리말).
//   두 번째: 폰 메일 목록 검색·필터(Irene 2026-11-18 «모바일에서 메일리스트에서도 필터나 검색 가리고 싶으면
//   가리는 기능 넣어줄래? 팝아웃 업무관리에 있는 기능 선택 하이드 기능. 다른 곳에도 모바일에 있으면 좋은 거 만들어줘»).
//   → 두 번째 사용처가 생겨 껍데기를 뺐다(ui-components «껍데기는 빼서 같이 쓴다»). 화면마다 칸 이름·저장 키만 다르다.
//
//   ★ 새 메뉴를 그리지 않는다 — 공용 OverflowMenu(체크 표시 항목) 하나.
//   ★ 사람마다(계정 축 scopedStorage) 기억한다. 깨진 값·모르는 키는 기본값.
//   ★ 가린 칸의 값은 지우지 않는다 — 다시 보이면 그대로.
//   ★ 가린 칸이 지금 목록을 거르고 있으면(검색어·필터) 버튼에 점(`hiddenActive`) — 안 보이는 조건이 행을 거르면
//     «없어졌다» 로 읽힌다.
//   ★ 행위 버튼(일괄 처리·만들기)은 칸에 넣지 않는다 — 가리면 기능이 사라진다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import OverflowMenu from './OverflowMenu';
import { scopedStorage } from '../../services/accounts';
import { useMediaQuery } from '../../hooks/useMediaQuery';

export type ListSections<K extends string> = Record<K, boolean>;

function readSections<K extends string>(storageKey: string, defaults: ListSections<K>, migrate?: () => Partial<ListSections<K>> | null): ListSections<K> {
  const out = { ...defaults };
  try {
    const raw = scopedStorage.get(storageKey);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Record<string, unknown>>;
      (Object.keys(defaults) as K[]).forEach((k) => { if (typeof p[k] === 'boolean') out[k] = p[k] as boolean; });
      return out;
    }
    const m = migrate?.();
    if (m) return { ...out, ...m };
  } catch { /* 저장소 막힘 — 기본값 */ }
  return out;
}

/** 칸 보이기/가리기 상태 — `storageKey` 마다 사람별로 기억. `migrate` 는 저장값이 없을 때 옛 키를 이어받는 자리. */
export function useListSections<K extends string>(
  storageKey: string,
  defaults: ListSections<K>,
  migrate?: () => Partial<ListSections<K>> | null,
): [ListSections<K>, (k: K) => void] {
  const [sections, setSections] = useState<ListSections<K>>(() => readSections(storageKey, defaults, migrate));
  useEffect(() => { scopedStorage.set(storageKey, JSON.stringify(sections)); }, [storageKey, sections]);
  const toggle = useCallback((k: K) => setSections((s) => ({ ...s, [k]: !s[k] })), []);
  return [sections, toggle];
}

interface Props<K extends string> {
  sections: ListSections<K>;
  onToggle: (k: K) => void;
  order: K[];
  labels: Record<K, string>;
  /** 버튼 이름(보조기술·툴팁) — 없으면 common «보일 칸 고르기» */
  label?: string;
  /** 메뉴 맨 위 묶음 제목 — 없으면 common «목록 위에 보일 칸» */
  groupLabel?: string;
  /** 가린 칸이 지금 목록을 거르고 있다 → 버튼에 점 */
  hiddenActive: boolean;
  /** data-testid — 버튼 `<prefix>` · 항목 `<itemPrefix><key>` */
  testId: string;
  itemTestIdPrefix: string;
}

function ListSectionsMenu<K extends string>({ sections, onToggle, order, labels, label, groupLabel, hiddenActive, testId, itemTestIdPrefix }: Props<K>) {
  const { t } = useTranslation('common');
  return (
    <Slot
      label={label ?? (t('listSections.label', { defaultValue: '보일 칸 고르기' }) as string)}
      data-testid={testId}
      triggerActive={hiddenActive}
      triggerIcon={(
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.2" fill="#fff" />
          <line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2.2" fill="#fff" />
        </svg>
      )}
      items={order.map((k, i) => ({
        key: k,
        label: labels[k],
        checked: sections[k],
        testId: `${itemTestIdPrefix}${k}`,
        groupLabel: i === 0 ? (groupLabel ?? (t('listSections.group', { defaultValue: '목록 위에 보일 칸' }) as string)) : undefined,
        onClick: () => onToggle(k),
      }))}
    />
  );
}

// ── 폰(≤640) 목록용 한 벌 — 메일·Q talk·Q note·Q docs. 가리기는 폰에서만 적용하고 태블릿·데스크탑은 그대로다.
export interface PhoneListSections<K extends string> {
  isPhone: boolean;
  sections: ListSections<K>;
  toggle: (k: K) => void;
  /** 이 칸을 그릴까 — 폰이 아니면 늘 true */
  shown: (k: K) => boolean;
}
export function usePhoneListSections<K extends string>(storageKey: string, defaults: ListSections<K>): PhoneListSections<K> {
  const isPhone = useMediaQuery('(max-width: 640px)');
  const [sections, toggle] = useListSections<K>(storageKey, defaults);
  return { isPhone, sections, toggle, shown: (k: K) => !isPhone || sections[k] };
}

/** 폰에서만 보이는 «보일 칸 고르기» 버튼 — 칸 이름은 common `listSections.<key>`(search·filter·category). */
export function PhoneListSectionsMenu<K extends string>({ state, order, hiddenActive, testId }: {
  state: PhoneListSections<K>; order: K[]; hiddenActive: boolean; testId: string;
}) {
  const { t } = useTranslation('common');
  if (!state.isPhone) return null;
  const labels = Object.fromEntries(order.map((k) => [k, t(`listSections.${k}`) as string])) as Record<K, string>;
  return (
    <ListSectionsMenu<K> sections={state.sections} onToggle={state.toggle} order={order} labels={labels}
      hiddenActive={hiddenActive} testId={testId} itemTestIdPrefix={`${testId.replace(/sections$/, 'section')}-`} />
  );
}

// 헤더 아이콘(톱니·새 창·핀)과 같은 32px — 공용 트리거는 36 / 폰 44 라 헤더 줄에서만 맞춘다.
const Slot = styled(OverflowMenu)`
  & > button { min-width: 32px; width: 32px; height: 32px; }
  @media (max-width: 640px) { & > button { min-width: 32px; width: 32px; height: 32px; } }
`;

export default ListSectionsMenu;
