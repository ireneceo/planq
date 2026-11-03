// 공개 공유 페이지의 첨부 목록 — 문서 공유(PublicPostPage)와 업무 공유(PublicTaskPage)가 **같은 것**을 쓴다.
//   2026-09-27 PublicPostPage 안에 있던 조각을 값 그대로 옮겼다(베끼면 갈라진다).
//   무엇을 싣는지(외부 공개 L4 만)는 서버가 정한다 — 이 컴포넌트는 받은 것만 그린다.
import styled from 'styled-components';

// extra — 이름 옆 보조 링크(연결 문서: 이름 = PDF 받기, «열기» = 그 문서 공개 페이지)
export interface PublicAttachmentItem { id: number | string; name: string; href: string; extra?: { label: string; href: string } }

const PublicAttachmentList = ({ title, items, testId }: { title: string; items: PublicAttachmentItem[]; testId?: string }) => {
  if (!items.length) return null;
  return (
    <AttachSection data-testid={testId}>
      <AttachTitle>{title}</AttachTitle>
      {items.map((a) => (
        <AttachRow key={a.id}>
          <AttachLink href={a.href} target="_blank" rel="noreferrer">{a.name}</AttachLink>
          {a.extra && <ExtraLink href={a.extra.href} target="_blank" rel="noreferrer">{a.extra.label}</ExtraLink>}
        </AttachRow>
      ))}
    </AttachSection>
  );
};

export default PublicAttachmentList;

const AttachTitle = styled.h3`font-size:0.8125rem;font-weight:700;color:#334155;margin:0;`;
const AttachRow = styled.div`font-size:0.8125rem;`;
const AttachLink = styled.a`
  color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const ExtraLink = styled.a`
  margin-left: 8px; color: #64748B; text-decoration: none; font-size: 0.75rem;
  &:hover { text-decoration: underline; }
`;
const AttachSection = styled.section`
  margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 8px;
`;
