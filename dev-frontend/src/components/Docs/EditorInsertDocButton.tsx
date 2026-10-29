// 다른 문서 끼워 넣기 — 툴바 «문서 넣기» → 문서 고르기 → 그 본문을 커서 자리에 복사해 넣는다 (2026-10-29)
//
// Irene: «문서 중간에 다른 문서같은 거 삽입하게 하는 기능 넣으면 어때? 다른 사람이 작업한 글들로 합쳐서 작업하고 싶은데»
//
// ★ «복사해서 넣기» 다 — 넣은 뒤에는 이 문서의 글이고 원본과 따로 간다(원본이 바뀌어도 따라오지 않는다).
//   늘 최신으로 따라오는 끼워 넣기(트랜스클루전)는 공개 링크·서명 고정본·PDF·고객 열람까지 권한 표면이 번져 따로 설계한다.
// ★ 고를 수 있는 문서 = 내가 읽을 수 있는 문서 — 목록·본문 모두 기존 라우트(GET /api/posts · /api/posts/:id)가
//   읽기와 같은 술어로 거른다. 복사가 읽기보다 넓어지지 않는다(backend-routes «읽을 수 있으면 복사할 수 있다»).
// ★ 서명란은 따라오지 않는다 — 서명 자리는 그 문서의 서명 요청과 짝이다. 복사본에 남으면 원본인 척한다.
// ★ 고르기 칸은 첨부(AttachmentField)의 문서 검색과 같은 모양(PlanQSelect + postSubline).
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { Editor, JSONContent } from '@tiptap/react';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { fetchPosts, fetchPostResult, type PostRow } from '../../services/posts';
import { postSubline } from '../../utils/postSubline';
import { useTimeFormat } from '../../hooks/useTimeFormat';

/** 끼워 넣을 블록 — 서명란을 걷어 낸다(안쪽까지) */
export function stripForInsert(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    if (n.type === 'signatureField') continue;
    out.push(n.content ? { ...n, content: stripForInsert(n.content) } : n);
  }
  return out;
}

interface Props { editor: Editor; businessId: number; buttonAs: React.ElementType }

const EditorInsertDocButton: React.FC<Props> = ({ editor, businessId, buttonAs: Btn }) => {
  const { t, i18n } = useTranslation('qdocs');
  const { formatDate } = useTimeFormat();
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [withSource, setWithSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || posts) return;
    let cancelled = false;
    // 글 문서만 — 표·설문은 본문이 «설명» 칸뿐이라 넣어도 표가 따라오지 않는다
    fetchPosts(businessId, { docKind: 'doc' })
      .then((ps) => { if (!cancelled) setPosts(ps); })
      .catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
  }, [open, posts, businessId]);

  const options: PlanQSelectOption[] = useMemo(() => (posts || []).map((p) => ({
    value: String(p.id), label: p.title,
    subline: postSubline(p, formatDate, i18n.language) || undefined,
  })), [posts, formatDate, i18n.language]);

  const close = () => { if (busy) return; setOpen(false); setPicked(null); setError(null); };

  const insert = async () => {
    if (!picked || busy) return;
    setBusy(true); setError(null);
    try {
      const { data } = await fetchPostResult(picked);
      const blocks = stripForInsert(((data?.content_json as JSONContent | undefined)?.content) || []);
      if (!data || blocks.length === 0) {
        setError(t('editor.insertDoc.emptyBody', { defaultValue: '이 문서는 넣을 본문이 없습니다.' }) as string);
        return;
      }
      const source: JSONContent[] = withSource ? [{
        type: 'paragraph',
        content: [{
          type: 'text', marks: [{ type: 'italic' }],
          text: t('editor.insertDoc.sourceLine', {
            defaultValue: '— 가져온 글: {{title}}{{by}}',
            title: data.title,
            by: data.author?.name ? ` · ${data.author.name}` : '',
          }) as string,
        }],
      }] : [];
      editor.chain().focus().insertContent([...source, ...blocks]).run();
      setOpen(false); setPicked(null);
    } catch {
      setError(t('editor.insertDoc.failed', { defaultValue: '문서를 불러오지 못했습니다. 다시 시도해 주세요.' }) as string);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn
        type="button" data-testid="editor-insert-doc"
        onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        onClick={() => setOpen(true)}
        title={t('editor.insertDoc.open', { defaultValue: '다른 문서 넣기 — 고른 문서의 본문을 커서 자리에 복사해 넣습니다' }) as string}
        aria-label={t('editor.insertDoc.aria', { defaultValue: '다른 문서 넣기' }) as string}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" />
          <line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        <BtnLabel>{t('editor.insertDoc.label', { defaultValue: '문서 넣기' }) as string}</BtnLabel>
      </Btn>
      <StandardModal
        open={open} onClose={close} size="md"
        title={t('editor.insertDoc.title', { defaultValue: '다른 문서 넣기' }) as string}
        footer={(
          <>
            <ActionButton tone="secondary" type="button" onClick={close} disabled={busy}>
              {t('common.cancel', '취소') as string}
            </ActionButton>
            <ActionButton tone="primary" type="button" data-testid="editor-insert-doc-submit"
              onClick={() => void insert()} loading={busy} disabled={busy || !picked}>
              {t('editor.insertDoc.submit', { defaultValue: '여기에 넣기' }) as string}
            </ActionButton>
          </>
        )}
      >
        <Hint>{t('editor.insertDoc.hint', { defaultValue: '고른 문서의 본문을 지금 커서 자리에 복사해 넣습니다. 넣은 뒤에는 이 문서의 글이라 자유롭게 고칠 수 있고, 원본이 바뀌어도 따라오지 않습니다.' }) as string}</Hint>
        <PlanQSelect
          inputId="insert-doc-search"
          size="sm" isSearchable
          isLoading={posts === null}
          placeholder={t('editor.insertDoc.searchPh', { defaultValue: '문서 제목으로 찾기…' }) as string}
          value={picked ? options.find((o) => o.value === String(picked)) || null : null}
          onChange={(opt) => setPicked((opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null)}
          options={options}
        />
        {posts && posts.length === 0 && <Hint>{t('editor.insertDoc.none', { defaultValue: '넣을 수 있는 문서가 없습니다' }) as string}</Hint>}
        <CheckRow>
          <input id="insert-doc-source" type="checkbox" checked={withSource} onChange={(e) => setWithSource(e.target.checked)} />
          <label htmlFor="insert-doc-source">
            {t('editor.insertDoc.withSource', { defaultValue: '맨 위에 «가져온 글: 제목 · 작성자» 한 줄 넣기' }) as string}
          </label>
        </CheckRow>
        <Hint>{t('editor.insertDoc.noSignature', { defaultValue: '서명란은 가져오지 않습니다.' }) as string}</Hint>
        {error && <ErrorText role="alert">{error}</ErrorText>}
      </StandardModal>
    </>
  );
};

export default EditorInsertDocButton;

const BtnLabel = styled.span`
  margin-left: 4px; font-size: 0.75rem;
  @media (max-width: 640px) { display: none; }
`;
const Hint = styled.p`margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const CheckRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 0.8125rem; color: #334155;
  input { width: 1rem; height: 1rem; accent-color: #14B8A6; }
`;
const ErrorText = styled.p`margin: 0; font-size: 0.8125rem; color: #B91C1C;`;
