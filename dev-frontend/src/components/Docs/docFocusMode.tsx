// components/Docs/docFocusMode.tsx — 문서 «집중 편집»(전체 화면으로 쓰기) (2026-10-25)
//
// Irene: "프로젝트>문서>편집에 가면 상단에 보이는게 너무 많아 … 편집화면을 전체로 하는 기능" → «권고대로».
// 실측(노트북 1366×768): 편집 중 글 쓰는 칸이 화면의 41%(313px). 위를 사이드바·탭·안내 띠·프로젝트 머리·
// 문서 정보 줄이 먹었다. 집중 편집은 그것을 다 걷고 «제목 줄 + 서식 도구 + 본문» 만 남긴다.
//
// ★ 편집기를 옮기지 않는다 — 포털로 빼면 TipTap 이 다시 마운트돼 커서·실행 취소 기록·쓰던 글자 조합이 끊긴다.
//   그 자리의 Content 상자를 화면 위로 띄우기만 한다(position:fixed). 모양은 메일 본문 크게 보기와 같은 조각(focusShell).
// ★ z-index 900(docFocusStyles) — 앱 크롬(≤100)·안내 띠 위, 편집기가 여는 창(모달 1000~1200·메뉴 10000) 아래. 그 창들이 이 판 뒤로 숨지 않는다.
// ★ 문서 정보 줄(분류·연결·공개)은 숨기기만 한다 — 업무 연결 칸이 아직 못 건 업무를 들고 있다(언마운트 금지, MetaRow 주석).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusShellExit, FocusModeIcon } from '../Common/focusShell';
import { IconActionBtn } from './PostsPage.styles';

export function useDocFocusMode(isEditing: boolean, onEditingChange?: (editing: boolean) => void) {
  const [on, setOn] = useState(false);
  // 편집을 끝내면(완료·되돌리기·다른 문서) 집중 편집도 끝난다.
  useEffect(() => { if (!isEditing) setOn(false); }, [isEditing]);
  // 프로젝트 상세가 편집 동안 자기 머리줄을 접는다 — 떠날 때(언마운트)는 «편집 아님» 으로 돌려놓는다.
  useEffect(() => { onEditingChange?.(isEditing); }, [isEditing, onEditingChange]);
  useEffect(() => () => { onEditingChange?.(false); }, [onEditingChange]);
  const exit = useCallback(() => setOn(false), []);
  const toggle = useCallback(() => setOn((v) => !v), []);
  useFocusShellExit(on, exit);
  return { on, toggle, exit };
}

export function DocFocusButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useTranslation('qdocs');
  const label = (on
    ? t('focusMode.exit', { defaultValue: '전체 화면 끝내기' })
    : t('focusMode.enter', { defaultValue: '전체 화면으로 쓰기' })) as string;
  return (
    <IconActionBtn type="button" data-testid="docs-focus-toggle" aria-pressed={on}
      onClick={onToggle} title={label} aria-label={label}>
      <FocusModeIcon on={on} />
    </IconActionBtn>
  );
}
