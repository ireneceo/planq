// 통합 정체성 컨텍스트 — 이름 옆 "소속"을 대상 타입별로 일관 표현.
//   - 내부 직원(member): 소속 = 부서 · 팀 (조직 D1)
//   - 외부 고객/파트너(client): 소속 = 유형(배지) + 회사명
// 채팅 hover · 업무 상세 담당자 · 리스트 어디서나 같은 규칙. 신규 surface 도 이걸 경유.
// 설계: docs/TASK_TEMPLATE_AI_RECOMMEND_DESIGN.md 의 자매 — 정체성 컨텍스트 단일 출처.
import styled from 'styled-components';
import PartnerKindBadge from './PartnerKindBadge';
import { affiliationLabel, type OrgUnitLite } from '../../utils/orgLabel';

export type IdentityPerson =
  | { type: 'member'; department?: OrgUnitLite; team?: OrgUnitLite }
  | { type: 'client'; company_name?: string | null; kind?: string | null };

// 텍스트 단독 (tooltip / aria-label) — member: 부서 · 팀 / client: 회사명.
// (유형 배지는 시각 표현이라 텍스트에는 회사명만)
export function identityText(p?: IdentityPerson | null, lang?: string): string {
  if (!p) return '';
  if (p.type === 'member') return affiliationLabel(p, lang);
  return p.company_name || '';
}

interface Props {
  person?: IdentityPerson | null;
  lang?: string;
  className?: string;
}

// 인라인 시각 렌더 — 상세 패널 담당자 보조줄 등. 비어있으면 아무것도 안 그림.
export default function IdentityContext({ person, lang, className }: Props) {
  if (!person) return null;
  if (person.type === 'member') {
    const aff = affiliationLabel(person, lang);
    return aff ? <Text className={className}>{aff}</Text> : null;
  }
  // client — 유형 배지 + 회사명
  const company = person.company_name || '';
  if (!company && !person.kind) return null;
  return (
    <Row className={className}>
      {person.kind && <PartnerKindBadge kind={person.kind} size="xs" />}
      {company && <Text as="span">{company}</Text>}
    </Row>
  );
}

const Text = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.4; word-break: keep-all;
`;
const Row = styled.div`
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px;
`;
