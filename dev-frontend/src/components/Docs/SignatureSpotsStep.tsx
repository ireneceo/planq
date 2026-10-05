// 서명 요청 1단계 — «서명 자리» (docs/SIGNATURE_ITEMS_DESIGN.md §2-1·§9, 2026-10-05)
//
// Irene: *"UI/UX 에서 바로 알아야 하는 거야."* — 서명은 **서명 항목 칸에만** 들어간다는 사실을 이 단계가 말한다.
//   · 문서에 있는 서명자(서명 칸 기준) 목록 — 이름표·보내는/받는 쪽을 여기서 바로 고친다(문서에 저장)
//   · 본문에 손으로 적은 «서명: ____ / 서명일: ____ / 회사 스탬프:» 를 찾아 [서명 항목으로 바꾸기]
//   · 자리가 하나도 없으면 보낼 수 없다고 말하고 [문서 끝에 추가]
// 문서 저장은 부모가 한다(onSaveDoc) — 같은 문서를 두 곳에서 PUT 하지 않는다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  readSignerItems, findManualSignatureSpots, replaceManualSpots, applySignerSettings,
} from '../../utils/signatureFields';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

interface Props {
  contentJson: unknown;
  busy: boolean;
  /** 서명 요청이 살아 있어 문서가 잠겼다 — 보여주기만 한다 */
  locked?: boolean;
  onSaveDoc: (next: unknown) => Promise<void>;
  onOpenEditor?: () => void;
}

const SignatureSpotsStep: React.FC<Props> = ({ contentJson, busy: busyIn, locked = false, onSaveDoc, onOpenEditor }) => {
  const { t } = useTranslation('qdocs');
  const busy = busyIn || locked;
  const signers = useMemo(() => readSignerItems(contentJson), [contentJson]);
  const spots = useMemo(() => (signers.length ? [] : findManualSignatureSpots(contentJson)), [contentJson, signers.length]);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const partyText = (p: 'us' | 'them') => (p === 'us'
    ? t('editor.sigFieldUs', { defaultValue: '보내는 쪽' })
    : t('editor.sigFieldThem', { defaultValue: '받는 쪽' })) as string;

  const convertSpots = async () => {
    const parties: Record<number, 'us' | 'them'> = {};
    spots.forEach((s) => { if (!parties[s.slot]) parties[s.slot] = s.slot === 1 ? 'us' : 'them'; });
    await onSaveDoc(replaceManualSpots(contentJson, spots, parties));
  };
  const addAtEnd = async () => {
    let doc: { type: string; content?: unknown[] } = { type: 'doc', content: [] };
    try { doc = (typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson) as typeof doc || doc; } catch { /* 빈 문서 */ }
    await onSaveDoc({
      ...doc, type: 'doc',
      content: [
        ...((doc.content as unknown[]) || []),
        { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null, item: 'sign' } },
        { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null, item: 'date' } },
        { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null, item: 'sign' } },
        { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null, item: 'date' } },
      ],
    });
  };

  const counts = spots.reduce((a, s) => { a[s.item] = (a[s.item] || 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <Wrap data-testid="sign-step-spots">
      {locked && <Locked data-testid="sign-spots-locked">{t('sign.spots.locked', { defaultValue: '서명 요청을 보낸 문서라 서명 자리는 바꿀 수 없어요. 아래 자리에 서명할 사람을 더 지정할 수는 있어요.' })}</Locked>}
      <Hint>{t('sign.spots.hint', { defaultValue: '서명·서명일·이름이 들어갈 자리예요. 서명은 이 자리에만 들어가요.' })}</Hint>

      {signers.length > 0 && (
        <List>
          {signers.map((s) => (
            <Row key={s.slot} data-testid={`sign-spot-${s.slot}`}>
              <Top>
                <No>{CIRCLED[s.slot - 1] || `(${s.slot})`}</No>
                <LabelInput
                  value={labels[s.slot] ?? (s.label || '')}
                  placeholder={partyText(s.party)}
                  aria-label={t('sign.spots.labelAria', { defaultValue: '서명자 이름표' }) as string}
                  disabled={busy}
                  onChange={(e) => setLabels((m) => ({ ...m, [s.slot]: e.target.value }))}
                  onBlur={() => {
                    const v = (labels[s.slot] ?? (s.label || '')).trim();
                    if (v !== (s.label || '')) void onSaveDoc(applySignerSettings(contentJson, s.slot, { label: v || null }));
                  }}
                />
                <PartyToggle role="radiogroup" aria-label={t('sign.spots.partyAria', { defaultValue: '보내는 쪽 / 받는 쪽' }) as string}>
                  {(['us', 'them'] as const).map((p) => (
                    <PartyBtn key={p} type="button" role="radio" aria-checked={s.party === p} $on={s.party === p} disabled={busy}
                      onClick={() => { if (s.party !== p) void onSaveDoc(applySignerSettings(contentJson, s.slot, { party: p })); }}>
                      {partyText(p)}
                    </PartyBtn>
                  ))}
                </PartyToggle>
              </Top>
              <Items>
                <Item>{t('sign.spots.signN', { n: s.sign, defaultValue: '서명 {{n}}칸' })}</Item>
                {s.date && <Item>{t('editor.sigItemDate', { defaultValue: '서명일' })}</Item>}
                {s.name && <Item>{t('editor.sigItemName', { defaultValue: '이름' })}</Item>}
              </Items>
            </Row>
          ))}
        </List>
      )}

      {signers.length === 0 && spots.length > 0 && (
        <Found data-testid="sign-spots-found">
          <FoundTitle>{t('sign.spots.foundTitle', { n: spots.length, defaultValue: '본문에 손으로 적은 서명 자리 {{n}}곳을 찾았어요' })}</FoundTitle>
          <FoundBody>
            {t('sign.spots.foundBody', {
              sign: counts.sign || 0, date: counts.date || 0, people: new Set(spots.map((s) => s.slot)).size,
              defaultValue: '{{people}}명 · 서명(사인·스탬프) {{sign}} · 서명일 {{date}}. 글자로 적은 자리에는 아무것도 들어가지 않아요 — 서명 항목으로 바꾸면 그 자리에 들어갑니다.',
            })}
          </FoundBody>
          <SpotList>
            {spots.filter((s) => s.label).map((s) => <li key={s.index}>{CIRCLED[s.slot - 1]} {s.label}</li>)}
          </SpotList>
          <Primary type="button" data-testid="sign-spots-convert" disabled={busy} onClick={() => void convertSpots()}>
            {t('sign.spots.convert', { defaultValue: '이 자리들을 서명 항목으로 바꾸기' })}
          </Primary>
        </Found>
      )}

      {signers.length === 0 && spots.length === 0 && (
        <Empty data-testid="sign-spots-empty">
          <EmptyTitle>{t('sign.spots.emptyTitle', { defaultValue: '이 문서에는 서명 자리가 없어 보낼 수 없어요' })}</EmptyTitle>
          <EmptyBody>{t('sign.spots.emptyBody', { defaultValue: '문서 끝에 보내는 쪽·받는 쪽 서명 자리를 넣거나, 편집에서 [서명 항목] 으로 원하는 위치에 넣으세요.' })}</EmptyBody>
          <Btns>
            <Primary type="button" data-testid="sign-spots-add-end" disabled={busy} onClick={() => void addAtEnd()}>
              {t('sign.spots.addEnd', { defaultValue: '+ 문서 끝에 서명 자리 추가' })}
            </Primary>
            {onOpenEditor && (
              <Secondary type="button" disabled={busy} onClick={onOpenEditor}>
                {t('sign.spots.openEditor', { defaultValue: '편집에서 직접 넣기' })}
              </Secondary>
            )}
          </Btns>
        </Empty>
      )}
    </Wrap>
  );
};

export default SignatureSpotsStep;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Locked = styled.div`font-size: 0.8125rem; color: #334155; background: #F1F5F9; border-radius: 8px; padding: 8px 10px; line-height: 1.5;`;
const Hint = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.div`border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; background: #fff;`;
const Top = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const No = styled.span`font-size: 0.9375rem; font-weight: 700; color: #0F766E; flex-shrink: 0;`;
const LabelInput = styled.input`
  flex: 1 1 160px; min-width: 0; height: 36px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const PartyToggle = styled.div`display: inline-flex; background: #F1F5F9; border-radius: 8px; padding: 2px; flex-shrink: 0;`;
const PartyBtn = styled.button<{ $on: boolean }>`
  height: 32px; padding: 0 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  background: ${(p) => (p.$on ? '#fff' : 'transparent')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
  box-shadow: ${(p) => (p.$on ? '0 1px 2px rgba(15,23,42,0.08)' : 'none')};
`;
const Items = styled.div`display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;`;
const Item = styled.span`font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #F0FDFA; border-radius: 4px; padding: 2px 8px;`;
const Found = styled.div`border: 1px solid #99F6E4; background: #F0FDFA; border-radius: 10px; padding: 12px;`;
const FoundTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const FoundBody = styled.div`font-size: 0.8125rem; color: #334155; margin-top: 4px; line-height: 1.5;`;
const SpotList = styled.ul`margin: 8px 0; padding-left: 18px; font-size: 0.8125rem; color: #0F172A;`;
const Empty = styled.div`border: 1px solid #FED7AA; background: #FFF7ED; border-radius: 10px; padding: 12px;`;
const EmptyTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #9A3412;`;
const EmptyBody = styled.div`font-size: 0.8125rem; color: #7C2D12; margin-top: 4px; line-height: 1.5;`;
const Btns = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;`;
const Primary = styled.button`
  height: 36px; padding: 0 14px; border: none; border-radius: 8px; background: #0D9488; color: #fff;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Secondary = styled.button`
  height: 36px; padding: 0 14px; border: 1px solid #CBD5E1; border-radius: 8px; background: #fff; color: #0F172A;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
`;
