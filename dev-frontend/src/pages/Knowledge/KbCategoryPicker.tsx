// KbCategoryPicker — Q info 카테고리 고르기 (등록 창·상세 패널이 같이 쓴다).
//
//   ★ 2026-11-17 (Irene: "맨 끝에 X는 다 지우는 거야? 하나만 있는게 지워지지 않아. 그리고 검색하다가
//     없으면 추가하는 거 아니야? docs에 카테고리 ui랑 달라서 좀 헷갈려")
//   옛 모양: 고르는 칸 + 그 아래 «새 카테고리 이름» 칸 + [추가] 버튼 두 줄. 맨 끝 X(전체 지우기)와
//   칩 X 가 «최소 1개» 때문에 지우면 곧바로 «매뉴얼» 로 되돌아가(등록 창) 또는 아무 일도 안 일어나(상세)
//   눌러도 안 지워지는 것처럼 보였다.
//   지금: 업무 태그(TagPicker)·문서 카테고리와 같은 감각 — 한 칸에서 치면 후보가 좁혀지고, 없으면
//   «'이름' 카테고리 만들기» 가 그 자리에 뜬다. 전체 지우기 X 는 없다(칩마다 X).
//   마지막 하나도 지울 수 있다 — 0개를 어떻게 다룰지(저장 막기·안내)는 부르는 쪽이 정한다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { createKbCategory, LEGACY_KB_CATEGORIES, type KbCategoryRow } from '../../services/knowledge';

interface Props {
  businessId: number | null;
  value: string[];
  onChange: (next: string[]) => void;
  /** 워크스페이스 카테고리 사전 */
  master: KbCategoryRow[];
  orphan: string[];
  /** 새로 만든 뒤 사전 다시 읽기 */
  onCreated: () => Promise<void> | void;
  size?: 'sm' | 'md';
  hasError?: boolean;
  testId?: string;
}

const isLegacy = (c: string) => (LEGACY_KB_CATEGORIES as readonly string[]).includes(c);

const KbCategoryPicker: React.FC<Props> = ({ businessId, value, onChange, master, orphan, onCreated, size = 'sm', hasError, testId }) => {
  const { t } = useTranslation('knowledge');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = (c: string) => (isLegacy(c) ? (t(`cat.${c}`) as string) : c);

  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  const push = (c: string) => { if (c && !seen.has(c)) { seen.add(c); options.push({ value: c, label: label(c) }); } };
  for (const c of LEGACY_KB_CATEGORIES) push(c);
  for (const m of master) push(m.name);
  for (const o of orphan) push(o);
  for (const c of value) push(c);

  const create = async (raw: string) => {
    const name = raw.trim().slice(0, 40);
    if (!name || !businessId || busy) return;
    // 이미 있는 이름(기본 분류의 화면 이름 포함)이면 만들지 않고 고른다
    const hit = options.find(o => o.value === name || o.label === name);
    if (hit) { if (!value.includes(hit.value)) onChange([...value, hit.value]); return; }
    setBusy(true); setErr(null);
    try {
      await createKbCategory(businessId, name);
      await onCreated();
      onChange([...value, name]);
    } catch {
      setErr(t('modal.catCreateErr', '카테고리를 만들지 못했어요 — 다시 시도해 주세요') as string);
    } finally { setBusy(false); }
  };

  return (
    <div data-testid={testId}>
      <PlanQSelect size={size} isMulti creatable isClearable={false}
        hasError={hasError}
        isDisabled={busy} isLoading={busy}
        placeholder={t('modal.catPh', '카테고리 검색 또는 새로 입력') as string}
        value={value.map(c => ({ value: c, label: label(c) }))}
        onChange={(opts) => {
          const arr = Array.isArray(opts) ? opts : [];
          onChange(arr.map(o => String((o as PlanQSelectOption).value)));
        }}
        onCreateOption={(input: string) => { void create(input); }}
        formatCreateLabel={(input: string) => t('modal.catCreateNamed', { defaultValue: '\'{{name}}\' 카테고리 만들기', name: input }) as string}
        options={options} />
      {err && <ErrText role="alert">{err}</ErrText>}
    </div>
  );
};

export default KbCategoryPicker;

const ErrText = styled.div`
  margin-top: 4px; font-size: 0.6875rem; color: #B91C1C;
`;
