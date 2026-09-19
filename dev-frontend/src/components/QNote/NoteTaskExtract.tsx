// 노트에서 업무 후보 뽑기 — Q note 회의록의 «업무추출».
//
// ★ 2026-09-19 — 서버 라우트(`routes/qnote_bridge.js` extract-tasks·task-candidates·register·reject)와
//   프론트 서비스(`services/qnote.ts` extractNoteTasks 외 3)가 **2026-06-05 부터 있었는데
//   부르는 화면이 한 곳도 없었다**(3개월 반). 만드는 쪽만 있고 읽는 곳이 0곳이면 없는 기능이다
//   (memory `feedback_produced_link_no_consumer`). 운영 신고 #382 의 «업무추출되게 하고» 가
//   여기서 막혀 있었다.
//
// ★ 카드는 **공용 `TaskCandidateCard`** 를 쓴다 — 채팅·Q task·메일이 이미 쓰는 그것이다.
//   여기서 다시 그리면 편집 가능한 항목(담당자·마감)이 자리마다 달라진다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import TaskCandidateCard, { type CandidateMember, type RegisterOverrides } from '../Common/TaskCandidateCard';
import { listBusinessMembers } from '../../services/qtalk';
import ActionButton from '../Common/ActionButton';
import {
  extractNoteTasks, listNoteCandidates, registerNoteCandidate, rejectNoteCandidate,
  type NoteTaskCandidate,
} from '../../services/qnote';

interface Props {
  businessId: number;
  sessionId: number;
  /** 추출에 넣을 본문 — 전사 전문(없으면 요약). 비어 있으면 버튼을 비활성 + 이유를 적는다. */
  text: string;
  title?: string;
  myUserId?: number;
}

export default function NoteTaskExtract({ businessId, sessionId, text, title, myUserId }: Props) {
  const { t } = useTranslation('qnote');
  // 담당자 후보는 여기서 직접 가져온다 — 얹는 쪽이 아무것도 준비하지 않아도 되게
  const [members, setMembers] = useState<CandidateMember[]>([]);
  useEffect(() => {
    let alive = true;
    listBusinessMembers(businessId)
      .then((rows) => { if (alive) setMembers(rows.map((m) => ({ user_id: m.user_id, name: m.name || m.user?.name || '' }))); })
      .catch(() => { /* 못 가져오면 담당자 선택만 빈다 — 추출 자체는 된다 */ });
    return () => { alive = false; };
  }, [businessId]);
  const [cands, setCands] = useState<NoteTaskCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 이미 뽑아 둔 후보를 먼저 보여준다 — 누를 때마다 다시 뽑게 하면 같은 후보가 쌓인다.
  //   ★ 알려진 것(2026-09-19 실측) — 이 조회가 **같은 밀리초에 2번** 나간다. 응답은 둘 다 200 이고
  //     화면에 보이는 영향은 없다(멱등 GET). 가른 사실: 멤버 조회도 2회인데 부모의 세션 조회는 1회 ·
  //     DOM 인스턴스 1개 · 프로덕션 빌드(StrictMode 아님) · 번들 청크 1벌.
  //     인스턴스별 ref 와 모듈 단위 합치기를 **둘 다 시도했지만 듣지 않았다** — 원인 미규명이다.
  //     듣지 않는 장치를 남기면 다음 사람이 «처리됐다» 고 믿으므로 걷어냈다. 증상만 여기 적어 둔다.
  useEffect(() => {
    let alive = true;
    setCands([]); setMsg(null);
    listNoteCandidates(businessId, sessionId)
      .then((rows) => { if (alive) setCands(rows); })
      .catch(() => { /* 없으면 빈 목록 — 아래 버튼으로 뽑는다 */ });
    return () => { alive = false; };
  }, [businessId, sessionId]);

  const extract = useCallback(async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const got = await extractNoteTasks(businessId, sessionId, { text, title });
      // 새로 뽑은 것을 앞에 두고, 이미 있던 것은 중복 없이 유지
      setCands((prev) => [...got, ...prev.filter((p) => !got.some((g) => g.id === p.id))]);
      if (got.length === 0) setMsg(t('extract.none', { defaultValue: '추출할 업무를 찾지 못했어요.' }) as string);
    } catch (e) {
      const m = (e as Error).message || '';
      // 실패를 삼키지 않는다 — AI 미가동과 «업무 없음» 은 사용자에게 다른 뜻이다
      setMsg(/503|unavailable/.test(m)
        ? (t('extract.aiUnavailable', { defaultValue: 'AI 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' }) as string)
        : (t('extract.failed', { defaultValue: '업무 추출에 실패했어요.' }) as string));
    } finally { setBusy(false); }
  }, [busy, businessId, sessionId, text, title, t]);

  const register = useCallback(async (id: number, ov: RegisterOverrides) => {
    if (rowBusy) return;
    setRowBusy(id);
    try {
      await registerNoteCandidate(businessId, sessionId, id, {
        title: ov.title, assignee_id: ov.assignee_id, start_date: ov.start_date, due_date: ov.due_date,
      });
      setCands((prev) => prev.filter((p) => p.id !== id));
      // 업무 화면이 열려 있으면 바로 따라오게 (CLAUDE.md 16-e 같은 탭 안 안전망)
      window.dispatchEvent(new CustomEvent('inbox:refresh'));
    } catch { setMsg(t('extract.registerFailed', { defaultValue: '업무로 등록하지 못했어요.' }) as string); }
    finally { setRowBusy(null); }
  }, [rowBusy, businessId, sessionId, t]);

  const reject = useCallback(async (id: number) => {
    if (rowBusy) return;
    setRowBusy(id);
    try {
      await rejectNoteCandidate(businessId, sessionId, id);
      setCands((prev) => prev.filter((p) => p.id !== id));
    } catch { setMsg(t('extract.rejectFailed', { defaultValue: '후보를 지우지 못했어요.' }) as string); }
    finally { setRowBusy(null); }
  }, [rowBusy, businessId, sessionId, t]);

  const hasText = !!(text && text.trim());

  return (
    <Wrap data-testid="qnote-task-extract">
      <Head>
        <HeadTitle>{t('extract.title', { defaultValue: '업무 추출' }) as string}</HeadTitle>
        <ActionButton
          tone="secondary" size="sm" loading={busy} disabled={!hasText || busy}
          data-testid="qnote-extract-run" onClick={extract}
        >
          {cands.length > 0
            ? (t('extract.again', { defaultValue: '다시 추출' }) as string)
            : (t('extract.run', { defaultValue: '업무 추출' }) as string)}
        </ActionButton>
      </Head>
      {/* 누를 수 없으면 **이유를 적는다** — 비활성 버튼만 두면 왜 안 되는지 알 수 없다 */}
      {!hasText && <Hint>{t('extract.needText', { defaultValue: '전사나 요약이 있어야 업무를 뽑을 수 있어요.' }) as string}</Hint>}
      {msg && <Hint role="status">{msg}</Hint>}
      {cands.length > 0 && (
        <List>
          {cands.map((c) => (
            <TaskCandidateCard
              key={c.id}
              candidate={{
                id: c.id,
                title: c.title,
                description: c.description,
                guessed_assignee: c.guessedAssignee
                  ? { user_id: c.guessedAssignee.id, name: c.guessedAssignee.name }
                  : (c.guessed_assignee_user_id
                    ? { user_id: c.guessed_assignee_user_id, name: members.find((m) => m.user_id === c.guessed_assignee_user_id)?.name || '' }
                    : null),
                guessed_due_date: c.guessed_due_date,
                similar_task_id: c.similar_task_id,
              }}
              members={members}
              myUserId={myUserId}
              busy={rowBusy === c.id}
              onRegister={register}
              onReject={reject}
            />
          ))}
        </List>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  border-top: 1px solid #F1F5F9;
  padding: 12px 20px;
  @media (max-width: 640px) { padding: 12px 16px; }
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const HeadTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; margin-top: 6px; line-height: 1.5;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px; margin-top: 10px;`;
