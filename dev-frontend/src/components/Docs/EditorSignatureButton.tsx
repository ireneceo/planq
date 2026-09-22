// 편집기 툴바의 [서명란] 버튼 (2026-09-22).
//
// PostEditor 에서 뺐다 — 그 파일이 800줄 god-file 문턱을 넘었고, 이 버튼은 **칸 번호를 정하는
// 규칙**(`utils/signatureFields.nextSlot`)을 서명 요청 창과 공유하므로 따로 서는 편이 맞다.
// 껍데기(ToolBtn)는 PostEditor 가 넘긴다 — 여기서 다시 그리면 툴바 규격이 갈라진다.
import React from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { nextSlot, type DocSignatureField } from '../../utils/signatureFields';

interface Props {
  editor: Editor;
  /** PostEditor 의 ToolBtn — 툴바 규격은 한 곳에서만 정의한다 */
  as: React.ElementType;
}

const EditorSignatureButton: React.FC<Props> = ({ editor, as: ToolBtn }) => {
  const { t } = useTranslation('qdocs');
  const insert = () => {
    // 문서에 이미 있는 칸 다음 번호로 — 같은 번호가 둘이면 어느 쪽에 그릴지 알 수 없다.
    const found: DocSignatureField[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'signatureField') {
        found.push({ slot: Number(n.attrs.slot) || 1, party: n.attrs.party === 'us' ? 'us' : 'them', label: null });
      }
    });
    const slot = nextSlot(found);
    // 첫 칸은 보내는 쪽(우리) — 요청 창에서 바꿀 수 있다.
    editor.chain().focus().insertSignatureField({ slot, party: slot === 1 ? 'us' : 'them' }).run();
  };
  return (
    <ToolBtn
      type="button"
      data-testid="editor-insert-signature"
      onClick={insert}
      title={t('editor.insertSignature', { defaultValue: '서명란 삽입 — 서명 요청 때 서명자를 이 칸에 짝짓습니다' })}
      aria-label={t('editor.insertSignatureAria', { defaultValue: '서명란 삽입' })}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17c3 0 4-8 7-8s3 6 6 6c2 0 3-2 5-2" />
        <line x1="3" y1="21" x2="21" y2="21" />
      </svg>
    </ToolBtn>
  );
};

export default EditorSignatureButton;
