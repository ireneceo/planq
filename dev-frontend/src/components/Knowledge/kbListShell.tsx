// components/Knowledge/kbListShell.tsx — **Q info 목록 한 벌.**
//
// ★ 2026-09-13 (Irene: *"그리고 정보페이지도 디자인 맞춰."*)
//   프로젝트 > 정보 탭이 Q info 를 **베껴서** 그리고 있었다 — 같은 자료인데 행 모양이 달랐다:
//   Q info 는 [제목+본문미리보기][커스텀 항목][카테고리·메타][권한·상태][삭제] 5열 그리드인데
//   프로젝트 탭은 [제목][카테고리 칩] 두 칸짜리 단순 행이라 커스텀 항목·상태·삭제가 아예 없었다.
//   베낀 컴포넌트는 갈라진다(memory `feedback_copied_component_drifts_extract_shell`) —
//   그래서 **행 자체를 여기로 빼고 두 화면이 같이 쓴다.** 한쪽만 고쳐지는 일이 없어진다.
//
// ★ 여기 있는 것은 **목록의 껍데기**다. 무엇을 불러오고 무엇을 필터할지는 각 화면이 정한다
//   (Q info 는 워크스페이스 전체 + scope 필터, 프로젝트 탭은 scope='project' 고정).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import HighlightText from '../Common/HighlightText';
import MatchReason from '../Common/MatchReason';
import SecurityLevelBadge from '../Common/SecurityLevelBadge';
import { pickMatch } from '../../utils/searchMatch';
import { LEGACY_KB_CATEGORIES, type KbDocumentRow } from '../../services/knowledge';


// #326 — 카테고리 라벨. **자유 카테고리는 번역키가 없다.**
//   여태 t(`cat.${c}`) 를 그대로 써서 "cat.계정정보" 처럼 번역키가 화면에 찍혔다
//   (i18next 는 키가 없으면 키 문자열을 그대로 돌려준다).
//   LEGACY 6종만 번역하고 나머지는 이름을 그대로 보여준다.
export function catLabel(t: (k: string, o?: Record<string, unknown>) => unknown, c: string): string {
  return LEGACY_KB_CATEGORIES.includes(c as typeof LEGACY_KB_CATEGORIES[number])
    ? (t(`cat.${c}`) as string)
    : c;
}

// #187 — 본문(RichEditor HTML)에서 태그 제거 후 리스트 미리보기용 텍스트. 120자 컷.
export function stripHtmlPreview(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async (text: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* 클립보드 권한 없음 — 값은 그대로 보인다 */ }
  }, []);
  return { copied, copy };
}

export const SecretBtn = styled.button`
  flex-shrink: 0;
  background: none; border: 1px solid #E2E8F0; border-radius: 4px;
  padding: 1px 6px; font-size: 0.6875rem; font-weight: 600; font-family: inherit;
  color: #64748B; cursor: pointer; transition: all 0.12s;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #CCFBF1; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;

export const SecretRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  width: 100%; max-width: 100%; min-width: 0;
  & > button:last-child { margin-left: auto; }
`;

export const SecretText = styled.span<{ $masked: boolean }>`
  flex: 1; min-width: 0;
  color: #334155; font-weight: 500; font-size: 0.8125rem;
  letter-spacing: ${p => (p.$masked ? '1px' : 'normal')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;

/* 운영(Irene 2026-08-24) — "항목에 링크가 들어가면 줄지어 레이아웃을 넘어가.
   복사버튼은 해당 열 맨 끝에 나와야 해."
   원인: 값이 `overflow-wrap: anywhere` 라 긴 URL 이 폭 제한 없이 번지고, 그 뒤를 따라가던
   복사 버튼이 열 밖으로 밀려났다. → 값은 **한 줄 말줄임**, 버튼은 `margin-left:auto` 로 열 맨 끝 고정. */
export const LinkRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  width: 100%; max-width: 100%; min-width: 0;
  & > button:last-child { margin-left: auto; }
`;

export const ValueLink = styled.a`
  flex: 1; min-width: 0;
  color: #0F766E; font-weight: 500; font-size: 0.8125rem; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { text-decoration: underline; }
  /* ★ 2026-09-08 (Irene: "리스트에서는 링크 클릭도 안돼") — 링크는 눌리고 있었다.
     실측 183x**16px**. 그 줄이 속한 행에는 상세를 여는 click 이 걸려 있어서, 폰에서
     손가락이 조금만 빗나가면 행이 먼저 먹고 **상세가 열린다** — 사용자에겐 "링크가 안 눌린다".
     보이는 크기는 그대로 두고 **누를 수 있는 자리만** 넓힌다(음수 여백으로 레이아웃 불변).
     같은 방식이 고객 목록 이름칸(ClientsPage NameCell)에 이미 쓰이고 있다. */
  padding: 6px 4px;
  margin: -6px -4px;
  @media (max-width: 640px) { padding: 11px 4px; margin: -11px -4px; }
`;

/* 값 셀 — 클릭하면 복사 (#143). "DB 저장소처럼 꺼내 쓰는" 화면. */
export const CopyValue = styled.button`
  display: flex; align-items: center; gap: 6px; width: 100%; max-width: 100%; min-width: 0;
  padding: 2px 8px; border: 1px dashed transparent; border-radius: 4px;
  background: none; font-family: inherit; font-size: 0.8125rem; font-weight: 500;
  color: #334155; text-align: left; cursor: pointer; transition: all 0.12s;
  & > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &:hover { background: #F0FDFA; border-color: #CCFBF1; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;

export const CopyMark = styled.span<{ $on: boolean }>`
  flex-shrink: 0; margin-left: auto; font-size: 0.6875rem; font-weight: 600;
  color: ${p => (p.$on ? '#0F766E' : '#94A3B8')};
  opacity: ${p => (p.$on ? 1 : 0)};
  transition: opacity 0.12s;
  ${CopyValue}:hover & { opacity: 1; }
`;

export const CustomValue = styled.span`color: #334155; font-weight: 500;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis;
`;

export const CopyCell: React.FC<{ value: string | undefined; colType: string }> = ({ value, colType }) => {
  const { t } = useTranslation('knowledge');
  const { copied, copy: doCopy } = useCopy();
  // #330 — secret 은 기본은 가리되 **본인이 눌러서 볼 수 있어야** 한다.
  //   여태 ●●●●●● 로만 보이고 꺼낼 방법이 없어, 넣는 사람이 "리스트에서 항목을 빼는" 식으로 우회했다.
  const [revealed, setRevealed] = React.useState(false);

  const text = value == null || value === '' ? '' : String(value);
  const isSecret = colType === 'secret';
  if (!text) return <CustomValue>{isSecret ? '' : '—'}</CustomValue>;

  const copy = (e: React.MouseEvent) => doCopy(text, e);   // 행 클릭(드로어 열기)과 겹치지 않게

  if (isSecret) {
    return (
      <SecretRow onClick={(e) => e.stopPropagation()}>
        <SecretText $masked={!revealed}>{revealed ? text : '••••••'}</SecretText>
        <SecretBtn
          type="button"
          onClick={(e) => { e.stopPropagation(); setRevealed(v => !v); }}
          title={(revealed ? t('inline.hide', '가리기') : t('inline.reveal', '보기')) as string}
        >
          {revealed ? t('inline.hide', '가리기') : t('inline.reveal', '보기')}
        </SecretBtn>
        <SecretBtn type="button" onClick={copy} title={t('inline.copy', '복사') as string}>
          {copied ? t('inline.copied', '복사됨') : t('inline.copy', '복사')}
        </SecretBtn>
      </SecretRow>
    );
  }

  // #331 — URL 이면 링크로. 여태 클릭하면 복사만 돼서, 사이트로 가려면 주소창에 붙여야 했다.
  //   타입이 url 이 아니어도 값 자체가 http(s) 로 시작하면 링크로 본다(사용자가 타입을 안 고른 경우가 많다).
  const isUrl = colType === 'url' || /^https?:\/\//i.test(text);
  if (isUrl) {
    return (
      <LinkRow onClick={(e) => e.stopPropagation()}>
        <ValueLink href={text} target="_blank" rel="noopener noreferrer" title={text}>{text}</ValueLink>
        <SecretBtn type="button" onClick={copy} title={t('inline.copy', '복사') as string}>
          {copied ? t('inline.copied', '복사됨') : t('inline.copy', '복사')}
        </SecretBtn>
      </LinkRow>
    );
  }

  return (
    <CopyValue type="button" onClick={copy} title={t('inline.copyHint', '클릭해서 복사') as string}>
      <span>{text}</span>
      <CopyMark $on={copied}>{copied ? t('inline.copied', '복사됨') : t('inline.copy', '복사')}</CopyMark>
    </CopyValue>
  );
};

export const CustomItem = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  white-space: nowrap; font-size: 0.75rem;
  min-width: 0; max-width: 260px;  /* #187 — 개별 항목 폭 제한 (라벨+값이 옆 컬럼 침범 방지) */
  overflow: hidden;                /* 링크 값이 제 폭을 넘어 흘러나오던 것 차단 (Irene 2026-08-24) */
`;

export const CustomLabel = styled.span`color: #94A3B8; font-weight: 500;`;

export const RowCheckbox = styled.input`
  width: 16px; height: 16px;
  accent-color: #14B8A6; cursor: pointer;
  vertical-align: middle;
`;

export const List = styled.div`
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  overflow: hidden;
`;

// 행 컬럼 — Q file 동일 토큰 구조: title 가변 / custom 가변 / category 100px / status 70px / action 36px
// 커스텀 항목이 많은 문서(url 여러 개)도 안 구겨지게 — 커스텀 영역에 충분한 폭 배분.
export const KB_LIST_COLS = 'minmax(160px, 1.6fr) minmax(220px, 2.6fr) auto minmax(90px, auto) 36px';

export const RowChk = styled.div`display:flex; align-items:center; justify-content:center;`;

export const RowAct = styled.div`display:flex; justify-content:flex-end;`;

export const IconBtn = styled.button`
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: #94A3B8;
  border-radius: 6px; cursor: pointer;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;

// 행 그리드: [제목 240px] [커스텀 1fr (자동 채움)] [메타 auto] [상태 우측]
// 모든 행에서 같은 컬럼 정렬 — 30년차 디자이너 관점의 일관성
// Q file ListRow 패턴 — 36px(체크) + 5컬럼
export const Row = styled.div<{ $active: boolean; $selectMode?: boolean }>`
  cursor: pointer;
  display: grid;
  grid-template-columns: ${p => p.$selectMode ? `36px ${KB_LIST_COLS}` : KB_LIST_COLS};
  gap: 8px; align-items: center;
  padding: 10px 14px;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border-bottom: 1px solid #F1F5F9;
  transition: background 0.12s;
  &:last-child { border-bottom: none; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  @media (max-width: 900px) {
    grid-template-columns: 1fr auto;
    grid-auto-rows: auto;
  }
`;

// 좌측: 제목
export const ColTitleArea = styled.div`min-width: 0;`;

// 가운데: 커스텀 항목 (자동 배치)
export const ColCustomArea = styled.div`
  display: flex; flex-wrap: wrap; gap: 12px 16px;
  align-items: center;
  min-width: 0; overflow: hidden;  /* #187 — 넘친 커스텀 값이 옆 컬럼 위로 흐르지 않게 */
  @media (max-width: 900px) { grid-column: 1 / -1; }
`;

// 우측: 카테고리 chip(여러개 가능) + 메타 (스코프·날짜)
export const ColMeta = styled.div`
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; justify-content: flex-end;
  font-size: 0.6875rem; color: #94A3B8;
  @media (max-width: 900px) { display: none; }
`;

export const CategoryChip = styled.span`
  display: inline-flex; align-items: center;
  padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 999px;
  font-size: 0.6875rem; font-weight: 600;
`;

export const MetaText = styled.span`
  font-size: 0.6875rem; color: #94A3B8;
`;

// 우측 끝: 권한·상태 chip
export const ColRight = styled.div`
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
`;

export const PolicyChip = styled.span<{ $kind: 'owner' }>`
  padding: 2px 8px; border-radius: 999px;
  font-size: 0.625rem; font-weight: 600;
  background: #FEF3C7; color: #92400E;
`;

export const StatusChip = styled.span<{ $s: string }>`
  flex-shrink: 0;
  padding: 2px 8px; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
  ${p => p.$s === 'ready' ? 'background:#DCFCE7;color:#166534;' :
        p.$s === 'indexing' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'failed' ? 'background:#FEE2E2;color:#B91C1C;' :
        'background:#F1F5F9;color:#64748B;'}
`;

/* 리스트 제목 — 읽기 전용 (#143). 행을 클릭하면 우측 패널이 열리고 거기서 편집한다. */
export const RowTitleText = styled.div`
  font-size: 0.875rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 2px 8px;
`;

// #187 — 본문 미리보기 (제목 아래 한 줄 말줄임)
export const RowBodyPreview = styled.div`
  font-size: 0.75rem; color: #94A3B8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 0 8px; margin-top: 1px;
`;

// ─────────────────────────────────────────────────────────────
// KbDocRow — Q info · 프로젝트>정보 가 **같이 쓰는 한 행**.
//
//   선택 모드(체크박스)·삭제 버튼은 화면마다 있을 수도 없을 수도 있다 → prop 으로 끈다.
//   `meta` 는 화면이 만든 문자열을 그대로 받는다(스코프·소속·첨부수·날짜) — 프로젝트 탭에는
//   "프로젝트: X" 를 또 적을 이유가 없고 Q info 에는 필요하다. **행이 그 판단을 하지 않는다.**
export interface KbDocRowProps {
  doc: KbDocumentRow;
  search?: string;
  active?: boolean;
  /** 화면이 만든 메타 문자열 (스코프·소속·첨부·날짜). 없으면 메타 칸은 카테고리 칩만. */
  meta?: string;
  selectMode?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onToggleSelect?: () => void;
  /** 없으면 휴지통 칸을 비워 둔다(그리드 열은 유지 — 행끼리 세로줄이 어긋나지 않게). */
  onDelete?: () => void;
}

export function KbDocRow({
  doc: d, search = '', active = false, meta, selectMode = false, selected = false,
  onOpen, onToggleSelect, onDelete,
}: KbDocRowProps) {
  const { t } = useTranslation('knowledge');
  const cats: string[] = (Array.isArray(d.categories) && d.categories.length)
    ? d.categories
    : (d.category ? [d.category] : []);

  return (
    <Row
      $active={selectMode ? selected : active}
      $selectMode={selectMode}
      data-kb-id={d.id}
      onClick={() => { if (selectMode) onToggleSelect?.(); else onOpen(); }}
    >
      {selectMode && (
        <RowChk onClick={(e) => e.stopPropagation()}>
          <RowCheckbox type="checkbox" checked={selected} readOnly onClick={(e) => e.stopPropagation()} />
        </RowChk>
      )}

      {/* 제목 — 읽기 전용. 클릭하면 우측 패널이 열리고 거기서 편집 (#143) */}
      <ColTitleArea>
        <RowTitleText><HighlightText text={d.title} query={search} /></RowTitleText>
        {/* #187 — 본문 미리보기. 검색 중 제목엔 없고 본문에서 찾았으면 **찾은 자리**를 대신 보여준다
            (첫 줄 미리보기는 말줄임에 가려 매칭어가 안 보일 수 있다). */}
        {(() => {
          const hit = search.trim() ? pickMatch([
            { field: 'title', text: d.title, shown: true },
            { field: 'body', text: d.body },
          ], search) : null;
          if (hit && !hit.shown) return <MatchReason field={hit.field} snippet={hit.snippet} query={search} />;
          const preview = d.body ? stripHtmlPreview(d.body) : '';
          return preview ? <RowBodyPreview><HighlightText text={preview} query={search} /></RowBodyPreview> : null;
        })()}
      </ColTitleArea>

      {/* 가운데: 커스텀 항목 — 클릭하면 값 복사 (#143) */}
      <ColCustomArea>
        {Array.isArray(d.custom_columns) && d.custom_columns.filter(c => c.show_in_list).map(col => (
          <CustomItem key={col.id}>
            <CustomLabel>{col.name}</CustomLabel>
            <CopyCell colType={col.type} value={(d.custom_values || {})[col.id] as string | undefined} />
          </CustomItem>
        ))}
      </ColCustomArea>

      {/* 카테고리 chip + 메타 */}
      <ColMeta>
        {cats.map(c => <CategoryChip key={c}><HighlightText text={catLabel(t, c)} query={search} /></CategoryChip>)}
        {meta ? <MetaText>{meta}</MetaText> : null}
      </ColMeta>

      {/* 권한·상태 chip */}
      <ColRight>
        <SecurityLevelBadge level={d.security_level} />
        {d.read_policy === 'owner' && (
          <PolicyChip $kind="owner" title={t('policy.ownerOnly', '운영진만') as string}>
            {t('policy.ownerShort', '운영진') as string}
          </PolicyChip>
        )}
        {d.status === 'indexing' && (
          <StatusChip $s="indexing" title={t('status.indexing', '인덱싱 중') as string}>
            {t('status.indexingShort', '처리중') as string}
          </StatusChip>
        )}
        {d.status === 'failed' && (
          <StatusChip $s="failed" title={t('status.failed', '실패') as string}>
            {t('status.failedShort', '실패') as string}
          </StatusChip>
        )}
      </ColRight>

      {/* 우측 끝: 휴지통 — 선택 모드 아닐 때만 */}
      <RowAct>
        {!selectMode && onDelete && (
          <IconBtn type="button" title={t('drawer.delete') as string}
            aria-label={t('drawer.delete') as string}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </IconBtn>
        )}
      </RowAct>
    </Row>
  );
}
