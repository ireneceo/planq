// 메모(댓글) 스레드 — Q Talk 우측 패널 · Q mail 맥락 패널 공통.
//
// 메모는 "어딘가에 붙는 댓글" 이다: 누가 언제 썼는지 보이고, 여러 개가 시간 순으로 쌓이고,
// 공개 범위를 고를 수 있다. 화면마다 한 줄 입력 + [추가] 버튼으로 제각각 만들면 같은 기능이
// 다른 물건처럼 보인다(Q mail 이 그랬다). 디자인 원본은 Q Talk RightPanel 의 메모 — 그대로 박제.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface NoteItemData {
  id: number;
  body: string;
  visibility: string;             // 'personal' | 'internal' | 'shared'
  author_user_id: number;
  author_name?: string | null;
  created_at?: string | null;
}

interface Props {
  notes: NoteItemData[];
  myUserId: number | null;
  /** 공개 범위 선택 노출 (client 는 숨김) */
  canChooseVisibility?: boolean;
  busy?: boolean;
  onAdd: (body: string, visibility: 'internal' | 'personal') => void | Promise<void>;
  /** 본인 메모만 삭제 가능 — 넘기지 않으면 삭제 버튼 없음 */
  onDelete?: (id: number) => void | Promise<void>;
  formatTime?: (iso: string) => string;
  emptyText?: string;
  placeholder?: string;
  /** 메타 줄에 덧붙일 것 (예: Q Talk 의 출처 대화 태그) */
  renderMeta?: (note: NoteItemData) => ReactNode;
}

export default function NoteThread({
  notes, myUserId, canChooseVisibility = true, busy,
  onAdd, onDelete, formatTime, emptyText, placeholder, renderMeta,
}: Props) {
  const { t } = useTranslation('common');
  const [text, setText] = useState('');
  const [shared, setShared] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    await onAdd(body, shared ? 'internal' : 'personal');
    setText('');
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 조합 중 무시 (한글 마지막 음절 중복 입력 방지)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // ⌘/Ctrl+Enter 만 저장 — 일반 Enter 는 줄바꿈
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <Wrap>
      <List ref={listRef}>
        {notes.length === 0 && (
          <Empty>{emptyText || (t('note.empty', { defaultValue: '아직 메모가 없습니다' }) as string)}</Empty>
        )}
        {notes.map((n) => (
          <Item key={n.id}>
            {n.visibility === 'personal' && (
              <Vis>{t('note.onlyMe', { defaultValue: '나만' }) as string}</Vis>
            )}
            <Content>
              <Body>{n.body}</Body>
              <Meta>
                {n.author_name || t('note.someone', { defaultValue: '팀원' }) as string}
                {n.created_at && formatTime ? ` · ${formatTime(n.created_at)}` : ''}
                {renderMeta ? renderMeta(n) : null}
                {onDelete && myUserId != null && Number(n.author_user_id) === Number(myUserId) && (
                  <>
                    {' · '}
                    <DelBtn type="button" onClick={() => onDelete(n.id)}>
                      {t('note.delete', { defaultValue: '삭제' }) as string}
                    </DelBtn>
                  </>
                )}
              </Meta>
            </Content>
          </Item>
        ))}
      </List>

      <InputRow>
        <TextInput
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder || (t('note.placeholder', { defaultValue: '메모 작성... (⌘/Ctrl+Enter 저장)' }) as string)}
        />
        {canChooseVisibility && (
          <VisToggle>
            <VisOption type="button" $active={shared} onClick={() => setShared(true)}>
              {t('note.withTeam', { defaultValue: '공개' }) as string}
            </VisOption>
            <VisOption type="button" $active={!shared} onClick={() => setShared(false)}>
              {t('note.onlyMe', { defaultValue: '나만' }) as string}
            </VisOption>
          </VisToggle>
        )}
        <SendBtn
          type="button"
          onClick={submit}
          disabled={!text.trim() || !!busy}
          title={t('note.saveHint', { defaultValue: '저장 (⌘/Ctrl+Enter)' }) as string}
          aria-label={t('note.saveHint', { defaultValue: '저장 (⌘/Ctrl+Enter)' }) as string}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </SendBtn>
      </InputRow>
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 8px; min-width: 0;`;
const List = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  max-height: 260px; overflow-y: auto;
`;
const Empty = styled.div`font-size: 12px; color: #94A3B8; padding: 6px 0;`;
const Item = styled.div`
  display: flex; align-items: flex-start; gap: 6px;
  padding: 8px 10px; background: #F8FAFC; border-radius: 8px;
`;
const Vis = styled.span`
  flex-shrink: 0; margin-top: 1px; padding: 1px 6px; border-radius: 999px;
  font-size: 10px; font-weight: 700; color: #92400E; background: #FEF3C7;
`;
const Content = styled.div`min-width: 0; flex: 1;`;
const Body = styled.div`font-size: 12px; color: #334155; line-height: 1.55; white-space: pre-wrap; word-break: break-word;`;
const Meta = styled.div`margin-top: 3px; font-size: 11px; color: #94A3B8;`;
const DelBtn = styled.button`
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 11px; color: #94A3B8;
  &:hover { color: #DC2626; }
`;
const InputRow = styled.div`
  display: flex; align-items: flex-end; gap: 6px;
  padding: 6px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const TextInput = styled.textarea`
  flex: 1; min-width: 0; border: none; outline: none; resize: none;
  font-size: 12px; color: #0F172A; line-height: 1.5; max-height: 96px;
  font-family: inherit;
  &::placeholder { color: #94A3B8; }
`;
const VisToggle = styled.div`display: flex; flex-shrink: 0; border: 1px solid #E2E8F0; border-radius: 999px; overflow: hidden;`;
const VisOption = styled.button<{ $active: boolean }>`
  border: none; cursor: pointer; padding: 3px 8px;
  font-size: 10px; font-weight: 700;
  color: ${(p) => (p.$active ? '#0F766E' : '#94A3B8')};
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
`;
const SendBtn = styled.button`
  flex-shrink: 0; width: 28px; height: 28px; border: none; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #FFFFFF; background: #14B8A6;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;
