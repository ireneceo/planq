// 공개 공유 페이지의 첨부 목록 — 문서 공유(PublicPostPage)와 업무 공유(PublicTaskPage)가 **같은 것**을 쓴다.
//   2026-09-27 PublicPostPage 안에 있던 조각을 값 그대로 옮겼다(베끼면 갈라진다).
//   무엇을 싣는지(외부 공개 L4 만)는 서버가 정한다 — 이 컴포넌트는 받은 것만 그린다.
//
// ★ 2026-11-03 — 이름을 링크로 두지 않는다. Irene: *"누르면 열릴 것 같은데 갑자기 다운로드 되서"*.
//   이름은 글자로만 두고, 할 수 있는 일을 **글자 붙은 단추**로 오른쪽에 따로 둔다 — [열기] · [↓ 받기].
//   받기는 `download` 속성 + 아래 화살표, 열기는 새 탭. 무엇이 일어나는지 단추가 말한다.
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export interface PublicAttachmentItem {
  id: number | string;
  name: string;
  /** 받기 주소 — 누르면 파일이 내려받아진다 */
  downloadHref?: string | null;
  /** 열기 주소 — 새 탭에서 본다(연결 문서·업무에 붙은 문서) */
  openHref?: string | null;
  /** 받기 단추 글자(기본 «받기») — 연결 문서는 «PDF 받기» */
  downloadLabel?: string;
}

const PublicAttachmentList = ({ title, items, testId }: { title: string; items: PublicAttachmentItem[]; testId?: string }) => {
  const { t } = useTranslation('common');
  if (!items.length) return null;
  return (
    <AttachSection data-testid={testId}>
      <AttachTitle>{title}</AttachTitle>
      {items.map((a) => (
        <AttachRow key={a.id} data-testid="public-attach-row">
          <AttachName title={a.name}>{a.name}</AttachName>
          <Actions>
            {a.openHref && (
              <ActBtn href={a.openHref} target="_blank" rel="noreferrer" data-testid="public-attach-open">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                {t('publicAttach.open', '열기') as string}
              </ActBtn>
            )}
            {a.downloadHref && (
              <ActBtn href={a.downloadHref} download data-testid="public-attach-download">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {a.downloadLabel || (t('publicAttach.download', '받기') as string)}
              </ActBtn>
            )}
          </Actions>
        </AttachRow>
      ))}
    </AttachSection>
  );
};

export default PublicAttachmentList;

const AttachTitle = styled.h3`font-size:0.8125rem;font-weight:700;color:#334155;margin:0;`;
const AttachRow = styled.div`
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 6px 0; border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const AttachName = styled.span`
  flex: 1; min-width: 0; font-size: 0.8125rem; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Actions = styled.div`display: flex; gap: 6px; flex-shrink: 0;`;
const ActBtn = styled.a`
  display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px; background: #fff;
  font-size: 0.75rem; font-weight: 600; color: #334155; text-decoration: none; white-space: nowrap;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const AttachSection = styled.section`
  margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 4px;
`;
