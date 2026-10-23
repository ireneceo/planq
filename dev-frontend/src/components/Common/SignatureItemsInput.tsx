// 서명 칸 채우기 — 서명자 한 사람의 서명 칸 N개를 «그리기 또는 이미지 올리기» 로 채운다 (2026-10-05)
// 설계 docs/SIGNATURE_ITEMS_DESIGN.md §9 — 사인·회사 스탬프 모두 «서명 칸» 한 종류다.
//
// 공개 서명 페이지와 앱 안 서명이 **같은 것**을 쓴다(그리기 판 SignaturePad 와 같은 이유 — 베끼면 갈라진다).
// 값은 밖으로 나가지 않는다 — 부모가 ref.getItems() 로 보낼 때 읽는다. 채워졌는지는 onReadyChange 로 알린다.
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';

export interface SignatureItemValue { mode: 'draw' | 'image'; b64: string }
export interface SignatureItemsHandle { getItems: () => SignatureItemValue[] | null }

interface Props {
  count: number;
  /** 칸마다 무엇을 넣을지(«사인»·«회사 스탬프») — 요청한 사람이 정한 이름(required_items.captions). 없으면 «서명 칸 n / N» */
  captions?: (string | null)[] | null;
  disabled?: boolean;
  onReadyChange?: (ready: boolean) => void;
  /** 있으면 «PlanQ 파일에서 고르기» 를 보인다(2026-10-23 Irene «우리 플랜큐 파일에서는 왜 검색 못해?»).
   *  로그인한 멤버의 앱 안 서명만 넘긴다 — 공개 서명 페이지(무인증 외부 서명자)는 워크스페이스 파일을 볼 수 없다. */
  businessId?: number | null;
}

// 2026-10-21 Irene «서명 이미지 넣는게 너무 느려 … 큰 이미지를 누가 넣어도 제대로 줄여줘»
//   예전엔 5MB 넘는 사진은 거절하고, 1200px 이하는 원본 그대로, 그 외는 PNG 로 다시 그려 수 MB 가 그대로 올라갔다.
//   서명본·PDF 에서 서명 칸은 최대 300×96 으로 찍힌다 → 긴 변 900px(3배)이면 레티나·인쇄에도 충분하다.
//   투명 픽셀이 있으면(배경 없는 스탬프) PNG, 없으면(종이에 찍은 사진) JPEG 로 줄인다. 서버는 바이트를 바꾸지 않는다(증거 해시).
const MAX_FILE = 30 * 1024 * 1024;   // 줄이기 전 안전 문턱(디코드 폭주 방지) — 그 아래는 전부 줄여서 받는다
const MAX_EDGE = 900;
const TARGET_BYTES = 350_000;        // 불투명 사진은 이 아래가 될 때까지 JPEG 품질을 낮춘다
const ACCEPT = 'image/png,image/jpeg,image/webp';

async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 폰 사진의 회전 정보(EXIF)를 따른다
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* 아래 방식으로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('read_failed'));
      el.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let k = 3; k < d.length; k += 4) if (d[k] < 250) return true;
  return false;
}

/** 어떤 크기의 이미지든 긴 변 900px 이하로 다시 그린다 — 투명이면 PNG, 아니면 JPEG */
async function readImage(file: File): Promise<string> {
  const { src, w, h, close } = await decode(file);
  try {
    if (!w || !h) throw new Error('read_failed');
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('read_failed');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    if (file.type !== 'image/jpeg' && hasTransparency(ctx, c.width, c.height)) return c.toDataURL('image/png');
    // 불투명 — JPEG 는 투명이 없으므로 흰 바탕을 깐다(반투명 테두리가 검게 되지 않게)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    let out = '';
    for (const q of [0.88, 0.78, 0.68]) {
      out = c.toDataURL('image/jpeg', q);
      if (out.length * 0.75 <= TARGET_BYTES) break;
    }
    return out;
  } finally { close?.(); }
}

interface ItemState { mode: 'draw' | 'image'; drawn: boolean; image: string | null; error: string | null; reading?: boolean }

const SignatureItemsInput = React.forwardRef<SignatureItemsHandle, Props>(({ count, captions, disabled, onReadyChange, businessId }, ref) => {
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

  // 끌어다 놓기(2026-10-21 Irene «서명이미지 올리기에 드롭도 되게») — 칸 카드 어디에 놓아도 받는다.
  //   그리기 중이어도 이미지를 놓으면 이미지로 바꾼다(놓는 동작은 그리기와 헷갈리지 않는다). 검사는 pick() 한 벌.
  //   ★ stopPropagation — 이 창은 프로젝트>문서 탭(업로드 오버레이가 drop 을 받는다) 안에서도 열린다. 버블되면
  //   서명 이미지가 프로젝트 파일로 올라간다(포털도 React 트리로 버블된다).
  const [dragOver, setDragOver] = useState<number | null>(null);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropProps = (i: number) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (!disabled) setDragOver(i);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      if (!disabled && dragOver !== i) setDragOver(i);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((v) => (v === i ? null : v));
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      setDragOver(null);
      if (disabled) return;
      patch(i, { mode: 'image', error: null });
      void pick(i, e.dataTransfer.files?.[0]);
    },
  });

  // PlanQ 파일 — 처음 열 때 한 번 받는다. 첨부 칸(AttachmentField)과 같은 목록(direct 행 = 같은 다운로드 문·같은 읽기 권한)에서
  //   서명에 쓸 수 있는 이미지 형식만. 고른 파일은 내려받아 pick() 에 그대로 넣는다(형식·크기·축소 검사 한 벌).
  //   서명은 이미지 바이트를 복사해 올라간다 — 원본 파일과 연결되지 않는다.
  const [wsOpen, setWsOpen] = useState<number | null>(null);
  const [wsFiles, setWsFiles] = useState<ProjectFile[] | null>(null);
  const wsLoading = useRef(false);
  const openWs = (i: number) => {
    setWsOpen((v) => (v === i ? null : i));
    if (wsFiles || wsLoading.current || !businessId) return;
    wsLoading.current = true;
    fetchWorkspaceFiles(businessId)
      .then((fs) => setWsFiles(fs.filter((f) => f.source === 'direct' && ACCEPT.split(',').includes(String(f.mime_type || '')))))
      .catch(() => setWsFiles([]))
      .finally(() => { wsLoading.current = false; });
  };
  const wsOptions: PlanQSelectOption[] = (wsFiles || []).map((f) => ({ value: f.id, label: `${f.file_name} (${formatBytes(f.file_size)})` }));
  const pickWs = async (i: number, id: string) => {
    const f = (wsFiles || []).find((x) => x.id === id);
    if (!f) return;
    setWsOpen(null);
    patch(i, { mode: 'image', reading: true, error: null });
    try {
      const r = await apiFetch(f.download_url);
      if (!r.ok) throw new Error('fetch_failed');
      const blob = await r.blob();
      patch(i, { reading: false });
      await pick(i, new File([blob], f.file_name, { type: f.mime_type || blob.type }));
    } catch {
      patch(i, { reading: false, error: t('signItems.fileFetchFailed', { defaultValue: '파일을 가져오지 못했어요. 다시 해 보세요.' }) as string });
    }
  };

  const pick = async (i: number, file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) { patch(i, { error: t('signItems.badType', { defaultValue: 'PNG·JPG·WEBP 이미지만 올릴 수 있어요.' }) as string }); return; }
    if (file.size > MAX_FILE) { patch(i, { error: t('signItems.tooLarge', { defaultValue: '30MB 이하 이미지만 올릴 수 있어요. 큰 이미지는 알맞은 크기로 줄여서 넣어요.' }) as string }); return; }
    patch(i, { reading: true, error: null });
    try { patch(i, { image: await readImage(file), error: null, reading: false }); }
    catch { patch(i, { reading: false, error: t('signItems.readFailed', { defaultValue: '이미지를 읽지 못했어요. 다른 파일로 해 보세요.' }) as string }); }
  };

  return (
    <List data-testid="sign-items">
      {items.map((it, i) => (
        <Item key={i} data-testid={`sign-item-${i}`} $drag={dragOver === i} {...dropProps(i)}>
          <ItemHead>
            {/* 칸 이름이 있으면 그것이 제목이다(«회사 스탬프») — 번호만으로는 무엇을 넣을지 모른다(2026-10-16) */}
            <ItemName data-testid={`sign-item-${i}-name`}>
              {captions?.[i]
                ? captions[i]
                : n > 1
                  ? t('signItems.nth', { n: i + 1, total: n, defaultValue: '서명 칸 {{n}} / {{total}}' })
                  : t('signItems.one', { defaultValue: '서명' })}
              {captions?.[i] && n > 1 && <ItemNo>{t('signItems.nthShort', { n: i + 1, total: n, defaultValue: '{{n}} / {{total}}' })}</ItemNo>}
            </ItemName>
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
              {it.reading
                ? <Reading data-testid={`sign-item-${i}-reading`} role="status">{t('signItems.reading', { defaultValue: '이미지를 알맞은 크기로 줄이는 중…' })}</Reading>
                : it.image
                ? <Preview><img src={it.image} alt="" /></Preview>
                : (
                  <>
                    <ImageHint>{t('signItems.imageHint', { defaultValue: '사인·도장·회사 스탬프 이미지(PNG 권장 — 배경이 투명하면 문서에 자연스럽게 얹혀요)' })}</ImageHint>
                    <DropZone data-testid={`sign-item-${i}-drop`} $drag={dragOver === i}
                      onClick={() => { if (!disabled) files.current[i]?.click(); }}>
                      {t('signItems.dropHint', { defaultValue: '이미지를 여기로 끌어다 놓거나 눌러서 고르세요' })}
                    </DropZone>
                  </>
                )}
              <input ref={(el) => { files.current[i] = el; }} type="file" accept={ACCEPT} hidden
                data-testid={`sign-item-${i}-file`}
                onChange={(e) => { void pick(i, e.target.files?.[0]); e.target.value = ''; }} />
              <BtnRow>
                <PickBtn type="button" disabled={disabled || it.reading} onClick={() => files.current[i]?.click()}>
                  {it.image ? t('signItems.replace', { defaultValue: '다른 이미지로' }) : t('signItems.pick', { defaultValue: '이미지 고르기' })}
                </PickBtn>
                {businessId ? (
                  <PickBtn type="button" disabled={disabled || it.reading} aria-expanded={wsOpen === i}
                    data-testid={`sign-item-${i}-from-files`} onClick={() => openWs(i)}>
                    {t('signItems.fromFiles', { defaultValue: 'PlanQ 파일에서 고르기' })}
                  </PickBtn>
                ) : null}
              </BtnRow>
              {businessId && wsOpen === i && (
                <WsBox data-testid={`sign-item-${i}-files`}>
                  <PlanQSelect
                    inputId={`sign-item-${i}-file-search`}
                    size="sm" isSearchable autoFocus openMenuOnFocus
                    isLoading={wsFiles === null}
                    placeholder={t('signItems.fromFilesPh', { defaultValue: '이미지 파일 이름으로 검색' }) as string}
                    noOptionsMessage={() => (wsFiles === null
                      ? t('signItems.fromFilesLoading', { defaultValue: '불러오는 중…' })
                      : t('signItems.fromFilesEmpty', { defaultValue: 'PNG·JPG·WEBP 이미지 파일이 없어요.' })) as string}
                    options={wsOptions}
                    value={null}
                    onChange={(o) => { if (o) void pickWs(i, String((o as PlanQSelectOption).value)); }}
                  />
                </WsBox>
              )}
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
const Reading = styled.div`font-size: 0.8125rem; color: #475569; padding: 18px 12px; text-align: center; background: #F8FAFC; border-radius: 8px;`;
const Item = styled.div<{ $drag?: boolean }>`
  border: 1px solid ${(p) => (p.$drag ? '#14B8A6' : '#E2E8F0')}; border-radius: 10px; padding: 10px;
  background: ${(p) => (p.$drag ? '#F0FDFA' : '#fff')};
  box-shadow: ${(p) => (p.$drag ? '0 0 0 3px rgba(20, 184, 166, 0.15)' : 'none')};
`;
const ItemHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;`;
const ItemName = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; min-width: 0; overflow-wrap: anywhere;`;
const ItemNo = styled.span`margin-left: 6px; font-size: 0.6875rem; font-weight: 600; color: #94A3B8;`;
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
// 미리보기는 도장·사인 크기에 맞춘 작은 상자다 — 창 폭 전체로 늘리면 가로로 긴 띠가 되어 어색했다(2026-10-16 Irene «좌우로 너무 길게»)
const Preview = styled.div`
  width: min(100%, 280px); height: 140px; border: 1px dashed #CBD5E1; border-radius: 10px; background: #F8FAFC;
  display: flex; align-items: center; justify-content: center; padding: 8px;
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
`;
// 비어 있을 때의 놓는 자리 — 미리보기와 같은 크기의 점선 상자(놓으면 그 자리에 이미지가 보인다)
const DropZone = styled.div<{ $drag: boolean }>`
  width: min(100%, 280px); height: 140px; border: 1px dashed ${(p) => (p.$drag ? '#14B8A6' : '#CBD5E1')}; border-radius: 10px;
  background: ${(p) => (p.$drag ? '#CCFBF1' : '#F8FAFC')}; color: ${(p) => (p.$drag ? '#0F766E' : '#64748B')};
  display: flex; align-items: center; justify-content: center; padding: 12px; text-align: center;
  font-size: 0.75rem; line-height: 1.5; cursor: pointer;
  /* 폰에는 끌어다 놓기가 없다 — 고르기 버튼만 남긴다(폭으로 가른다: 헤드리스는 hover:none 이라 그 분기는 못 잰다) */
  @media (max-width: 640px) { display: none; }
`;
const BtnRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const WsBox = styled.div`width: min(100%, 420px);`;
const PickBtn = styled.button`
  height: 36px; padding: 0 14px; border: 1px solid #CBD5E1; border-radius: 8px; background: #fff; color: #0F172A;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  @media (max-width: 640px) { height: 40px; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Err = styled.div`margin-top: 6px; font-size: 0.75rem; color: #B91C1C;`;
