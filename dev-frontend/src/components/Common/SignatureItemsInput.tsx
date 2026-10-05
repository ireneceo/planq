// 서명 칸 채우기 — 서명자 한 사람의 서명 칸 N개를 «그리기 또는 이미지 올리기» 로 채운다 (2026-10-05)
// 설계 docs/SIGNATURE_ITEMS_DESIGN.md §9 — 사인·회사 스탬프 모두 «서명 칸» 한 종류다.
//
// 공개 서명 페이지와 앱 안 서명이 **같은 것**을 쓴다(그리기 판 SignaturePad 와 같은 이유 — 베끼면 갈라진다).
// 값은 밖으로 나가지 않는다 — 부모가 ref.getItems() 로 보낼 때 읽는다. 채워졌는지는 onReadyChange 로 알린다.
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';

export interface SignatureItemValue { mode: 'draw' | 'image'; b64: string }
export interface SignatureItemsHandle { getItems: () => SignatureItemValue[] | null }

interface Props {
  count: number;
  disabled?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

const MAX_FILE = 5 * 1024 * 1024;   // 서버 상한(base64 ≈ 7MB)과 같은 문턱
const MAX_EDGE = 1200;               // 올린 이미지 긴 변 — 서명본·PDF 에 충분하고 요청이 가볍다
const ACCEPT = 'image/png,image/jpeg,image/webp';

/** 큰 이미지는 줄인다. PNG·WEBP 는 투명(스탬프 배경)을 지키려고 PNG 로, JPEG 는 JPEG 로. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read_failed'));
    fr.onload = () => {
      const src = String(fr.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('read_failed'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        if (scale >= 1 && /^data:image\/(png|jpeg|webp);base64,/.test(src)) { resolve(src); return; }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('read_failed')); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(file.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png'));
      };
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}

interface ItemState { mode: 'draw' | 'image'; drawn: boolean; image: string | null; error: string | null }

const SignatureItemsInput = React.forwardRef<SignatureItemsHandle, Props>(({ count, disabled, onReadyChange }, ref) => {
  const { t } = useTranslation('qdocs');
  const n = Math.max(1, count || 1);
  const [items, setItems] = useState<ItemState[]>(() => Array.from({ length: n }, () => ({ mode: 'draw', drawn: false, image: null, error: null })));
  const pads = useRef<Array<SignaturePadHandle | null>>([]);
  const files = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setItems((prev) => Array.from({ length: n }, (_, i) => prev[i] || { mode: 'draw', drawn: false, image: null, error: null }));
  }, [n]);

  const ready = items.length === n && items.every((it) => (it.mode === 'draw' ? it.drawn : !!it.image));
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);

  const patch = useCallback((i: number, p: Partial<ItemState>) => {
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...p } : it)));
  }, []);

  useImperativeHandle(ref, () => ({
    getItems: () => {
      const out: SignatureItemValue[] = [];
      for (let i = 0; i < n; i += 1) {
        const it = items[i];
        if (!it) return null;
        if (it.mode === 'image') { if (!it.image) return null; out.push({ mode: 'image', b64: it.image }); }
        else { const d = pads.current[i]?.toDataURL(); if (!d) return null; out.push({ mode: 'draw', b64: d }); }
      }
      return out;
    },
  }), [items, n]);

  const pick = async (i: number, file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) { patch(i, { error: t('signItems.badType', { defaultValue: 'PNG·JPG·WEBP 이미지만 올릴 수 있어요.' }) as string }); return; }
    if (file.size > MAX_FILE) { patch(i, { error: t('signItems.tooLarge', { defaultValue: '5MB 이하 이미지만 올릴 수 있어요.' }) as string }); return; }
    try { patch(i, { image: await readImage(file), error: null }); }
    catch { patch(i, { error: t('signItems.readFailed', { defaultValue: '이미지를 읽지 못했어요. 다른 파일로 해 보세요.' }) as string }); }
  };

  return (
    <List data-testid="sign-items">
      {items.map((it, i) => (
        <Item key={i} data-testid={`sign-item-${i}`}>
          <ItemHead>
            <ItemName>{n > 1
              ? t('signItems.nth', { n: i + 1, total: n, defaultValue: '서명 칸 {{n}} / {{total}}' })
              : t('signItems.one', { defaultValue: '서명' })}</ItemName>
            <Tabs role="radiogroup" aria-label={t('signItems.modeAria', { defaultValue: '서명 방법' }) as string}>
              {(['draw', 'image'] as const).map((m) => (
                <Tab key={m} type="button" role="radio" aria-checked={it.mode === m} $on={it.mode === m} disabled={disabled}
                  data-testid={`sign-item-${i}-${m}`} onClick={() => patch(i, { mode: m, error: null })}>
                  {m === 'draw' ? t('signItems.draw', { defaultValue: '그리기' }) : t('signItems.image', { defaultValue: '이미지 올리기' })}
                </Tab>
              ))}
            </Tabs>
          </ItemHead>
          {/* 그리기 판은 감추기만 한다 — 이미지로 바꿨다 돌아와도 그린 것이 남는다 */}
          <PadBox $hidden={it.mode !== 'draw'}>
            <SignaturePad ref={(h) => { pads.current[i] = h; }} onEmptyChange={(e) => patch(i, { drawn: !e })}
              ariaLabel={t('signItems.padAria', { n: i + 1, defaultValue: '서명 칸 {{n}} 그리기' }) as string} />
            <ClearRow>
              <Clear type="button" disabled={disabled || !it.drawn} onClick={() => pads.current[i]?.clear()}>
                {t('signItems.clear', { defaultValue: '지우기' })}
              </Clear>
            </ClearRow>
          </PadBox>
          {it.mode === 'image' && (
            <ImageBox>
              {it.image
                ? <Preview><img src={it.image} alt="" /></Preview>
                : <ImageHint>{t('signItems.imageHint', { defaultValue: '사인·도장·회사 스탬프 이미지(PNG 권장 — 배경이 투명하면 문서에 자연스럽게 얹혀요)' })}</ImageHint>}
              <input ref={(el) => { files.current[i] = el; }} type="file" accept={ACCEPT} hidden
                data-testid={`sign-item-${i}-file`}
                onChange={(e) => { void pick(i, e.target.files?.[0]); e.target.value = ''; }} />
              <PickBtn type="button" disabled={disabled} onClick={() => files.current[i]?.click()}>
                {it.image ? t('signItems.replace', { defaultValue: '다른 이미지로' }) : t('signItems.pick', { defaultValue: '이미지 고르기' })}
              </PickBtn>
            </ImageBox>
          )}
          {it.error && <Err role="alert">{it.error}</Err>}
        </Item>
      ))}
    </List>
  );
});

SignatureItemsInput.displayName = 'SignatureItemsInput';
export default SignatureItemsInput;

const List = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Item = styled.div`border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px; background: #fff;`;
const ItemHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;`;
const ItemName = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Tabs = styled.div`display: inline-flex; background: #F1F5F9; border-radius: 8px; padding: 2px;`;
const Tab = styled.button<{ $on: boolean }>`
  height: 32px; padding: 0 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  background: ${(p) => (p.$on ? '#fff' : 'transparent')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')};
  box-shadow: ${(p) => (p.$on ? '0 1px 2px rgba(15,23,42,0.08)' : 'none')};
  @media (max-width: 640px) { height: 40px; }
`;
const PadBox = styled.div<{ $hidden: boolean }>`${(p) => (p.$hidden ? 'display: none;' : '')}`;
const ClearRow = styled.div`display: flex; justify-content: flex-end; margin-top: 4px;`;
const Clear = styled.button`
  border: none; background: none; color: #64748B; font-size: 0.75rem; cursor: pointer; padding: 4px 6px; min-height: 32px;
  &:disabled { color: #CBD5E1; cursor: default; }
`;
const ImageBox = styled.div`display: flex; flex-direction: column; align-items: flex-start; gap: 8px;`;
const ImageHint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Preview = styled.div`
  width: 100%; height: 140px; border: 1px dashed #CBD5E1; border-radius: 10px; background: #F8FAFC;
  display: flex; align-items: center; justify-content: center; padding: 8px;
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
`;
const PickBtn = styled.button`
  height: 36px; padding: 0 14px; border: 1px solid #CBD5E1; border-radius: 8px; background: #fff; color: #0F172A;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  @media (max-width: 640px) { height: 40px; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Err = styled.div`margin-top: 6px; font-size: 0.75rem; color: #B91C1C;`;
