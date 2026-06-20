// ScheduleTimeline — R1 전체 일정 진행 타임라인 (시그니처, 캔버스+보고서 공유)
//   가로 축에 업무·마일스톤 배치 + "지금 여기" 마커 + 워크스트림 색 + 진행률·일정대비.
import { Fragment, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { WORKSTREAM_PALETTE } from '../../services/projectCanvas';
import type { TimelineData } from '../../services/projectTimeline';

interface Props {
  data: TimelineData;
  keyOnly: boolean;
  onToggleKeyOnly?: (next: boolean) => void;
  onTaskClick?: (id: number) => void;
}

const DAY = 86400000;
const toMs = (d: string | null) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime() : null);

export default function ScheduleTimeline({ data, keyOnly, onToggleKeyOnly, onTaskClick }: Props) {
  const { t } = useTranslation('qproject');

  const wsColor = useMemo(() => {
    const m = new Map<number, string>();
    data.workstreams.forEach((w, i) => m.set(w.id, w.color || WORKSTREAM_PALETTE[(w.order_index ?? i) % WORKSTREAM_PALETTE.length]));
    return (id: number | null) => (id != null && m.has(id) ? m.get(id)! : '#CBD5E1');
  }, [data.workstreams]);

  // 시간 범위 계산
  const range = useMemo(() => {
    const dates: number[] = [];
    const push = (d: string | null) => { const ms = toMs(d); if (ms != null) dates.push(ms); };
    push(data.project.start_date); push(data.project.end_date); push(data.today);
    data.tasks.forEach((tk) => { push(tk.start_date); push(tk.due_date); });
    if (dates.length === 0) return null;
    let from = Math.min(...dates); let to = Math.max(...dates);
    if (to <= from) to = from + 30 * DAY;
    const pad = (to - from) * 0.04;
    return { from: from - pad, to: to + pad };
  }, [data]);

  const pos = (d: string | null): number | null => {
    if (!range) return null; const ms = toMs(d); if (ms == null) return null;
    return Math.max(0, Math.min(100, ((ms - range.from) / (range.to - range.from)) * 100));
  };

  const monthTicks = useMemo(() => {
    if (!range) return [];
    const ticks: { pos: number; label: string }[] = [];
    const d = new Date(range.from); d.setDate(1); d.setHours(0, 0, 0, 0);
    let guard = 0;
    while (d.getTime() <= range.to && guard++ < 60) {
      const p = ((d.getTime() - range.from) / (range.to - range.from)) * 100;
      if (p >= 0 && p <= 100) ticks.push({ pos: p, label: `${d.getMonth() + 1}${t('canvas.tl.monthSuffix', { defaultValue: '월' })}` });
      d.setMonth(d.getMonth() + 1);
    }
    return ticks;
  }, [range, t]);

  const dated = data.tasks.filter((tk) => tk.due_date || tk.start_date);
  const milestones = dated.filter((tk) => tk.is_milestone);
  const regular = dated.filter((tk) => !tk.is_milestone);
  const undatedCount = data.tasks.length - dated.length;
  const todayPos = pos(data.today);

  const sc = data.progress.schedule_status;
  const scMeta = sc === 'ahead' ? { bg: '#DCFCE7', fg: '#15803D', key: 'ahead' }
    : sc === 'behind' ? { bg: '#FEE2E2', fg: '#B91C1C', key: 'behind' }
    : { bg: '#F0FDFA', fg: '#0F766E', key: 'ontrack' };

  return (
    <Card>
      {/* 진행 요약 */}
      <SummaryRow>
        <Big><BigVal>{data.progress.percent}</BigVal><Pct>%</Pct><BigLbl>{t('canvas.tl.progress', { defaultValue: '진행률' })}</BigLbl></Big>
        {sc && <SchedBadge style={{ background: scMeta.bg, color: scMeta.fg }}>
          {t(`canvas.tl.sched.${scMeta.key}`, { defaultValue: scMeta.key })}
          {data.progress.expected_percent != null && <SchedSub>{t('canvas.tl.expected', { defaultValue: '기대 {{n}}%', n: data.progress.expected_percent })}</SchedSub>}
        </SchedBadge>}
        {data.progress.d_day != null && <Chip>{data.progress.d_day >= 0 ? `D-${data.progress.d_day}` : `D+${-data.progress.d_day}`}</Chip>}
        {milestones.length > 0 && <Chip>{t('canvas.tl.milestonesN', { defaultValue: '주요 {{n}}', n: milestones.length })}</Chip>}
        <Spacer />
        {onToggleKeyOnly && (
          <Toggle type="button" role="switch" aria-checked={keyOnly} $on={keyOnly} onClick={() => onToggleKeyOnly(!keyOnly)}>
            <Knob $on={keyOnly} /><ToggleLbl>{t('canvas.tl.keyOnly', { defaultValue: '주요만 보기' })}</ToggleLbl>
          </Toggle>
        )}
      </SummaryRow>

      {!range || dated.length === 0 ? (
        <Empty>{t('canvas.tl.empty', { defaultValue: '일정(시작·마감)이 있는 업무가 없습니다' })}</Empty>
      ) : (
        <Track>
          {/* 월 눈금 */}
          {monthTicks.map((m, i) => <Grid key={i} style={{ left: `${m.pos}%` }}><GridLabel>{m.label}</GridLabel></Grid>)}
          {/* 마일스톤 레인 (상단) */}
          <MsLane>
            {milestones.map((tk) => {
              const p = pos(tk.due_date || tk.start_date); if (p == null) return null;
              const done = tk.status === 'completed';
              return (
                <Ms key={tk.id} type="button" aria-label={t('canvas.tl.milestoneOf', { defaultValue: '주요 업무: {{title}}', title: tk.title })} title={tk.title}
                  style={{ left: `${p}%` }} onClick={() => onTaskClick?.(tk.id)}>
                  <MsLabel>{tk.title}</MsLabel>
                  <Diamond style={{ background: done ? wsColor(tk.workstream_id) : '#fff', borderColor: wsColor(tk.workstream_id) }} />
                </Ms>
              );
            })}
          </MsLane>
          {/* 축 */}
          <Axis>
            {/* 진행 오버레이 (오늘까지) */}
            {todayPos != null && <AxisProgress style={{ width: `${todayPos}%` }} />}
            {/* 일반 업무 점/막대 */}
            {regular.map((tk) => {
              const dp = pos(tk.due_date || tk.start_date); if (dp == null) return null;
              const sp = tk.start_date && tk.due_date ? pos(tk.start_date) : null;
              const c = wsColor(tk.workstream_id);
              const done = tk.status === 'completed';
              return (
                <Fragment key={tk.id}>
                  {sp != null && dp > sp && <Bar style={{ left: `${sp}%`, width: `${dp - sp}%`, background: c, opacity: 0.35 }} />}
                  <Dot type="button" aria-label={tk.title} title={tk.title}
                    style={{ left: `${dp}%`, background: done ? c : '#fff', borderColor: c }}
                    onClick={() => onTaskClick?.(tk.id)} />
                </Fragment>
              );
            })}
            {/* 오늘 마커 */}
            {todayPos != null && <Today style={{ left: `${todayPos}%` }}><TodayLbl>{t('canvas.tl.now', { defaultValue: '지금' })}</TodayLbl></Today>}
          </Axis>
        </Track>
      )}

      {/* 범례 */}
      <Legend>
        {data.workstreams.map((w, i) => <LegendItem key={w.id}><LegendDot style={{ background: w.color || WORKSTREAM_PALETTE[(w.order_index ?? i) % WORKSTREAM_PALETTE.length] }} />{w.title}</LegendItem>)}
        {undatedCount > 0 && <LegendMuted>{t('canvas.tl.undated', { defaultValue: '미일정 {{n}}', n: undatedCount })}</LegendMuted>}
      </Legend>
    </Card>
  );
}

const Card = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:18px 20px;`;
const SummaryRow = styled.div`display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px;`;
const Big = styled.div`display:flex;align-items:baseline;gap:4px;`;
const BigVal = styled.span`font-size:28px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;`;
const Pct = styled.span`font-size:14px;font-weight:700;color:#64748B;`;
const BigLbl = styled.span`font-size:12px;color:#94A3B8;margin-left:6px;align-self:center;`;
const Chip = styled.span`font-size:12px;font-weight:700;color:#475569;background:#F1F5F9;border-radius:999px;padding:4px 11px;`;
const SchedBadge = styled.span`display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;border-radius:999px;padding:4px 12px;`;
const SchedSub = styled.span`font-weight:500;opacity:.8;`;
const Spacer = styled.div`flex:1;`;
const Toggle = styled.button<{ $on: boolean }>`display:inline-flex;align-items:center;gap:8px;border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};border-radius:999px;padding:5px 12px 5px 6px;cursor:pointer;`;
const Knob = styled.span<{ $on: boolean }>`width:30px;height:18px;border-radius:999px;background:${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};position:relative;transition:background .15s;&::after{content:'';position:absolute;top:2px;left:${(p) => (p.$on ? '14px' : '2px')};width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;}`;
const ToggleLbl = styled.span`font-size:12px;font-weight:600;color:#475569;`;
const Track = styled.div`position:relative;padding:34px 0 8px;`;
const Grid = styled.div`position:absolute;top:34px;bottom:8px;width:1px;background:#F1F5F9;`;
const GridLabel = styled.span`position:absolute;top:-16px;left:0;transform:translateX(-50%);font-size:10px;color:#94A3B8;white-space:nowrap;`;
const MsLane = styled.div`position:relative;height:0;`;
const Ms = styled.button`position:absolute;top:-28px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:3;background:none;border:none;padding:2px;font:inherit;border-radius:6px;&:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const MsLabel = styled.span`font-size:10px;font-weight:700;color:#0F172A;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;`;
const Diamond = styled.span`width:12px;height:12px;transform:rotate(45deg);border:2px solid;border-radius:2px;`;
const Axis = styled.div`position:relative;height:10px;background:#E2E8F0;border-radius:999px;`;
const AxisProgress = styled.div`position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,#99F6E4,#14B8A6);border-radius:999px;`;
const Bar = styled.div`position:absolute;top:3px;height:4px;border-radius:999px;`;
// 클릭 포인트 = 시맨틱 button (키보드 포커스·aria-label). ::after 로 터치 히트영역 확대(약 31px).
const Dot = styled.button`position:absolute;top:50%;transform:translate(-50%,-50%);width:11px;height:11px;padding:0;border:2px solid;border-radius:50%;z-index:2;cursor:pointer;
  &::after{content:'';position:absolute;inset:-10px;border-radius:50%;}
  &:hover{transform:translate(-50%,-50%) scale(1.25);}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;
const Today = styled.div`position:absolute;top:-30px;bottom:-6px;width:2px;background:#F43F5E;z-index:4;`;
const TodayLbl = styled.span`position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#F43F5E;background:#fff;padding:0 4px;white-space:nowrap;`;
const Empty = styled.div`font-size:13px;color:#94A3B8;padding:18px 0;text-align:center;`;
const Legend = styled.div`display:flex;flex-wrap:wrap;gap:12px;margin-top:18px;`;
const LegendItem = styled.span`display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#64748B;`;
const LegendDot = styled.span`width:9px;height:9px;border-radius:50%;`;
const LegendMuted = styled.span`font-size:11px;color:#CBD5E1;`;
