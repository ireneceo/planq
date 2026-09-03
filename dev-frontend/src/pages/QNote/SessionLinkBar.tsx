// 노트 ↔ 프로젝트·고객 연결.
//
// Irene 2026-09-03: "프로젝트나 고객 연결하는 기능이 없어. 그래서 히스토리에 안 쌓여."
//   여태 세션의 project_id 는 L2(팀 비공개) **범위 판정용**으로만 있었고, 연결 수단이 아니었다.
//   고객은 아예 없었다. 회의록이 어느 일·어느 고객의 것인지 남지 않으니
//   나중에 그 프로젝트를 열어도 회의 기록이 없다.
//
// ★ 서버가 그 프로젝트·고객이 내 워크스페이스 것인지 확인한다 — 화면 목록만 믿지 않는다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { linkSessionEntities, type QNoteSession } from '../../services/qnote';

interface Props {
  session: QNoteSession;
  businessId: number;
  editable: boolean;
  onChange: (updated: QNoteSession) => void;
}

interface Opt { id: number; name: string }

export default function SessionLinkBar({ session, businessId, editable, onChange }: Props) {
  const { t } = useTranslation('qnote');
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
      .then((j) => { if (alive && j?.success) setClients((j.data || []).map((c: Opt) => ({ id: c.id, name: c.name }))); })
      .catch(() => { /* 위와 같음 */ });
    return () => { alive = false; };
  }, [editable, businessId]);

  const save = async (kind: 'project' | 'client', id: number | null) => {
    setBusy(kind); setErr(null);
    try {
      const body = kind === 'project'
        ? (id ? { project_id: id } : { unlink_project: true })
        : (id ? { client_id: id } : { unlink_client: true });
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

  const projOpts: PlanQSelectOption[] = projects.map((p) => ({ value: p.id, label: p.name }));
  const clientOpts: PlanQSelectOption[] = clients.map((c) => ({ value: c.id, label: c.name }));
  const curProj = projOpts.find((o) => o.value === session.project_id) || null;
  const curClient = clientOpts.find((o) => o.value === session.client_id) || null;

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
            onChange={(o) => save('project', o ? Number((o as PlanQSelectOption).value) : null)}
            placeholder={t('link.projectPlaceholder', { defaultValue: '프로젝트 연결 안 함' }) as string}
            isClearable
            isSearchable
            isDisabled={busy === 'project'}
          />
        </Field>
        <Field>
          <PlanQSelect
            size="sm"
            options={clientOpts}
            value={curClient}
            onChange={(o) => save('client', o ? Number((o as PlanQSelectOption).value) : null)}
            placeholder={t('link.clientPlaceholder', { defaultValue: '고객 연결 안 함' }) as string}
            isClearable
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
`;
const Field = styled.div`
  /* 고정 px 대신 최소·최대 — 좁아지면 접힌다 */
  flex: 1 1 160px; min-width: 140px; max-width: 240px;
`;
const ReadChip = styled.span`
  font-size: 0.75rem; color: #475569; background: #F1F5F9;
  border-radius: 6px; padding: 3px 8px;
`;
const ErrText = styled.div`
  font-size: 0.75rem; color: #B91C1C; margin-top: 4px;
`;
