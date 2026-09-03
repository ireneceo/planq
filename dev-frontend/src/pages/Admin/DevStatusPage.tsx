// 배포별 개발 현황 — platform_admin 전용. 라우트: /admin/dev-status
//
// Irene 2026-09-03: "배포 할 때마다 현재 작업중, 완료처리한 거, 진행중인 거, 이슈된거,
//   앞으로 해야 할 거 리스트업 해줘. 변경 후 바뀌는 현상, 추가로 체크해야 할 영역도 꼭 넣어.
//   개발자/관리자 시선으로 해. 개발관리 체계 제대로 알게."
//
// 사용자용 릴리즈노트(새 소식)와 다른 화면이다 — 여기에는 미공개 이슈·롤백 경로가 실린다.
//
// ★ 본문은 **텍스트로만** 렌더한다. dangerouslySetInnerHTML 금지 — 관리자 화면 저장형 XSS.
// ★ 알 수 없는 상태값(severity·verified)은 기본값으로 떨어뜨리지 않고 그 값 그대로 보인다
//   (CLAUDE.md 상태값 규약 — 조용한 기본값은 "안 열린다" 로 보인다).
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
// 헬퍼로 넘길 t 의 타입 — 손으로 좁게 적으면 i18next 의 TFunction 과 호환되지 않는다(TS2345)
type TFn = ReturnType<typeof useTranslation>['t'];
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import {
  listDevStatus, getDevStatus,
  type DevStatusSummary, type DevStatusDetail, type DevStatusSections,
} from '../../services/devStatus';

type SectionKey = keyof DevStatusSections;

// 개발자/관리자가 읽는 순서로 배열한다 — "지금 무엇이 진행 중인가" 가 먼저,
// "무엇을 더 봐야 하는가" 가 끝.
const SECTION_ORDER: SectionKey[] = [
  'working_on', 'in_progress', 'completed', 'behavior_changes',
  'issues', 'blocked_on_human', 'migrations', 'check_areas',
  'backlog', 'tooling_health', 'undeployed',
];

export default function DevStatusPage() {
  const { t } = useTranslation('admin');
  const [list, setList] = useState<DevStatusSummary[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<DevStatusDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listDevStatus(50);
      setList(rows);
      setSel((cur) => cur ?? rows[0]?.commit_to ?? null);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let cancelled = false;
    getDevStatus(sel).then((d) => { if (!cancelled) setDetail(d); }).catch((e) => { if (!cancelled) setErr((e as Error).message); });
    return () => { cancelled = true; };
  }, [sel]);

  const options: PlanQSelectOption[] = list.map((r) => ({
    value: r.commit_to,
    label: `${new Date(r.deployed_at).toLocaleString()} · ${r.commit_to.slice(0, 8)}${r.version ? ` · v${r.version}` : ''}`,
  }));

  // 라벨은 locales/{ko,en}/admin.json 의 devStatus.section.* 가 정본이다.
  // 여기에 한국어 사전을 또 두면 두 벌이 되고, 가드도 하드코딩으로 잡는다.
  const label = (k: SectionKey) => t(`devStatus.section.${k}`) as string;

  return (
    <PageShell
      title={t('devStatus.title', '개발 현황') as string}
      count={list.length}
      actions={
        <SelectWrap>
          <PlanQSelect
            size="sm"
            options={options}
            value={options.find((o) => o.value === sel) || null}
            onChange={(o) => setSel(o ? String((o as PlanQSelectOption).value) : null)}
            placeholder={t('devStatus.pickDeploy', '배포 선택') as string}
            isSearchable
          />
        </SelectWrap>
      }
    >
      {err && <ErrBar role="alert">{err}</ErrBar>}
      {!loading && list.length === 0 && (
        <EmptyState
          title={t('devStatus.emptyTitle', '아직 기록된 배포가 없습니다') as string}
          description={t('devStatus.emptyDesc', '다음 배포부터 자동으로 쌓입니다. 배포 스크립트가 docs/dev-status/{커밋}.json 을 읽어 발행합니다.') as string}
        />
      )}

      {detail && (
        <>
          {/* 기계가 채운 사실 — 사람이 적지 않는 값이라 항상 맞다 */}
          <FactGrid>
            <Fact><FLabel>{t('devStatus.deployedAt', '배포 시각')}</FLabel><FVal>{new Date(detail.deployed_at).toLocaleString()}</FVal></Fact>
            <Fact><FLabel>{t('devStatus.range', '커밋 범위')}</FLabel><FVal><Mono>{(detail.commit_from || '—').slice(0, 8)} → {detail.commit_to.slice(0, 8)}</Mono></FVal></Fact>
            <Fact><FLabel>{t('devStatus.version', '버전')}</FLabel><FVal>{detail.version ? `v${detail.version}` : '—'}</FVal></Fact>
            <Fact><FLabel>{t('devStatus.schema', '스키마 변경')}</FLabel><FVal>{detail.schema_changed ? t('devStatus.yes', '있음') : t('devStatus.no', '없음')}</FVal></Fact>
            <Fact><FLabel>{t('devStatus.releaseNote', '릴리즈노트')}</FLabel><FVal>{detail.release_note_published ? t('devStatus.published', '발행됨') : t('devStatus.notPublished', '미발행')}</FVal></Fact>
            <Fact><FLabel>{t('devStatus.pdfCheck', 'PDF 렌더 점검')}</FLabel><FVal>{detail.pdf_check || '—'}</FVal></Fact>
            <Fact $wide><FLabel>{t('devStatus.rollback', '롤백 경로')}</FLabel><FVal><Mono>{detail.backup_dir || '—'}</Mono></FVal></Fact>
            <Fact><FLabel>{t('devStatus.closed', '닫은 신고')}</FLabel><FVal>{detail.closed_feedback_ids.length ? detail.closed_feedback_ids.map((n) => `#${n}`).join(' ') : '—'}</FVal></Fact>
            <Fact><FLabel>{t('devStatus.keptOpen', '일부러 열어둔 신고')}</FLabel><FVal>{detail.kept_open_ids.length ? detail.kept_open_ids.map((n) => `#${n}`).join(' ') : '—'}</FVal></Fact>
          </FactGrid>

          {SECTION_ORDER.map((k) => {
            const items = detail.sections[k] || [];
            return (
              <Section key={k}>
                <SecHead>
                  <SecTitle>{label(k)}</SecTitle>
                  <SecCount>{items.length}</SecCount>
                </SecHead>
                {items.length === 0 ? (
                  <Nothing>{t('devStatus.none', '없음')}</Nothing>
                ) : (
                  <List>
                    {(items as Record<string, unknown>[]).map((it, i) => (
                      <Row key={i}>
                        <RowMain>
                          <RowTitle>{String(it.title || it.area || it.what || it.tool || it.script || it.subject || '—')}</RowTitle>
                          {renderMeta(it, detail, t)}
                        </RowMain>
                        {renderBody(k, it, t)}
                      </Row>
                    ))}
                  </List>
                )}
              </Section>
            );
          })}
        </>
      )}
    </PageShell>
  );
}

// 본문 — 항목 종류마다 보여줄 필드가 다르다. 전부 텍스트다.
function renderBody(k: SectionKey, it: Record<string, unknown>, t: TFn) {
  if (k === 'behavior_changes') {
    return (
      <Diff>
        <DiffCell $kind="before"><DiffLabel>{t('devStatus.before', '이전')}</DiffLabel>{String(it.before || '—')}</DiffCell>
        <DiffCell $kind="after"><DiffLabel>{t('devStatus.after', '이후')}</DiffLabel>{String(it.after || '—')}</DiffCell>
        {it.affected ? <Affected>{t('devStatus.affected', '영향')}: {String(it.affected)}</Affected> : null}
      </Diff>
    );
  }
  const text = it.detail || it.why || it.symptom || it.rollback_note || '';
  const extra = k === 'check_areas' ? it.how : k === 'tooling_health' ? it.workaround : null;
  if (!text && !extra) return null;
  return (
    <RowDetail>
      {text ? <p>{String(text)}</p> : null}
      {extra ? <p><Dim>→ </Dim>{String(extra)}</p> : null}
    </RowDetail>
  );
}

// 메타 뱃지 — ★ 알 수 없는 값도 그대로 보인다(기본값으로 떨어뜨리지 않는다)
function renderMeta(
  it: Record<string, unknown>,
  detail: DevStatusDetail,
  t: TFn,
) {
  const chips: { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }[] = [];
  if (it.verified) {
    const v = String(it.verified);
    chips.push({
      text: v === 'fable_pass' ? t('devStatus.verifiedFable', 'Fable 검증')
        : v === 'opus_only' ? t('devStatus.verifiedOpus', '자체 검증만')
        : v === 'none' ? t('devStatus.verifiedNone', '미검증') : v,
      tone: v === 'fable_pass' ? 'good' : v === 'none' ? 'bad' : 'warn',
    });
  }
  if (it.severity) chips.push({ text: String(it.severity), tone: String(it.severity) === 'critical' || String(it.severity) === 'high' ? 'bad' : 'warn' });
  if (it.priority) chips.push({ text: String(it.priority), tone: 'neutral' });
  if (it.owner) chips.push({ text: String(it.owner), tone: 'neutral' });
  if (it.who) chips.push({ text: String(it.who), tone: 'neutral' });
  if (it.since) chips.push({ text: String(it.since), tone: 'neutral' });
  if (it.blocked_by) chips.push({ text: `${t('devStatus.blockedBy', '막힘')}: ${String(it.blocked_by)}`, tone: 'warn' });
  if (it.table) chips.push({ text: String(it.table), tone: 'neutral' });
  if (it.kind) chips.push({ text: String(it.kind), tone: 'neutral' });
  if (it.commit) chips.push({ text: String(it.commit).slice(0, 8), tone: 'neutral' });
  // ★ 이슈 상태는 여기 적힌 글이 아니라 피드백 원장이 정본이다
  if (it.feedback_id) {
    const live = detail.feedback_status[String(it.feedback_id)];
    chips.push({ text: `#${it.feedback_id}${live ? ` · ${live}` : ''}`, tone: live === 'done' ? 'good' : 'warn' });
  }
  if (!chips.length) return null;
  return <Chips>{chips.map((c, i) => <Chip key={i} $tone={c.tone}>{c.text}</Chip>)}</Chips>;
}


const SelectWrap = styled.div`min-width: 260px; max-width: 100%;`;
const ErrBar = styled.div`
  background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;
  border-radius:8px;padding:10px 12px;font-size:0.8125rem;margin-bottom:14px;
`;
const FactGrid = styled.div`
  display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1px;
  background:#E2E8F0;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;margin-bottom:20px;
`;
const Fact = styled.div<{ $wide?: boolean }>`
  background:#fff;padding:10px 12px;${(p) => p.$wide && 'grid-column: span 2;'}
  @media (max-width: 640px){ grid-column: auto; }
`;
const FLabel = styled.div`font-size:0.6875rem;color:#64748B;margin-bottom:3px;`;
const FVal = styled.div`font-size:0.8125rem;color:#0F172A;font-weight:600;word-break:break-all;`;
const Mono = styled.span`font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;`;

const Section = styled.section`
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:14px;overflow:hidden;
`;
const SecHead = styled.div`
  display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #F1F5F9;background:#F8FAFC;
`;
const SecTitle = styled.h3`font-size:0.875rem;font-weight:700;color:#0F172A;margin:0;`;
const SecCount = styled.span`
  font-size:0.6875rem;font-weight:700;color:#475569;background:#E2E8F0;
  border-radius:999px;padding:1px 8px;min-width:20px;text-align:center;
`;
const Nothing = styled.div`padding:12px 14px;font-size:0.8125rem;color:#94A3B8;`;
const List = styled.div`display:flex;flex-direction:column;`;
const Row = styled.div`
  padding:11px 14px;border-bottom:1px solid #F1F5F9;
  &:last-child{border-bottom:none;}
`;
const RowMain = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:8px;`;
const RowTitle = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;flex:1 1 0;min-width:0;`;
const RowDetail = styled.div`
  margin-top:5px;font-size:0.8125rem;color:#475569;line-height:1.55;
  p{margin:0 0 3px;} p:last-child{margin-bottom:0;}
`;
const Dim = styled.span`color:#94A3B8;`;
const Chips = styled.div`display:flex;flex-wrap:wrap;gap:4px;`;
const Chip = styled.span<{ $tone: 'neutral' | 'good' | 'warn' | 'bad' }>`
  font-size:0.6875rem;font-weight:700;border-radius:5px;padding:2px 7px;white-space:nowrap;
  ${(p) => p.$tone === 'good' ? 'background:#ECFDF5;color:#047857;'
    : p.$tone === 'warn' ? 'background:#FFFBEB;color:#B45309;'
    : p.$tone === 'bad' ? 'background:#FEF2F2;color:#B91C1C;'
    : 'background:#F1F5F9;color:#475569;'}
`;
const Diff = styled.div`
  margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:8px;
  @media (max-width: 640px){ grid-template-columns:1fr; }
`;
const DiffCell = styled.div<{ $kind: 'before' | 'after' }>`
  font-size:0.8125rem;line-height:1.5;border-radius:8px;padding:8px 10px;
  ${(p) => p.$kind === 'before' ? 'background:#F8FAFC;color:#64748B;' : 'background:#ECFDF5;color:#065F46;'}
`;
const DiffLabel = styled.div`font-size:0.6875rem;font-weight:700;opacity:.75;margin-bottom:2px;`;
const Affected = styled.div`grid-column:1/-1;font-size:0.75rem;color:#64748B;`;
