import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface CalendarPickerProps {
  startDate?: string;
  endDate?: string;
  onRangeSelect: (start: string, end: string) => void;
  onClose: () => void;
  isOpen: boolean;
  singleMode?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const formatDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseDate = (s: string): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const isBetween = (date: Date, start: Date, end: Date): boolean => {
  const t = date.getTime();
  return t > start.getTime() && t < end.getTime();
};

const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();
const getMonthLabel = (y: number, m: number) => `${y}년 ${m + 1}월`;

const CalendarPicker: React.FC<CalendarPickerProps> = ({
  startDate, endDate, onRangeSelect, onClose, isOpen, singleMode = false, anchorRef,
}) => {
  const { t } = useTranslation('common');
  const [pos, setPos] = useState<{top:number;left:number}>({top:-9999,left:-9999});
  useEffect(() => {
    if (!isOpen || !anchorRef?.current) return;
    // 렌더 후 측정 필요 — 다음 프레임에 위치 조정
    const adjust = () => {
      if (!wrapperRef.current || !anchorRef.current) return;
      const a = anchorRef.current.getBoundingClientRect();
      const w = wrapperRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      let top = a.bottom + 4;
      let left = a.left;
      // 우측 넘침 → 앵커 우측 기준으로 왼쪽으로 열기
      if (left + w.width > vw - margin) left = Math.max(margin, a.right - w.width);
      if (left < margin) left = margin;
      // 하단 넘침 → 위로 열기
      if (top + w.height > vh - margin) top = Math.max(margin, a.top - w.height - 4);
      setPos({ top, left });
    };
    // 첫 렌더 후 바로 측정
    const raf = requestAnimationFrame(adjust);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, anchorRef]);
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [step, setStep] = useState<'start' | 'end'>('start');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (startDate) setRangeStart(parseDate(startDate));
    if (endDate) setRangeEnd(parseDate(endDate));
  }, [startDate, endDate]);

  useEffect(() => {
    if (isOpen) setStep('start');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // 열린 후 다음 틱에 리스너 등록 (현재 클릭 이벤트로 즉시 닫히지 않게)
    const timer = setTimeout(() => {
      const onClick = (e: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener('mousedown', onClick);
      (wrapperRef.current as unknown as { _cleanup?: () => void })._cleanup = () => document.removeEventListener('mousedown', onClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      const w = wrapperRef.current as unknown as { _cleanup?: () => void };
      if (w?._cleanup) w._cleanup();
    };
  }, [isOpen, onClose]);

  const handlePrevMonth = useCallback(() => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }, [viewMonth]);
  const handleNextMonth = useCallback(() => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }, [viewMonth]);

  const handleDayClick = (date: Date) => {
    if (singleMode) {
      setRangeStart(date); setRangeEnd(date);
      onRangeSelect(formatDate(date), formatDate(date));
      setTimeout(onClose, 150);
      return;
    }
    if (step === 'start') {
      setRangeStart(date); setRangeEnd(null); setStep('end');
    } else {
      let s = rangeStart!, e = date;
      if (e < s) [s, e] = [e, s];
      setRangeStart(s); setRangeEnd(e); setStep('start');
      onRangeSelect(formatDate(s), formatDate(e));
      setTimeout(onClose, 200);
    }
  };

  const getDayState = (date: Date) => {
    const isStart = rangeStart && isSameDay(date, rangeStart);
    const isEnd = rangeEnd && isSameDay(date, rangeEnd);
    const effEnd = step === 'end' && hoverDate ? hoverDate : rangeEnd;
    let isInRange = false;
    if (rangeStart && effEnd) {
      const [s, e] = rangeStart <= effEnd ? [rangeStart, effEnd] : [effEnd, rangeStart];
      isInRange = isBetween(date, s, e);
    }
    const isHoverEnd = step === 'end' && hoverDate && isSameDay(date, hoverDate);
    return { isStart, isEnd, isInRange, isHoverEnd };
  };

  const renderMonth = (y: number, m: number) => {
    const days: (Date | null)[] = [];
    const firstDay = getFirstDayOfMonth(y, m);
    const daysIn = getDaysInMonth(y, m);
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysIn; d++) days.push(new Date(y, m, d));
    return (
      <MonthBox>
        <MonthLabel>{getMonthLabel(y, m)}</MonthLabel>
        <WeekdayRow>{WEEKDAYS.map(w => <Weekday key={w}>{w}</Weekday>)}</WeekdayRow>
        <DaysGrid>
          {days.map((date, i) => {
            if (!date) return <EmptyCell key={`e-${i}`} />;
            const { isStart, isEnd, isInRange, isHoverEnd } = getDayState(date);
            const isToday = isSameDay(date, today);
            return (
              <DayCell key={date.getTime()}
                $isStart={!!isStart} $isEnd={!!isEnd} $isInRange={isInRange}
                $isHoverEnd={!!isHoverEnd} $isToday={isToday}
                onClick={() => handleDayClick(date)}
                onMouseEnter={() => setHoverDate(date)}
                onMouseLeave={() => setHoverDate(null)}>
                {date.getDate()}
              </DayCell>
            );
          })}
        </DaysGrid>
      </MonthBox>
    );
  };

  const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  const handlePreset = (preset: string) => {
    const now = new Date();
    let start: Date; let end = now;
    if (preset === 'this_week') {
      start = new Date(now); start.setDate(now.getDate() - now.getDay() + 1);
    } else if (preset === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'today') {
      start = now;
    } else return;
    setRangeStart(start); setRangeEnd(end); setStep('start');
    onRangeSelect(formatDate(start), formatDate(end));
    setTimeout(onClose, 150);
  };

  const handleClear = () => {
    setRangeStart(null); setRangeEnd(null);
    onRangeSelect('', '');
    setTimeout(onClose, 100);
  };

  if (!isOpen) return null;

  return createPortal((
    <Wrapper ref={wrapperRef} style={{ top: pos.top, left: pos.left }}>
      <Layout>
        {!singleMode && (
          <Sidebar>
            <SidebarBtn onClick={() => handlePreset('today')}>{t('calendar.today')}</SidebarBtn>
            <SidebarBtn onClick={() => handlePreset('this_week')}>{t('calendar.thisWeek')}</SidebarBtn>
            <SidebarBtn onClick={() => handlePreset('this_month')}>{t('calendar.thisMonth')}</SidebarBtn>
            <SidebarBtn onClick={handleClear} $danger>{t('calendar.clear')}</SidebarBtn>
          </Sidebar>
        )}
        <CalSection>
          <CalHeader>
            <NavBtn onClick={handlePrevMonth}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg></NavBtn>
            <NavBtn onClick={handleNextMonth}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18"/></svg></NavBtn>
          </CalHeader>
          <CalBody>
            {renderMonth(viewYear, viewMonth)}
            {!singleMode && <SecondMonth>{renderMonth(nextYear, nextMonth)}</SecondMonth>}
          </CalBody>
          {singleMode && (
            <SingleFooter><SidebarBtn onClick={handleClear} $danger>{t('calendar.clear')}</SidebarBtn></SingleFooter>
          )}
        </CalSection>
      </Layout>
    </Wrapper>
  ), document.body);
};

export default CalendarPicker;

const Wrapper = styled.div`
  position:fixed;z-index:3000;background:#FFF;
  border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);
  padding:16px 20px;animation:fadeIn 0.15s ease-out;
  @keyframes fadeIn{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}
`;
const Layout = styled.div`display:flex;gap:0;`;
const Sidebar = styled.div`display:flex;flex-direction:column;gap:2px;padding-right:16px;margin-right:16px;border-right:1px solid #E2E8F0;min-width:90px;`;
const SidebarBtn = styled.button<{$danger?:boolean}>`
  padding:7px 10px;text-align:left;background:transparent;border:none;border-radius:6px;
  font-size:12px;font-weight:500;cursor:pointer;color:${p=>p.$danger?'#DC2626':'#374151'};
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F1F5F9'};}
`;
const SingleFooter = styled.div`margin-top:8px;padding-top:8px;border-top:1px solid #F1F5F9;`;
const CalSection = styled.div``;
const CalHeader = styled.div`display:flex;justify-content:space-between;margin-bottom:4px;`;
const NavBtn = styled.button`display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:#64748B;cursor:pointer;&:hover{background:#F1F5F9;}`;
const CalBody = styled.div`display:flex;gap:24px;`;
const SecondMonth = styled.div``;
const MonthBox = styled.div`width:220px;`;
const MonthLabel = styled.div`text-align:center;font-size:13px;font-weight:700;color:#0F172A;margin-bottom:10px;`;
const WeekdayRow = styled.div`display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px;`;
const Weekday = styled.div`text-align:center;font-size:11px;color:#94A3B8;font-weight:600;height:24px;line-height:24px;`;
const DaysGrid = styled.div`display:grid;grid-template-columns:repeat(7,1fr);`;
const EmptyCell = styled.div`aspect-ratio:1;min-width:30px;`;
const DayCell = styled.div<{$isStart:boolean;$isEnd:boolean;$isInRange:boolean;$isHoverEnd:boolean;$isToday:boolean}>`
  aspect-ratio:1;min-width:30px;display:flex;align-items:center;justify-content:center;
  font-size:12px;cursor:pointer;border-radius:50%;transition:background 0.12s,color 0.12s;position:relative;user-select:none;
  color:${p=>(p.$isStart||p.$isEnd)?'#FFF':p.$isInRange?'#0F766E':'#374151'};
  background:${p=>(p.$isStart||p.$isEnd)?'#14B8A6':p.$isInRange?'#F0FDFA':'transparent'};
  font-weight:${p=>(p.$isStart||p.$isEnd||p.$isToday)?700:500};
  ${p=>p.$isToday&&!p.$isStart&&!p.$isEnd&&`&::after{content:'';position:absolute;bottom:3px;width:3px;height:3px;border-radius:50%;background:#14B8A6;}`}
  ${p=>p.$isHoverEnd&&!p.$isStart&&!p.$isEnd&&`background:#CCFBF1;color:#0F766E;`}
  &:hover{${p=>!p.$isStart&&!p.$isEnd&&`background:${p.$isInRange?'#CCFBF1':'#F1F5F9'};`}}
`;
