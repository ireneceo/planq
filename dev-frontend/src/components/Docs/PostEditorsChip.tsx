// 문서 상세 밴드2 — «편집: 작성자만 / 작성자 +n» 칩 (2026-10-23 · docs/DOC_COEDITORS_DESIGN.md · Fable DESIGN-OK).
//
// Irene: *"내가 만든 문서를 고객이 편집가능권한을 가진건지 어떤 멤버가 있는지 어떻게 알아? 모두 서로 서로 막 작성자 본인 아닌데 편집되는 건 아니지?"*
//   → 기본은 작성자만 고친다. 작성자(또는 오너·관리자)가 공동 편집자를 넣는다. 누가 고칠 수 있는지 이 칩이 말한다.
//   판정은 서버(services/postAccess.canEditPost) 한 곳 — 화면은 co_editors·can_manage_editors·can_edit 만 읽는다.
// ★ 팝오버 안에 PlanQSelect 를 쓰지 않는다(포털 메뉴가 바깥클릭으로 읽혀 선택 전에 닫힌다 — CLAUDE.md 밴드2 절).
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChipPopover from '../Common/ChipPopover';
import { PickerFilter, PickerList, PickerItem, PickerHint } from '../Common/pickerList';
import { addPostEditor, removePostEditor, type PostCoEditor } from '../../services/posts';

interface Props {
  postId: number;
  authorId: number | null | undefined;
  authorName: string;
  vlevel: string | null | undefined;
  coEditors: PostCoEditor[];
  canManage: boolean;
  canEdit: boolean;
  members: Array<{ user_id: number; name: string; role: string }>;
  onChanged: (list: PostCoEditor[]) => void;
}

const PostEditorsChip: React.FC<Props> = ({ postId, authorId, authorName, vlevel, coEditors, canManage, canEdit, members, onChanged }) => {
  const { t } = useTranslation('qdocs');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = coEditors.length;
  const label = n === 0
    ? (t('editors.authorOnly', { defaultValue: '작성자만' }) as string)
    : (t('editors.authorPlus', { count: n, defaultValue: '작성자 +{{count}}' }) as string);
  const isPrivate = vlevel === 'L1';
  const taken = new Set<number>([...(authorId ? [authorId] : []), ...coEditors.map((e) => e.user_id)]);
  const candidates = members.filter((m) => !taken.has(m.user_id))
    .filter((m) => !query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase()));

  const errText = (code: string) => {
    if (code === 'widen_visibility_first') return t('editors.err.widen', { defaultValue: '이 사람은 지금 이 문서를 볼 수 없어요. 먼저 공개 범위에 포함하세요.' }) as string;
    if (code === 'not_workspace_member') return t('editors.err.notMember', { defaultValue: '워크스페이스 멤버만 공동 편집자가 될 수 있어요.' }) as string;
    if (code === 'editors_manage_forbidden') return t('editors.err.forbidden', { defaultValue: '작성자·오너·관리자만 공동 편집자를 정할 수 있어요.' }) as string;
    return t('editors.err.generic', { defaultValue: '바꾸지 못했어요. 잠시 뒤 다시 해 주세요.' }) as string;
  };
  const run = async (fn: () => Promise<PostCoEditor[]>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onChanged(await fn()); setQuery(''); } catch (e) { setError(errText((e as Error).message)); } finally { setBusy(false); }
  };

  return (
    <ChipPopover
      data-testid="post-editors-chip"
      prefix={t('editors.prefix', { defaultValue: '편집' }) as string}
      label={label}
      active={n > 0}
      ariaLabel={t('editors.aria', { defaultValue: '누가 이 문서를 편집할 수 있나' }) as string}
      width={290}
    >
      {() => (
        <div data-testid="post-editors-panel">
          <Intro>
            {canEdit
              ? t('editors.intro', { defaultValue: '작성자와 공동 편집자만 이 문서를 고칠 수 있어요. 다른 사람은 읽기·댓글만 할 수 있어요.' })
              : (n > 0
                ? t('editors.readOnlyWith', { name: authorName, defaultValue: '이 문서는 {{name}} 님과 공동 편집자만 편집할 수 있어요. 편집이 필요하면 작성자에게 요청하세요.' })
                : t('editors.readOnly', { name: authorName, defaultValue: '이 문서는 {{name}} 님만 편집할 수 있어요. 편집이 필요하면 작성자에게 요청하세요.' }))}
          </Intro>
          {error && <Err role="alert">{error}</Err>}
          <PickerList>
            <Row>
              <Name>{authorName}</Name>
              <PickerHint>{t('editors.author', { defaultValue: '작성자' })}</PickerHint>
            </Row>
            {coEditors.map((e) => (
              <Row key={e.user_id} data-testid="post-editor-row" $dim={!e.readable}>
                <Name title={!e.readable ? (t('editors.outOfScopeHint', { defaultValue: '공개 범위가 좁아져 지금은 이 문서를 볼 수 없어 편집도 못 해요. 범위를 다시 넓히면 돌아와요.' }) as string) : undefined}>
                  {e.name}
                </Name>
                <PickerHint>{e.readable ? t('editors.coEditor', { defaultValue: '공동 편집자' }) : t('editors.outOfScope', { defaultValue: '현재 범위 밖' })}</PickerHint>
                {canManage && (
                  <RemoveBtn type="button" data-testid="post-editor-remove" disabled={busy}
                    onClick={() => run(() => removePostEditor(postId, e.user_id))}
                    aria-label={t('editors.removeAria', { name: e.name, defaultValue: '{{name}} 공동 편집자에서 빼기' }) as string}>
                    {t('editors.remove', { defaultValue: '빼기' })}
                  </RemoveBtn>
                )}
              </Row>
            ))}
          </PickerList>
          {canManage && (isPrivate ? (
            <Note>{t('editors.privateNote', { defaultValue: '나만 보기 문서에는 공동 편집자를 둘 수 없어요. 공개 범위를 넓힌 뒤 지정하세요.' })}</Note>
          ) : (
            <>
              <Divider>{t('editors.add', { defaultValue: '공동 편집자 추가' })}</Divider>
              {members.length > 8 && (
                <PickerFilter value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('editors.search', { defaultValue: '이름으로 찾기' }) as string}
                  aria-label={t('editors.search', { defaultValue: '이름으로 찾기' }) as string} />
              )}
              <PickerList>
                {candidates.length === 0 ? (
                  <Note>{t('editors.noCandidates', { defaultValue: '더 넣을 멤버가 없어요.' })}</Note>
                ) : candidates.map((m) => (
                  <PickerItem key={m.user_id} type="button" data-testid="post-editor-add" disabled={busy}
                    onClick={() => run(() => addPostEditor(postId, m.user_id))}>
                    {m.name}
                    <PickerHint>{t('editors.addShort', { defaultValue: '+ 추가' })}</PickerHint>
                  </PickerItem>
                ))}
              </PickerList>
            </>
          ))}
        </div>
      )}
    </ChipPopover>
  );
};

export default PostEditorsChip;

const Intro = styled.div`
  font-size: 0.75rem; color: #64748B; line-height: 1.45; padding: 2px 2px 8px;
`;
const Err = styled.div`
  font-size: 0.75rem; color: #B91C1C; background: #FEF2F2; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;
`;
const Row = styled.div<{ $dim?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 6px;
  font-size: 0.8125rem; color: ${(p) => (p.$dim ? '#94A3B8' : '#0F172A')};
  @media (max-width: 640px) { min-height: 44px; }
`;
const Name = styled.span`
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;
`;
const RemoveBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #fff;
  font-size: 0.6875rem; font-weight: 600; color: #64748B; cursor: pointer;
  &:hover:not(:disabled) { border-color: #FCA5A5; color: #B91C1C; }
  &:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 640px) { height: 36px; min-width: 44px; }
`;
const Divider = styled.div`
  font-size: 0.6875rem; font-weight: 600; color: #94A3B8; padding: 10px 2px 4px;
  margin-top: 6px; border-top: 1px solid #F1F5F9;
`;
const Note = styled.div`
  font-size: 0.75rem; color: #94A3B8; padding: 8px 2px 2px;
`;
