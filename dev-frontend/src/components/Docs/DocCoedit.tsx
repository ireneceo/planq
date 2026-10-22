// 문서 같이 편집 — 안내 줄 두 개 + 겹쳤을 때 남겨 둔 내 글 (2026-10-22 · docs/DOC_COEDIT_DESIGN.md B 안)
//   Irene: «같은 문서를 같이 편집하고 싶으면 어떻게 해? 히스토리 남기고 공동작업 할 수 없어?» →
//   «Fable 권고대로. UI 는 아주 쉽고 바로 알고 심플하게 통일된 디자인만.»
//
// 화면은 줄 하나씩만 더한다 — 충돌 바(PostsPage StaleBar)와 같은 모양·크기, 색만 안내(민트).
//   ① 남이 지금 치고 있다(30초 안) → 한 줄 안내
//   ② 겹쳐서 «최신 내용 가져오기» 를 골랐다 → 내가 쓰던 글을 버리지 않고 남겨 두고 [내 글 보기] [지우기]
//   ③ 저장이 겹쳤다(409) → [바뀐 내용 보기] [최신 내용 가져오기] [내 수정으로 덮어쓰기] (빨강)
//   + «○○ 님이 편집 중» 칩 — 보기 화면 메타 줄·편집 화면 머리 줄이 같은 것을 쓴다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useDraftKey } from '../../hooks/useDraftText';
import { readDraftRecord, writeDraftRecord, clearDraftRecord } from '../../services/draftStore';
import type { PresenceUser } from '../../hooks/usePostPresence';
import StandardModal from '../Common/StandardModal';
import PostEditor from './PostEditor';

export interface ConflictStash { title: string; content: unknown }

/** 이 문서·이 사람 몫 하나(초안 저장소 'doc-conflict', 7일). */
export function useConflictStash(postId: number | null, businessId: number | null) {
  const key = useDraftKey('doc-conflict', postId, businessId);
  const [stash, setStash] = useState<ConflictStash | null>(null);
  useEffect(() => {
    const rec = key ? readDraftRecord<string>(key) : null;
    if (!rec?.value) { setStash(null); return; }
    try { setStash(JSON.parse(rec.value)); } catch { setStash(null); }
  }, [key]);
  const save = useCallback((next: ConflictStash) => {
    if (!key) return;
    writeDraftRecord(key, JSON.stringify(next), Date.now());
    setStash(next);
  }, [key]);
  const drop = useCallback(() => { clearDraftRecord(key); setStash(null); }, [key]);
  return { stash, save, drop };
}

export const CoeditTypingNotice: React.FC<{ users: PresenceUser[] }> = ({ users }) => {
  const { t } = useTranslation('qdocs');
  const typing = users.filter((u) => u.typing);
  if (typing.length === 0) return null;
  const names = typing.map((u) => u.name || (t('presence.someone', '누군가') as string)).join(', ');
  return (
    <CoeditBar role="status" data-testid="docs-coedit-notice">
      <Dot />
      {t('coedit.othersTyping', { names, defaultValue: '{{names}}님도 지금 고치고 있어요. 같은 곳을 고치면 저장할 때 겹칠 수 있어요.' })}
    </CoeditBar>
  );
};

export const PresenceChips: React.FC<{ users: PresenceUser[]; short?: boolean }> = ({ users, short = false }) => {
  const { t } = useTranslation('qdocs');
  return (
    <>
      {users.map((u) => {
        const label = t('presence.editing', { name: u.name || (t('presence.someone', '누군가') as string), defaultValue: '{{name}} 님이 편집 중' }) as string;
        return <Chip key={u.userId} data-testid="docs-presence-chip" title={label}><Dot />{short ? (u.name || t('presence.someone', '누군가')) : label}</Chip>;
      })}
    </>
  );
};

// 저장이 겹쳤다 — 뱃지만 띄우면 막다른 길이다(저장도 이동도 불가). 세 갈래를 준다.
export const ConflictBar: React.FC<{ onSee: () => void; onReload: () => void; onOverwrite: () => void }> = ({ onSee, onReload, onOverwrite }) => {
  const { t } = useTranslation('qdocs');
  return (
    <CoeditBar role="alert" $tone="err" data-testid="docs-stale-bar">
      <span>{t('autosave.staleBar', '다른 사람이 먼저 저장했어요. 어떻게 할까요? 덮어써도 그 글은 변경 기록에 남아요.')}</span>
      <BarBtn type="button" data-testid="docs-stale-history" onClick={onSee}>{t('autosave.staleSee', '바뀐 내용 보기')}</BarBtn>
      <BarBtn type="button" data-testid="docs-stale-reload" onClick={onReload}>{t('autosave.staleReload', '최신 내용 가져오기')}</BarBtn>
      <BarBtn type="button" $danger data-testid="docs-stale-overwrite" onClick={onOverwrite}>{t('autosave.staleOverwrite', '내 수정으로 덮어쓰기')}</BarBtn>
    </CoeditBar>
  );
};

// 서명 요청이 진행 중·완료된 문서 — 남이 저장한 것이 아니다. 고르게 하지 않고 사실과 다음 행동만 말한다.
export const SignLockedBar: React.FC = () => {
  const { t } = useTranslation('qdocs');
  return (
    <CoeditBar role="alert" $tone="err" data-testid="docs-sign-locked">
      {t('autosave.signatureLocked', '서명 요청을 보낸 문서라 고칠 수 없습니다. 받는 분이 아직 서명하지 않았으면 아래 서명 진행에서 [고쳐서 다시 보내기] 를 누르세요. 이미 서명받았다면 문서를 복사해 새로 보내 주세요.')}
    </CoeditBar>
  );
};

export const ConflictStashNote: React.FC<{ stash: ConflictStash; onDrop: () => void }> = ({ stash, onDrop }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(false);
  return (
    <>
      <CoeditBar role="status" data-testid="docs-conflict-stash">
        <span>{t('coedit.stashNote', '최신 내용으로 바꾸면서 내가 쓰던 글을 따로 남겨 두었어요.')}</span>
        <BarBtn type="button" data-testid="docs-conflict-view" onClick={() => setOpen(true)}>{t('coedit.stashView', '내 글 보기')}</BarBtn>
        <BarBtn type="button" $danger onClick={() => { setOpen(false); onDrop(); }}>{t('coedit.stashDrop', '지우기')}</BarBtn>
      </CoeditBar>
      <StandardModal
        open={open}
        onClose={() => setOpen(false)}
        title={t('coedit.stashTitle', '내가 쓰던 글') as string}
        size="lg"
        footer={<BarBtn type="button" onClick={() => setOpen(false)}>{t('coedit.close', '닫기')}</BarBtn>}
      >
        <Hint>{t('coedit.stashHint', '저장되지 않은 내 글이에요. 필요한 부분을 복사해 문서에 붙여 넣으세요.')}</Hint>
        {stash.title && <StashTitle>{stash.title}</StashTitle>}
        <PostEditor value={stash.content} onChange={() => {}} editable={false} borderless />
      </StandardModal>
    </>
  );
};

// 줄 셋이 한 모양 — 안내는 민트, 겹침은 빨강
const CoeditBar = styled.div<{ $tone?: 'info' | 'err' }>`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; margin: 6px 12px;
  background: ${(p) => (p.$tone === 'err' ? '#FEF2F2' : '#F0FDFA')};
  border: 1px solid ${(p) => (p.$tone === 'err' ? '#FECACA' : '#99F6E4')}; border-radius: 8px;
  font-size: 0.75rem; color: ${(p) => (p.$tone === 'err' ? '#991B1B' : '#0F766E')};
`;
// «편집 중» 칩 — 초록 점 = 지금 이 문서를 편집 화면으로 열어 둔 사람
const Chip = styled.span`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; margin-left: 6px;
  font-size: 0.71875rem; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
  white-space: nowrap;
`;
const Dot = styled.span`
  width: 6px; height: 6px; border-radius: 50%; background: #14B8A6; flex-shrink: 0;
`;
const BarBtn = styled.button<{ $danger?: boolean }>`
  height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 0.75rem; font-weight: 700; white-space: nowrap;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#0F766E')};
  background: #fff;
  border: 1px solid ${(p) => (p.$danger ? '#FECACA' : '#99F6E4')};
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F0FDFA')}; }
`;
const Hint = styled.p`
  margin: 0; font-size: 0.8125rem; color: #64748B;
`;
const StashTitle = styled.h3`
  margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;
`;
