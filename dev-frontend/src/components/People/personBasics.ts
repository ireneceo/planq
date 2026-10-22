// 멤버·고객을 «한 모양» 으로 — 화면 어댑터(2026-10-22 Fable 판정 1, docs/PEOPLE_PROFILE_UNIFY_DESIGN.md).
//   값은 각자 원래 응답에서 온다(멤버 = /businesses/:id/members, 고객 = Q sale·고객 응답). 서버에 셋째 모양을 두지 않는다 —
//   저장 응답과 조회 응답이 갈라지는 계열을 만들지 않으려고. 화면은 여기서 맞춘 PersonBasics 하나만 그린다.

export type PersonKind = 'member' | 'client';

export interface PersonBasicsData {
  kind: PersonKind;
  id: number;              // 멤버 = user_id · 고객 = client_id
  name: string;
  company: string | null;  // 멤버 = 소속(organization) · 고객 = 회사
  job_title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  status: string | null;   // 멤버 = 역할 · 고객 = 고객 상태(invited/active/managed/prospect/archived)
}

const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t || null;
};

/** 멤버 행(GET /api/businesses/:id/members 의 한 줄) — 워크스페이스 값이 먼저, 없으면 계정 값 */
export function fromMember(bm: {
  user_id?: number | null; name?: string | null; role?: string | null;
  job_title?: string | null; organization?: string | null;
  department?: { name?: string | null } | null; department_name?: string | null;
  user?: { id?: number; name?: string | null; email?: string | null; phone?: string | null; job_title?: string | null; organization?: string | null; avatar_url?: string | null; profile_image?: string | null } | null;
}): PersonBasicsData {
  const u = bm.user || {};
  return {
    kind: 'member',
    id: Number(bm.user_id || u.id || 0),
    name: s(bm.name) || s(u.name) || s(u.email) || '',
    company: s(bm.organization) || s(u.organization),
    job_title: s(bm.job_title) || s(u.job_title),
    department: s(bm.department?.name) || s(bm.department_name),
    email: s(u.email),
    phone: s(u.phone),
    avatar: s(u.avatar_url) || s(u.profile_image),
    status: s(bm.role),
  };
}

/** 고객 행(Q sale 고객 상세·목록·/api/clients 응답) */
export function fromClient(c: {
  id: number; display_name?: string | null; company_name?: string | null; biz_name?: string | null;
  job_title?: string | null; department?: string | null; invite_email?: string | null; phone?: string | null;
  status?: string | null; contact?: { invite_email?: string | null; account_email?: string | null; phone?: string | null } | null;
  user?: { name?: string | null; email?: string | null; avatar_url?: string | null } | null;
}): PersonBasicsData {
  return {
    kind: 'client',
    id: Number(c.id),
    name: s(c.display_name) || s(c.user?.name) || s(c.company_name) || s(c.biz_name) || '',
    company: s(c.company_name) || s(c.biz_name),
    job_title: s(c.job_title),
    department: s(c.department),
    email: s(c.contact?.account_email) || s(c.user?.email) || s(c.invite_email) || s(c.contact?.invite_email),
    phone: s(c.phone) || s(c.contact?.phone),
    avatar: s(c.user?.avatar_url),
    status: s(c.status),
  };
}

/** 프로젝트 > 고객 한 줄(project_clients + 서버 enrichment client_status) */
export function fromProjectClient(pc: {
  client_id?: number | null; contact_name?: string | null; contact_email?: string | null;
  contact_user_id?: number | null; client_status?: string | null;
  company_name?: string | null; job_title?: string | null;
}): PersonBasicsData {
  return {
    kind: 'client',
    id: Number(pc.client_id || 0),
    name: s(pc.contact_name) || s(pc.contact_email) || '',
    company: s(pc.company_name),
    job_title: s(pc.job_title),
    department: null,
    email: s(pc.contact_email),
    phone: null,
    avatar: null,
    status: s(pc.client_status) || (pc.contact_user_id ? 'active' : 'invited'),
  };
}

/** «회사 · 직책 · 부서» 한 줄 */
export function orgLine(p: Pick<PersonBasicsData, 'company' | 'job_title' | 'department'>): string {
  return [p.company, p.department, p.job_title].filter(Boolean).join(' · ');
}
