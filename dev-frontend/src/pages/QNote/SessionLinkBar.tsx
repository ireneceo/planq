// 노트 ↔ 프로젝트·고객 연결.
//
// Irene 2026-09-03: "프로젝트나 고객 연결하는 기능이 없어. 그래서 히스토리에 안 쌓여."
//   여태 세션의 project_id 는 L2(팀 비공개) **범위 판정용**으로만 있었고, 연결 수단이 아니었다.
//   고객은 아예 없었다. 회의록이 어느 일·어느 고객의 것인지 남지 않으니
//   나중에 그 프로젝트를 열어도 회의 기록이 없다.
//
// ★ 서버가 그 프로젝트·고객이 내 워크스페이스 것인지 확인한다 — 화면 목록만 믿지 않는다.
import { useEffect, useState } from 'react';
// 연결 입력 문구는 한 곳에서 온다 (화면마다 적으면 갈라진다)
import { CONNECT_PROMPT } from '../../components/Common/connectPrompts';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { linkSessionEntities, type QNoteSession } from '../../services/qnote';
// 고객 이름 정본 — `clients` 응답에 `name` 은 없다(display_name). 손으로 읽으면 라벨이 빈다.
import { displayName, type NameLocalizable } from '../../utils/displayName';

interface Props {
  session: QNoteSession;
  businessId: number;
  editable: boolean;
  onChange: (updated: QNoteSession) => void;
}

interface Opt { id: number; name: string }

export default function SessionLinkBar({ session, businessId, editable, onChange }: Props) {
  const { t, i18n } = useTranslation('qnote');
  const { t: tc } = useTranslation('common');   // 연결 문구 정본
  const [projects, setProjects] = useState<Opt[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [busy, setBusy] = useState<'project' | 'client' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 목록은 편집 가능할 때만 불러온다 — 읽기만 하는 사람에게는 요청 자체가 낭비다
  useEffect(() => {
    if (!editable || !businessId) return;
    let alive = true;
    apiFetch(`/api/projects?business_id=${businessId}&limit=200`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.success) setProjects((j.data || []).map((p: Opt) => ({ id: p.id, name: p.name }))); })
      .catch(() => { /* 목록이 비면 고를 수 없다 — 아래 안내 문구가 그 사실을 말한다 */ });
    // ★ 고객 목록은 **경로 파라미터**다(`/api/clients/:businessId`). 쿼리로 부르면 404 HTML 이
    //   돌아와 목록이 조용히 빈다 — 셀렉트는 열리는데 고를 것이 없는 상태가 된다.
    apiFetch(`/api/clients/${businessId}?limit=200`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.success) return;
        setClients((j.data || []).map((c: NameLocalizable & { id: number }) => ({
          id: c.id, name: displayName(c, i18n.language),
        })));
      })
      .catch(() => { /* 위와 같음 */ });
    return () => { alive = false; };
  }, [editable, businessId, i18n.language]);

  const save = async (kind: 'project' | 'client', id: number | null) => {
    setBusy(kind); setErr(null);
    try {
      const body = kind === 'project'
        ? (id ? { project_id: id } : { unlink_project: true })
        : (id ? { client_id: id } : { unlink_client: true });
      // savemerge-exempt: 받는 쪽(QNotePage)이 applySessionPatch 로 덧입힌다 — 여기서는 원본을 그대로 넘긴다
      onChange(await linkSessionEntities(session.id, body));
    } catch (e) {
      const msg = (e as Error).message || '';
      // 서버가 거절한 이유를 그대로 알린다 — "저장 실패" 만 띄우면 왜인지 알 수 없다
      setErr(msg.includes('not_in_workspace')
        ? (t('link.notInWorkspace', { defaultValue: '이 워크스페이스의 항목이 아닙니다' }) as string)
        : msg.includes('owner_only')
          ? (t('link.ownerOnly', { defaultValue: '작성자만 연결할 수 있습니다' }) as string)
          : (t('link.failed', { defaultValue: '연결에 실패했습니다' }) as string));
    } finally { setBusy(null); }
  };

  // ★ 해제는 **목록의 첫 항목**으로 한다 — 칸 안의 작은 X 를 없앤다.
  //   X 는 32px 을 상시 먹으면서 무엇을 지우는지 말해주지 않는다(Irene: "굳이 X가 표시되는게
  //   필요하다면 … 텍스트가 잘 안보여"). 목록 항목이면 글자로 뜻이 보이고 자리도 돌려받는다.
  const NONE = -1;
  const projOpts: PlanQSelectOption[] = [
    { value: NONE, label: tc(CONNECT_PROMPT.projectNone) as string },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  const clientOpts: PlanQSelectOption[] = [
    { value: NONE, label: tc(CONNECT_PROMPT.clientNone) as string },
    ...clients.map((c) => ({ value: c.id, label: c.name })),
  ];
  const curProj = session.project_id ? (projOpts.find((o) => o.value === session.project_id) || null) : null;
  const curClient = session.client_id ? (clientOpts.find((o) => o.value === session.client_id) || null) : null;

  // 읽기 전용이면 연결된 것만 보여준다. 빈 셀렉트를 보여주면 누를 수 있는 것처럼 보인다.
  if (!editable) {
    if (!session.project_id && !session.client_id) return null;
    return (
      <Row>
        {curProj && <ReadChip>{t('link.project', { defaultValue: '프로젝트' })} · {curProj.label}</ReadChip>}
        {curClient && <ReadChip>{t('link.client', { defaultValue: '고객' })} · {curClient.label}</ReadChip>}
      </Row>
    );
  }

  return (
    <>
      <Row>
        <Field>
          <PlanQSelect
            size="sm"
            options={projOpts}
            value={curProj}
            onChange={(o) => {
              const v = o ? Number((o as PlanQSelectOption).value) : null;
              save('project', v === NONE ? null : v);
            }}
            placeholder={t('link.projectPlaceholder', { defaultValue: '프로젝트 연결 안 함' }) as string}
            isSearchable
            isDisabled={busy === 'project'}
          />
        </Field>
        <Field>
          <PlanQSelect
            size="sm"
            options={clientOpts}
            value={curClient}
            onChange={(o) => {
              const v = o ? Number((o as PlanQSelectOption).value) : null;
              save('client', v === NONE ? null : v);
            }}
            placeholder={t('link.clientPlaceholder', { defaultValue: '고객 연결 안 함' }) as string}
            isSearchable
            isDisabled={busy === 'client'}
          />
        </Field>
      </Row>
      {err && <ErrText role="alert">{err}</ErrText>}
    </>
  );
}

const Row = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  /* ★ 2026-09-08 (Irene: "모바일에서 q note 에서 상단 부분에 너무 높아.
     프로젝트 고객 연결하는 걸 한행으로 할까?") — 폰에서는 두 칸의 최소폭(140+140+간격)이
     화면 폭을 넘겨 **두 줄로 감겼다**. 상단이 그만큼 높아지고, 그 높이는 본문(전사)에서 뺏은 것이다.
     폰에서는 감지 않고 둘이 화면을 반씩 나눠 갖게 한다. */
  @media (max-width: 640px) { flex-wrap: nowrap; }
`;
const Field = styled.div`
  /* ★ 2026-09-18 실측 — 이 칸이 **156px** 이었다(선언은 max 240 인데 밴드가 그만큼을 안 줬다).
     값이 선택되면 지우기 X + 화살표가 64px 을 먹어 **글자 자리가 72px**(한글 5자)밖에 안 남아
     프로젝트·고객 이름이 늘 잘렸다 (Irene: "텍스트가 잘 안보여").
     기준을 올려 최소 200px 을 보장한다. 밴드는 감기지 않고 가로로 흐른다(아래 Row 주석). */
  flex: 0 1 260px; min-width: 200px; max-width: 300px;
  /* 폰: 최소폭을 풀어야 두 칸이 한 줄에 들어간다. min-width:0 이 없으면 flex 아이템이
     내용 폭 아래로 안 줄어들어(기본 min-width:auto) nowrap 이 넘쳐 흐른다. */
  @media (max-width: 640px) { flex: 1 1 0; min-width: 0; max-width: none; }
`;
const ReadChip = styled.span`
  font-size: 0.75rem; color: #475569; background: #F1F5F9;
  border-radius: 6px; padding: 3px 8px;
`;
const ErrText = styled.div`
  font-size: 0.75rem; color: #B91C1C; margin-top: 4px;
`;
