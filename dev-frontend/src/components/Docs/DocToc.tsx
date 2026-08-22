// 운영 #338 — "문서에 목차 추가하는 기능이 가능할까? 노션처럼. 상단에 목차. 긴 페이지물 같은 것도"
// 운영 #369 — "표시하고 싶으면 하고 아니면 안 하게 해야지. 표시할 사람만.
//   목차부분이 박스 안에 있는데 좌우 레이아웃이 끝까지 붙었어. 그리고 접어두고 펼쳐두게도."
//
// 설계 원칙: **목차는 저장하지 않고 본문에서 파생한다.**
//   문서 안에 목차 블록을 넣어 두면 (a) 제목을 고칠 때마다 목차가 낡고 (b) 이미 있는 문서 전부에
//   블록을 심는 마이그레이션이 필요하고 (c) 목차 자체를 사람이 잘못 지울 수 있다.
//   본문에서 매번 뽑으면 셋 다 사라진다 — 옛 문서에서도 즉시 동작한다.
//
// 이동은 렌더된 제목 DOM 을 **문서 순서 index** 로 찾는다. 제목 텍스트로 찾으면 같은 제목이
//   두 번 나오는 문서(“개요”가 장마다 있는 문서)에서 첫 번째로만 가버린다.
//
// ★ 표시 여부·접힘은 **사람마다 다르다** — 문서에 저장하지 않고 이 브라우저에 남긴다.
//   문서에 저장하면 내가 끈 목차가 남의 화면에서도 사라진다(#369 의 "표시할 사람만" 은
//   "문서마다" 가 아니라 "보는 사람마다" 라는 뜻이다).
//   ★ 끄고 나면 되돌릴 자리가 있어야 한다 — 끈 자리에 "목차 보기" 칩을 남긴다.
//     되돌릴 길 없이 숨기는 것은 기능을 없애는 것이다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Heading { level: number; text: string; index: number }

interface Props {
  content: unknown;
  containerRef: React.RefObject<HTMLElement | null>;
  /** 목차를 띄울 최소 제목 수 (기본 2 — 하나뿐이면 목차가 의미 없다) */
  minHeadings?: number;
}

type TipTapNode = { type?: string; attrs?: { level?: number }; content?: TipTapNode[]; text?: string };

function nodeText(n: TipTapNode): string {
  if (typeof n.text === 'string') return n.text;
  return (n.content || []).map(nodeText).join('');
}

export function extractHeadings(content: unknown): Heading[] {
  const root = content as TipTapNode | null;
  if (!root || !Array.isArray(root.content)) return [];
  const out: Heading[] = [];
  let index = 0;
  // 최상위만 훑는다 — 제목은 문서 최상위 블록이다(표·인용 안의 제목은 목차 대상이 아니다).
  //   렌더 쪽 querySelectorAll('h1,h2,h3') 과 순서·개수가 어긋나면 엉뚱한 곳으로 이동하므로
  //   두 집합의 정의를 같게 유지하는 것이 핵심이다.
  for (const n of root.content) {
    if (n?.type !== 'heading') continue;
    const text = nodeText(n).trim();
    if (!text) { index += 1; continue; }   // 빈 제목도 DOM 에는 있다 — index 는 반드시 같이 센다
    out.push({ level: Number(n.attrs?.level) || 1, text, index });
    index += 1;
  }
  return out;
}

// 이 브라우저의 취향 — 문서가 아니라 보는 사람에게 붙는다.
const PREF_SHOW = 'planq:doc-toc:show';
const PREF_OPEN = 'planq:doc-toc:open';
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
function writePref(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* 시크릿 모드 — 이번 세션만 유지 */ }
}

const DocToc: React.FC<Props> = ({ content, containerRef, minHeadings = 2 }) => {
  const { t } = useTranslation('qdocs');
  const [show, setShow] = useState(() => readPref(PREF_SHOW, true));
  const [open, setOpen] = useState(() => readPref(PREF_OPEN, true));
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length < minHeadings) return null;

  const setShowP = (v: boolean) => { setShow(v); writePref(PREF_SHOW, v); };
  const setOpenP = (v: boolean) => { setOpen(v); writePref(PREF_OPEN, v); };

  const go = (index: number) => {
    const el = containerRef.current?.querySelectorAll('h1, h2, h3')[index] as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 꺼둔 상태 — 되돌릴 칩만 남긴다(공간을 거의 안 쓰고, 다시 켤 길이 항상 있다).
  if (!show) {
    return (
      <ShowChip type="button" onClick={() => setShowP(true)}>
        {t('toc.show', { defaultValue: '목차 보기' }) as string}
      </ShowChip>
    );
  }

  return (
    <Box>
      <HeadRow>
        <Head type="button" onClick={() => setOpenP(!open)} aria-expanded={open}>
          <Chevron $open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </Chevron>
          {t('toc.title', { defaultValue: '목차' }) as string}
          <Count>{headings.length}</Count>
        </Head>
        <HideBtn
          type="button"
          onClick={() => setShowP(false)}
          title={t('toc.hideHint', { defaultValue: '이 브라우저에서 목차를 숨깁니다. 다시 켤 수 있습니다.' }) as string}
        >
          {t('toc.hide', { defaultValue: '숨기기' }) as string}
        </HideBtn>
      </HeadRow>
      {open && (
        <List>
          {headings.map((h) => (
            <Row key={h.index} type="button" $level={h.level} onClick={() => go(h.index)} title={h.text}>
              {h.text}
            </Row>
          ))}
        </List>
      )}
    </Box>
  );
};

export default DocToc;

// ★ 좌우 정렬 — 본문(.pq-editor-body)은 자체 좌우 여백 16px 안에서 시작하는데, 이 상자는 바깥
//   컨테이너의 24px 만 받아 **본문 글자보다 8px 밖**에서 시작했다("좌우 레이아웃이 끝까지 붙었어").
//   그 차이만큼 안으로 들여 글자 시작선을 맞춘다. 폭 규칙이 바뀌면 여기 한 줄만 고치면 된다.
const BODY_INSET = 16;

const Box = styled.nav`
  margin: 0 ${BODY_INSET}px 14px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const ShowChip = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  margin: 0 ${BODY_INSET}px 10px; padding: 3px 10px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 999px; cursor: pointer;
  font-size: 11px; font-weight: 600; color: #64748B;
  &:hover { border-color: #CBD5E1; color: #0F172A; }
`;
const HeadRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`;
const Head = styled.button`
  display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  background: transparent; border: none; padding: 2px 0; cursor: pointer;
  font-size: 12px; font-weight: 700; color: #475569;
`;
const HideBtn = styled.button`
  flex-shrink: 0; padding: 2px 6px;
  background: transparent; border: none; cursor: pointer;
  font-size: 11px; color: #94A3B8;
  &:hover { color: #475569; text-decoration: underline; }
`;
const Chevron = styled.svg<{ $open: boolean }>`
  width: 14px; height: 14px; color: #94A3B8; flex-shrink: 0;
  transition: transform 0.15s; transform: rotate(${p => (p.$open ? 0 : -90)}deg);
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; margin-left: 2px;
  background: #E2E8F0; color: #64748B; border-radius: 8px; font-size: 10px; font-weight: 700;
`;
const List = styled.div` display: flex; flex-direction: column; margin-top: 6px; `;
const Row = styled.button<{ $level: number }>`
  display: block; width: 100%; text-align: left;
  padding: 4px 6px 4px ${p => 6 + (p.$level - 1) * 14}px;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  font-size: ${p => (p.$level === 1 ? 13 : 12)}px;
  font-weight: ${p => (p.$level === 1 ? 600 : 500)};
  color: ${p => (p.$level === 1 ? '#334155' : '#64748B')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { background: #E2E8F0; color: #0F172A; }
`;
