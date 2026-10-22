// 사람 기본 정보 한 벌 — 회사(소속)·부서·직책 / 이메일(누르면 우리 메일 작성) / 전화.
//   멤버 상세 · 고객 패널 · 고객 상세 · 대화 아바타 팝오버 · 프로젝트 고객 줄이 같은 것을 쓴다(Fable 판정 1).
//   이름은 그리지 않는다 — 부르는 화면의 머리줄이 이미 이름을 쓴다(«이름이 두 번 나온다» 신고, 2026-09-13).
import styled from 'styled-components';
import EmailLink from './EmailLink';
import { orgLine, type PersonBasicsData } from './personBasics';

// 한 줄로 가져다 쓰게 — 사람 화면은 셋을 같이 쓴다
export { fromClient, fromMember, fromProjectClient, orgLine } from './personBasics';
export { EmailLink };

interface Props {
  person: Pick<PersonBasicsData, 'company' | 'job_title' | 'department' | 'email' | 'phone'>;
  /** 한 줄로 붙여 쓰는 자리(목록 행·팝오버) */
  inline?: boolean;
  /** 이메일·전화 빼고 소속 줄만 */
  orgOnly?: boolean;
  className?: string;
}

export default function PersonBasics({ person, inline, orgOnly, className }: Props) {
  const org = orgLine(person);
  const hasContact = !orgOnly && (person.email || person.phone);
  if (!org && !hasContact) return null;
  return (
    <Wrap $inline={!!inline} className={className} data-testid="person-basics">
      {org && <Org title={org}>{org}</Org>}
      {hasContact && (
        <Contact $inline={!!inline}>
          {person.email && <EmailLink email={person.email} />}
          {person.phone && <Phone href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}>{person.phone}</Phone>}
        </Contact>
      )}
    </Wrap>
  );
}

const Wrap = styled.div<{ $inline: boolean }>`
  display: flex; flex-direction: ${(p) => (p.$inline ? 'row' : 'column')}; flex-wrap: ${(p) => (p.$inline ? 'wrap' : 'nowrap')};
  align-items: ${(p) => (p.$inline ? 'center' : 'flex-start')};
  gap: ${(p) => (p.$inline ? '4px 10px' : '2px')}; min-width: 0;
  font-size: 0.75rem; color: #64748B;
`;
const Org = styled.span`color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;`;
const Contact = styled.span<{ $inline: boolean }>`
  display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0;
`;
const Phone = styled.a`color:#475569; text-decoration:none; &:hover{text-decoration:underline;}
  @media (max-width: 640px) { display:inline-flex; align-items:center; min-height:44px; }`;
