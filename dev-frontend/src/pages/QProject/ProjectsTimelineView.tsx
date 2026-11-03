// 프로젝트 목록 «타임라인» 보기 — QProjectPage 에서 뺐다(2026-11-03, god-file 래칫 — 실시간 반영을 붙이며 그 방이 나눴다).
//   내용·스타일은 한 글자도 바꾸지 않고 옮겼다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import HighlightText from '../../components/Common/HighlightText';
import { addDaysStr } from '../../utils/timezones';
import { colorForProject, lightenColor } from '../../utils/projectColors';
import { isEnterAction } from '../../utils/imeKey';
import type { ProjectWithStats } from './QProjectPage';

const TimelineView: React.FC<{
  projects: ProjectWithStats[];
  todayStr: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  onOpen: (projectId: number) => void;
  query?: string;
}> = ({ projects, todayStr, t, onOpen, query = '' }) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체 구간 계산: 프로젝트 + task 까지 포함
  const range = useMemo(() => {
    const dates: string[] = [];
    for (const p of projects) {
      if (p.start_date) dates.push(p.start_date.slice(0, 10));
      if (p.end_date) dates.push(p.end_date.slice(0, 10));
      for (const tk of p.tasks) {
        if (tk.start_date) dates.push(tk.start_date.slice(0, 10));
        if (tk.due_date) dates.push(tk.due_date.slice(0, 10));
      }
    }
    if (dates.length === 0) {
      return { from: addDaysStr(todayStr, -30), to: addDaysStr(todayStr, 60) };
    }
    return { from: dates.sort()[0], to: dates.sort()[dates.length - 1] };
  }, [projects, todayStr]);

  const totalDays = useMemo(() => {
    const a = new Date(range.from + 'T00:00:00Z').getTime();
    const b = new Date(range.to + 'T00:00:00Z').getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [range]);

  const dayPct = (dateStr: string) => {
    const a = new Date(range.from + 'T00:00:00Z').getTime();
    const d = new Date(dateStr + 'T00:00:00Z').getTime();
    return ((d - a) / 86400000 / totalDays) * 100;
  };

  // 월 단위 눈금 라벨 계산
  const monthTicks = useMemo(() => {
    const ticks: { date: string; label: string; leftPct: number }[] = [];
    const [fy, fm] = range.from.split('-').map(Number);
    // 첫 달 1일부터 마지막 날 포함까지 매월 1일 지점
    let cy = fy, cm = fm - 1; // 0-indexed
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(cy, cm, 1));
      const iso = d.toISOString().slice(0, 10);
      if (iso > range.to) break;
      if (iso >= range.from) {
        ticks.push({ date: iso, label: `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`, leftPct: dayPct(iso) });
      }
      cm += 1; if (cm > 11) { cm = 0; cy += 1; }
    }
    return ticks;
  }, [range]);

  const todayLeft = Math.min(100, Math.max(0, dayPct(todayStr)));

  return (
    <TimelineWrap>
      <TimelineHeader>
        <TimelineHeadLabel>{t('timeline.project')}</TimelineHeadLabel>
        <TimelineScale>
          {monthTicks.map((mt) => (
            <ScaleTick key={mt.date} style={{ left: `${mt.leftPct}%` }}>
              <ScaleTickBar />
              <ScaleTickLabel>{mt.label}</ScaleTickLabel>
            </ScaleTick>
          ))}
        </TimelineScale>
      </TimelineHeader>
      {projects.map((p) => {
        const start = p.start_date ? p.start_date.slice(0, 10) : range.from;
        const end = p.end_date ? p.end_date.slice(0, 10) : range.to;
        const left = Math.max(0, dayPct(start));
        const right = Math.min(100, dayPct(end));
        const width = Math.max(2, right - left);
        const color = colorForProject(p);
        const isExpanded = expanded.has(p.id);
        const hasTasksWithDates = p.tasks.some((tk) => tk.start_date || tk.due_date);
        return (
          <React.Fragment key={p.id}>
            <TimelineRow>
              <TimelineRowLabel>
                {hasTasksWithDates ? (
                  <ExpandBtn type="button" onClick={() => toggleExpand(p.id)}
                    aria-expanded={isExpanded} aria-label={isExpanded ? t('timeline.collapse') : t('timeline.expand')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </ExpandBtn>
                ) : (<ExpandSpacer />)}
                <ProjectNameBtn type="button" onClick={() => onOpen(p.id)}
                  onKeyDown={(e) => { if (isEnterAction(e)) onOpen(p.id); }}
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <strong><HighlightText text={p.name} query={query} /></strong>
                  <small>{p.progressPercent}%</small>
                </ProjectNameBtn>
              </TimelineRowLabel>
              <TimelineTrack>
                {monthTicks.map((mt) => (
                  <ScaleGridLine key={mt.date} style={{ left: `${mt.leftPct}%` }} />
                ))}
                <TodayMarker style={{ left: `${todayLeft}%` }} title={`${t('cal.today')} · ${todayStr}`} />
                <TimelineBar style={{ left: `${left}%`, width: `${width}%`, background: color }}
                  title={`${start} ~ ${end}`}>
                  <BarFill style={{ width: `${p.progressPercent}%` }} />
                </TimelineBar>
              </TimelineTrack>
            </TimelineRow>
            {/* Task 세부 행 — 프로젝트 펼쳐졌을 때만 */}
            {isExpanded && p.tasks.filter((tk) => tk.start_date || tk.due_date).map((tk) => {
              const ts = (tk.start_date || tk.due_date || '').slice(0, 10);
              const te = (tk.due_date || tk.start_date || '').slice(0, 10);
              const tl = Math.max(0, dayPct(ts));
              const tr2 = Math.min(100, dayPct(te));
              const tw = Math.max(1.5, tr2 - tl);
              return (
                <TimelineRow key={`t-${tk.id}`} $task>
                  <TimelineRowLabel>
                    <ExpandSpacer />
                    <TaskNameLabel style={{ borderLeft: `3px solid ${color}` }}>
                      <span>{tk.title}</span>
                      <small>{tk.progress_percent || 0}%</small>
                    </TaskNameLabel>
                  </TimelineRowLabel>
                  <TimelineTrack>
                    {monthTicks.map((mt) => (
                      <ScaleGridLine key={mt.date} style={{ left: `${mt.leftPct}%` }} />
                    ))}
                    <TodayMarker style={{ left: `${todayLeft}%` }} />
                    <TimelineTaskBar style={{
                      left: `${tl}%`, width: `${tw}%`,
                      background: lightenColor(color, 0.35),
                      border: `1px solid ${color}`,
                    }} title={`${tk.title} · ${ts} ~ ${te}`}>
                      <BarFill style={{ width: `${tk.progress_percent || 0}%`, background: color, opacity: 0.7 }} />
                    </TimelineTaskBar>
                  </TimelineTrack>
                </TimelineRow>
              );
            })}
          </React.Fragment>
        );
      })}
    </TimelineWrap>
  );
};

// ─── Calendar View (월별 마감일) ───

export default TimelineView;

const TimelineWrap = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px;`;
const TimelineHeader = styled.div`
  display: grid; grid-template-columns: 200px 1fr; gap: 12px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #E2E8F0;
  @media (max-width: 768px) { grid-template-columns: 120px 1fr; gap: 8px; }
`;
const TimelineHeadLabel = styled.div`font-size: 0.75rem; color: #64748B; font-weight: 600;`;
const TimelineScale = styled.div`position: relative; height: 20px;`;
const ScaleTick = styled.div`position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px;`;
const ScaleTickBar = styled.div`width: 1px; height: 6px; background: #CBD5E1;`;
const ScaleTickLabel = styled.div`font-size: 0.6875rem; color: #64748B; white-space: nowrap;`;
const ScaleGridLine = styled.div`position: absolute; top: 0; bottom: 0; width: 1px; background: #F1F5F9; z-index: 0;`;
const TimelineRow = styled.div<{ $task?: boolean }>`
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  padding: ${(p) => p.$task ? '6px 0' : '10px 0'};
  align-items: center;
  ${(p) => p.$task && 'background: #FBFCFD;'}
  @media (max-width: 768px) { grid-template-columns: 120px 1fr; gap: 8px; }
`;
const TimelineRowLabel = styled.div`display: flex; align-items: center; gap: 4px; font-size: 0.8125rem; color: #0F172A;`;
const ExpandBtn = styled.button`
  flex: 0 0 auto;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #64748B; border-radius: 4px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.3); }
`;
const ExpandSpacer = styled.span`flex: 0 0 auto; width: 20px; height: 20px; display: inline-block;`;
const ProjectNameBtn = styled.button`
  flex: 1 1 auto;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  font: inherit;
  color: #0F172A;
  text-align: left;
  cursor: pointer;
  border-radius: 0 4px 4px 0;
  transition: background 0.15s;
  strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: #64748B; font-size: 0.6875rem; flex-shrink: 0; }
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: none; background: #F0FDFA; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.25); }
`;
const TaskNameLabel = styled.div`
  flex: 1 1 auto;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 2px 8px;
  border-left: 3px solid transparent;
  color: #475569;
  font-size: 0.75rem;
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: #94A3B8; font-size: 0.625rem; flex-shrink: 0; }
`;
const TimelineTrack = styled.div`position: relative; height: 24px; background: #F8FAFC; border-radius: 4px; overflow: hidden;`;
const TodayMarker = styled.div`position: absolute; top: 0; bottom: 0; width: 2px; background: #F43F5E; z-index: 2; cursor: help;`;
const TimelineBar = styled.div`position: absolute; top: 4px; bottom: 4px; border-radius: 4px; overflow: hidden; opacity: 0.92; z-index: 1;`;
const TimelineTaskBar = styled.div`position: absolute; top: 6px; bottom: 6px; border-radius: 3px; overflow: hidden; z-index: 1;`;
const BarFill = styled.div`height: 100%; background: rgba(255,255,255,0.45);`;
