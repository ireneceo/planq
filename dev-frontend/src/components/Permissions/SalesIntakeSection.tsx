// SalesIntakeSection — 설정 › 권한 «상담 유입» 카드 (#449, docs/SALES_INTAKE_DESIGN.md §4.1)
//
// 메일이 Q sales 상담으로 **어떻게** 들어오는지 정한다.
//   수동 — 메일·채팅에서 [상담으로 보내기] 한 것만 (기본값, Irene 결정 2026-10-02)
//   자동 — 답장한 상대·개인 주소에서 온 메일도 들어온다(종전 기준)
// 채팅·게스트 링크는 모드와 무관하다(우리 창구로 들어온 사람).
// ★ 바꿔도 메일·원장은 그대로다 — 상담 목록은 원본에서 파생되므로 되돌리면 그대로 돌아온다.
// ★ 고치는 사람은 고객 창구 카드와 같은 판정(owner) — 서버 assertEntryAdmin 과 같은 값.
import React, { useEffect, useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import { saveSalesIntake, patchSalesIntake, type SalesIntake, type SaleCriterion } from '../../services/sale';
import CriteriaList, { type CriteriaGroup } from '../Common/CriteriaList';

type Mode = 'manual' | 'auto';
interface Props { businessId: number; isOwner: boolean }

const SalesIntakeSection: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<Mode | null>(null);
  // 래퍼가 저장할 때 **최신값**을 읽는다 — 클로저는 클릭 전 값을 본다(자동저장 절).
  const modeRef = useRef<Mode | null>(null);
  modeRef.current = mode;
  const savedRef = useRef<Mode | null>(null);
  // Q sales 안내 줄의 [설정에서 바꾸기] 가 `?focus=sales-intake` 로 보낸다 — 카드가 비동기로 그려지므로
  // 카드 **자신이** 그려진 뒤 스크롤한다. 쿼리는 deps 로 읽는다(keep-alive 탭에서 초기값 1회만 읽으면 두 번째부터 안 걸린다).
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const cardRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);

  // 2026-10-15 — 상담 유입 기준 공개·끄기·주소 목록(docs/MAIL_CRITERIA_DESIGN.md §7). 목록 순서는 서버(SALE_CATALOG)가 정한다.
  const [intake, setIntake] = useState<SalesIntake | null>(null);
  const [criteria, setCriteria] = useState<SaleCriterion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [critErr, setCritErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ always: string; never: string }>({ always: '', never: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
      const j = await r.json().catch(() => null);
      if (!alive || !r.ok || !j?.success) return;
      const m: Mode = j.data?.sales_intake?.mail === 'auto' ? 'auto' : 'manual';
      savedRef.current = m;
      setMode(m);
      setIntake(j.data?.sales_intake || null);
      setCriteria(Array.isArray(j.data?.sales_criteria) ? j.data.sales_criteria : []);
    })();
    return () => { alive = false; };
  }, [businessId]);

  const patch = async (p: Partial<Pick<SalesIntake, 'off' | 'domains'>>, id: string) => {
    setBusyId(id); setCritErr(null);
    try {
      const d = await patchSalesIntake(businessId, p);
      setIntake(d.sales_intake);
      return true;
    } catch (e) {
      const code = (e as Error).message;
      setCritErr(t(code === 'invalid_domain_always' ? 'salesIntake.criteria.errFreeMail'
        : code === 'invalid_domain' ? 'salesIntake.criteria.errFormat' : 'salesIntake.criteria.errSave') as string);
      return false;
    } finally { setBusyId(null); }
  };
  const onToggle = (id: string, next: boolean) => {
    if (!intake) return;
    const off = next ? intake.off.filter((x) => x !== id) : [...intake.off, id];
    void patch({ off }, id);
  };
  const addEntry = async (k: 'always' | 'never') => {
    if (!intake) return;
    const v = draft[k].trim().toLowerCase();
    if (!v) return;
    const ok = await patch({ domains: { ...intake.domains, [k]: [...intake.domains[k], v] } }, `domain_${k}`);
    if (ok) setDraft((d) => ({ ...d, [k]: '' }));
  };
  const removeEntry = (k: 'always' | 'never', v: string) => {
    if (!intake) return;
    void patch({ domains: { ...intake.domains, [k]: intake.domains[k].filter((x) => x !== v) } }, `domain_${k}`);
  };
  const listEditor = (k: 'always' | 'never') => intake && (
    <ListBox data-testid={`sales-intake-list-${k}`}>
      {intake.domains[k].length > 0 && (
        <Chips>
          {intake.domains[k].map((v) => (
            <Chip key={v}>
              {v}
              {isOwner && (
                // autosave-exempt: 지우기는 액션이다(누르면 바로 반영 — 메일·원장은 그대로라 다시 넣으면 돌아온다)
                <ChipX type="button" aria-label={t('salesIntake.criteria.remove', { v }) as string}
                  disabled={busyId === `domain_${k}`} onClick={() => removeEntry(k, v)}>×</ChipX>
              )}
            </Chip>
          ))}
        </Chips>
      )}
      {isOwner && (
        <AddRow>
          {/* autosave-exempt: 추가는 액션이다(주소를 다 쓰고 [추가] 를 누른다) */}
          <AddInput value={draft[k]} placeholder={t('salesIntake.criteria.placeholder') as string}
            data-testid={`sales-intake-input-${k}`}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void addEntry(k); } }} />
          <AddBtn type="button" data-testid={`sales-intake-add-${k}`} disabled={!draft[k].trim() || busyId === `domain_${k}`}
            onClick={() => { void addEntry(k); }}>
            {t('salesIntake.criteria.add') as string}
          </AddBtn>
        </AddRow>
      )}
    </ListBox>
  );
  const groups: CriteriaGroup[] = intake ? [{
    key: 'sale',
    title: t('salesIntake.criteria.title') as string,
    hint: t('salesIntake.criteria.hint') as string,
    items: criteria.map((c) => ({
      id: c.id,
      title: t(`salesIntake.criteria.${c.id}.title`) as string,
      desc: t(`salesIntake.criteria.${c.id}.desc`) as string,
      // 목록 항목(늘 상담·상담 아님)은 스위치가 아니라 입력이다 — 잠긴 것처럼 «기본» 글자 대신 목록을 보인다.
      lockable: c.lockable || !!c.list,
      enabled: !intake.off.includes(c.id),
      extra: c.list ? listEditor(c.list) : undefined,
    })),
  }] : [];

  useEffect(() => {
    if (focus !== 'sales-intake' || !mode || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: 'center' });
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(id);
  }, [focus, mode]);

  const persist = async () => {
    const m = modeRef.current;
    if (!m || m === savedRef.current) return;
    try {
      await saveSalesIntake(businessId, m);
      savedRef.current = m;
    } catch (e) {
      setMode(savedRef.current);      // 실패하면 되돌리고 던진다 — 래퍼가 ! 를 띄운다
      throw e;
    }
  };

  if (!mode) return null;
  return (
    <Card ref={cardRef} $flash={flash} data-testid="sales-intake-card">
      <Head>
        <Title>{t('salesIntake.title') as string}</Title>
        <Desc>{t('salesIntake.mail.label') as string}</Desc>
      </Head>
      <AutoSaveField type="toggle" onSave={persist}>
        <SegmentedToggle role="radiogroup" aria-label={t('salesIntake.mail.label') as string}>
          {(['manual', 'auto'] as Mode[]).map((m) => (
            <SegmentedBtn key={m} type="button" role="radio" aria-checked={mode === m}
              data-testid={`sales-intake-${m}`}
              $active={mode === m} disabled={!isOwner}
              onClick={() => setMode(m)}>
              {t(`salesIntake.mail.${m}Short`) as string}
            </SegmentedBtn>
          ))}
        </SegmentedToggle>
      </AutoSaveField>
      <Explain>{t(`salesIntake.mail.${mode}`) as string}</Explain>
      <Hint>{t('salesIntake.mail.hint') as string}</Hint>
      {!isOwner && <Hint>{t('salesIntake.ownerOnly') as string}</Hint>}
      {intake && criteria.length > 0 && (
        <CriteriaWrap data-testid="sales-intake-criteria">
          <Hint>{t('salesIntake.criteria.vsMail') as string}</Hint>
          <CriteriaList groups={groups} canEdit={isOwner} busyId={busyId} onToggle={onToggle} testIdPrefix="sales-criteria" />
          {critErr && <Err>{critErr}</Err>}
        </CriteriaWrap>
      )}
    </Card>
  );
};

export default SalesIntakeSection;

const Card = styled.div<{ $flash?: boolean }>`
  background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;
  display:flex;flex-direction:column;gap:10px;align-items:flex-start;
  transition:border-color .3s, box-shadow .3s;
  ${(p) => p.$flash && css`border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.18);`}
`;
const Head = styled.div`display:flex;flex-direction:column;gap:4px;`;
const Title = styled.div`font-size:0.9375rem;font-weight:700;color:#0f172a;`;
const Desc = styled.div`font-size:0.8125rem;color:#64748b;line-height:1.5;`;
const Explain = styled.div`font-size:0.8125rem;color:#334155;line-height:1.5;`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const CriteriaWrap = styled.div`align-self:stretch;display:flex;flex-direction:column;gap:8px;margin-top:6px;`;
const Err = styled.div`font-size:0.75rem;font-weight:600;color:#B45309;`;
const ListBox = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:4px;`;
const Chips = styled.div`display:flex;flex-wrap:wrap;gap:4px;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;gap:2px;padding:2px 4px 2px 8px;border-radius:999px;
  background:#F1F5F9;color:#334155;font-size:0.75rem;max-width:100%;word-break:break-all;
`;
const ChipX = styled.button`
  border:none;background:none;cursor:pointer;color:#64748B;width:28px;height:32px;border-radius:999px;font-size:0.875rem;
  &:hover:not(:disabled){background:#E2E8F0;}
`;
const AddRow = styled.div`display:flex;gap:6px;flex-wrap:wrap;`;
const AddInput = styled.input`
  flex:1 1 200px;min-width:0;max-width:320px;height:36px;padding:0 10px;border:1px solid #E2E8F0;border-radius:8px;
  font-size:0.8125rem;color:#334155;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;
const AddBtn = styled.button`
  height:36px;padding:0 14px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;color:#334155;
  font-size:0.8125rem;font-weight:600;cursor:pointer;
  &:disabled{opacity:.5;cursor:default;}
`;
