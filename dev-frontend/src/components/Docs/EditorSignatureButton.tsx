// 편집기 툴바의 [서명 항목 ▾] 메뉴 (2026-09-22 → 2026-10-05 서명 항목).
//
// PostEditor 에서 뺐다 — 그 파일이 800줄 god-file 문턱을 넘었고, 이 버튼은 **칸 번호를 정하는
// 규칙**(`utils/signatureFields.nextSlot`)을 서명 요청 창과 공유하므로 따로 서는 편이 맞다.
// 껍데기(ToolBtn)는 PostEditor 가 넘긴다 — 여기서 다시 그리면 툴바 규격이 갈라진다.
//
// 2026-10-05 (docs/SIGNATURE_ITEMS_DESIGN.md §9) — 한 패턴: «누구의 것(서명자 번호) × 무엇(서명·서명일·이름)».
//   서명 칸은 서명자가 그리거나 이미지를 올린다(사인·회사 스탬프 모두). 한 서명자에게 서명 칸을 여러 개 둘 수 있다.
//   Irene: «편집 들어가도 안나오는데» — 아이콘만 있던 버튼에 글자를 붙이고, 메뉴로 무엇을 넣는지 고르게 했다.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { nextSlot, type DocSignatureField } from '../../utils/signatureFields';
import type { SignatureItem } from './SignatureField';

interface Props {
  editor: Editor;
  /** PostEditor 의 ToolBtn — 툴바 규격은 한 곳에서만 정의한다 */
  as: React.ElementType;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

const EditorSignatureButton: React.FC<Props> = ({ editor, as: ToolBtn }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 화면 기준(fixed)으로 띄운다 — 툴바가 한 줄 가로 스크롤(overflow)이라 absolute 면 메뉴가 잘린다(TextStyleButton 과 같다)
  // 2026-10-21 Irene «앱화면에서 잘려서 보여 … 데스크탑 앱 밖으로 못 나가면 안잘리게» — 늘 버튼 아래 + 60vh 였다.
  //   창이 낮거나(설치 앱 창은 밖으로 못 나간다) 키보드가 올라오면 메뉴 아래가 잘렸다. 보이는 아래 끝을 재고
  //   모자라면 버튼 위로 뒤집고, 고른 쪽 자리를 max-height 로 준다 — 넘치면 메뉴 안에서 스크롤한다(CellFillButton 과 같은 방식).
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const place = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = Math.min(340, window.innerWidth - 32);
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const H = menuRef.current?.scrollHeight || 320;
    const below = r.bottom + 6;
    const spaceBelow = viewBottom - below - 8;
    const spaceAbove = r.top - 6 - (viewTop + 8);
    const up = spaceBelow < H && spaceAbove > spaceBelow;
    const room = Math.max(120, up ? spaceAbove : spaceBelow);
    const h = Math.min(H, room);
    setPos({
      top: up ? r.top - 6 - h : below,
      left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
      maxHeight: room,
    });
  };
  // 처음 열 때는 메뉴 높이를 모른다 — 그려진 뒤 실제 높이로 한 번 더 맞춘다
  const measuredRef = useRef(false);
  useLayoutEffect(() => {
    if (!open) { measuredRef.current = false; return; }
    place();
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (open && pos && !measuredRef.current && menuRef.current) { measuredRef.current = true; place(); }
  }, [open, pos]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 문서에 이미 있는 서명자(서명 칸 기준) — 번호·쪽·이름표
  const signers = (): DocSignatureField[] => {
    const found = new Map<number, DocSignatureField>();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'signatureField' && (n.attrs.item || 'sign') === 'sign') {
        const slot = Number(n.attrs.slot) || 1;
        if (!found.has(slot)) found.set(slot, { slot, party: n.attrs.party === 'us' ? 'us' : 'them', label: n.attrs.label || null });
      }
    });
    return [...found.values()].sort((a, b) => a.slot - b.slot);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (!wrapRef.current?.contains(tg) && !menuRef.current?.contains(tg)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place);
      document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const insert = (slot: number, item: SignatureItem, party: 'us' | 'them', label: string | null) => {
    editor.chain().focus().insertSignatureField({ slot, party, label, item }).run();
    setOpen(false);
  };

  const list = open ? signers() : [];
  const newSlot = nextSlot(list);
  const partyLabel = (p: 'us' | 'them') => (p === 'us'
    ? t('editor.sigFieldUs', { defaultValue: '보내는 쪽' })
    : t('editor.sigFieldThem', { defaultValue: '받는 쪽' })) as string;
  const ITEMS: Array<{ item: SignatureItem; label: string }> = [
    { item: 'sign', label: t('editor.sigItemSignLong', { defaultValue: '서명 (그리기·이미지)' }) as string },
    { item: 'date', label: t('editor.sigItemDate', { defaultValue: '서명일' }) as string },
    { item: 'name', label: t('editor.sigItemName', { defaultValue: '이름' }) as string },
  ];
  const rows: Array<DocSignatureField & { isNew?: boolean }> = [
    ...list,
    { slot: newSlot, party: newSlot === 1 ? 'us' : 'them', label: null, isNew: true },
  ];

  return (
    <Wrap ref={wrapRef}>
      <ToolBtn
        type="button"
        data-testid="editor-insert-signature"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t('editor.insertSignature', { defaultValue: '서명 항목 — 서명·서명일·이름이 들어갈 자리' })}
        aria-label={t('editor.insertSignatureAria', { defaultValue: '서명 항목 넣기' })}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17c3 0 4-8 7-8s3 6 6 6c2 0 3-2 5-2" />
          <line x1="3" y1="21" x2="21" y2="21" />
        </svg>
        <BtnText>{t('editor.insertSignatureShort', { defaultValue: '서명 항목' })} ▾</BtnText>
      </ToolBtn>
      {open && pos && createPortal(
        <Menu ref={menuRef} role="menu" data-testid="editor-signature-menu" style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}>
          <MenuHint>{t('editor.sigMenuHint', { defaultValue: '누구의 칸인지 고르고, 넣을 것을 누르세요. 커서 자리에 들어갑니다.' })}</MenuHint>
          {rows.map((s) => (
            <SignerRow key={`${s.slot}${s.isNew ? '-new' : ''}`}>
              <SignerName>
                {CIRCLED[s.slot - 1] || `(${s.slot})`}{' '}
                {s.isNew ? t('editor.sigNewSigner', { defaultValue: '새 서명자' }) : (s.label || partyLabel(s.party))}
                <SignerParty>{partyLabel(s.party)}</SignerParty>
              </SignerName>
              <ItemBtns>
                {ITEMS.map((it) => (
                  <ItemBtn key={it.item} type="button" role="menuitem"
                    data-testid={`editor-sig-insert-${s.slot}-${it.item}`}
                    onClick={() => insert(s.slot, it.item, s.party, it.item === 'sign' ? s.label : null)}>
                    + {it.label}
                  </ItemBtn>
                ))}
              </ItemBtns>
            </SignerRow>
          ))}
        </Menu>,
        document.body,
      )}
    </Wrap>
  );
};

export default EditorSignatureButton;

const Wrap = styled.span`position: relative; display: inline-flex;`;
const BtnText = styled.span`margin-left: 4px; font-size: 0.75rem; font-weight: 600; white-space: nowrap;`;
const Menu = styled.div`
  /* 버튼 왼쪽 기준으로 펼친다 — 버튼은 툴바 앞쪽에 있어 오른쪽 기준이면 왼쪽 목록 패널 밑으로 잘렸다(실측 1440).
     자리(top·left·max-height)는 place() 가 버튼 rect 와 보이는 화면 높이로 정한다.
     z 는 Q note 메모 팝업(2301) 안의 편집기에서도 위에 서도록 포털 드롭다운 층(10000) — 1200 이면 팝업 뒤로 깔렸다. */
  position: fixed; z-index: 10000;
  width: min(340px, calc(100vw - 32px)); max-height: 60vh; overflow-y: auto;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); padding: 8px;
`;
const MenuHint = styled.div`font-size: 0.75rem; color: #64748B; padding: 4px 6px 8px;`;
const SignerRow = styled.div`padding: 6px; border-top: 1px solid #F1F5F9; &:first-of-type { border-top: none; }`;
const SignerName = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; display: flex; align-items: center; gap: 6px;`;
const SignerParty = styled.span`font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #F0FDFA; border-radius: 4px; padding: 1px 6px;`;
const ItemBtns = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;`;
const ItemBtn = styled.button`
  border: 1px solid #CBD5E1; background: #fff; border-radius: 6px; padding: 6px 10px;
  font-size: 0.75rem; color: #0F172A; cursor: pointer; min-height: 32px;
  &:hover { border-color: #14B8A6; color: #0F766E; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) { min-height: 40px; }
`;
