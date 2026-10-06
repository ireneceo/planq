// 설정 > 근태 관리 — 「휴일·근무일」 섹션 (#424). 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §4.1
//
// 여기서 정한 휴일이 **가용시간(Q task)·주간/단위 보고서·휴가 차감일·상담 예약 슬롯** 네 곳에 같이 반영된다.
//   계산은 서버 services/workspaceHolidays 한 벌이고, 이 화면은 그 행을 보여주고 고치기만 한다.
// ★ 국가 공휴일은 지우지 않고 끈다(서버가 삭제를 400 으로 막는다 — 다시 채울 때 되살아나지 않게).
// ★ 근무 요일이 아닌 날(기본 토·일)에 떨어진 휴일은 숫자를 바꾸지 않는다 — 그 이유를 행이 말한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { formatDay } from '../../utils/dateFormat';

interface HolidayRow {
  id: number; date: string; name: string; name_en: string | null;
  source: 'national' | 'custom'; is_off: boolean; on_workday: boolean;
}
interface HolidayData {
  year: number; country: string | null; supported_countries: string[];
  work_weekdays: number[]; can_edit: boolean; holidays: HolidayRow[];
}

export default function HolidaySettingsSection({ businessId }: { businessId: number }) {
  const { t, i18n } = useTranslation('settings');
  const thisYear = new Date().getFullYear();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<HolidayData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const dataRef = useRef<HolidayData | null>(null);
  dataRef.current = data;

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/holidays?year=${year}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setLoadErr(true); return; }
    setLoadErr(false);
    setData(j.data as HolidayData);
  }, [businessId, year]);

  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    const room = `business:${businessId}`;
    joinRoom(room);
    let timer: number | null = null;
    const off = onSocket('holiday:updated', () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    });
    return () => { if (timer) window.clearTimeout(timer); off(); leaveRoom(room); };
  }, [businessId, load]);

  // ─── 국가 — 고르면 화면만 바꾸고(stage), 래퍼가 저장한다(persist) ───
  const [country, setCountry] = useState<string>('');
  useEffect(() => { setCountry(data?.country || ''); }, [data?.country]);
  const countryRef = useRef(country);
  countryRef.current = country;
  const persistCountry = async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/holiday-country`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: countryRef.current || null }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setCountry(dataRef.current?.country || ''); throw new Error(j?.message || 'save_failed'); }
    await load();
  };

  // ─── 켜기/끄기 ───
  const flip = (id: number) => setData((d) => d && ({ ...d, holidays: d.holidays.map((h) => h.id === id ? { ...h, is_off: !h.is_off } : h) }));
  const persistToggle = async (id: number) => {
    const row = dataRef.current?.holidays.find((h) => h.id === id);
    if (!row) return;
    const r = await apiFetch(`/api/businesses/${businessId}/holidays/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_off: row.is_off }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { flip(id); throw new Error(j?.message || 'save_failed'); }
  };

  // ─── 직접 추가 ───
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitAdd = async () => {
    if (submitting || !newDate || !newName.trim()) return;
    setSubmitting(true); setAddErr(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/holidays`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate, name: newName.trim() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setAddErr(r.status === 409 ? 'duplicate' : 'generic');
        return;
      }
      setNewDate(''); setNewName(''); setAdding(false);
      if (Number(newDate.slice(0, 4)) !== year) setYear(Number(newDate.slice(0, 4)));
      else await load();
    } finally { setSubmitting(false); }
  };
  const remove = async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/holidays/${id}`, { method: 'DELETE' });
    if (r.ok) await load();
  };

  if (loadErr && !data) return <Section><Hint>{t('holidays.loadError', '휴일을 불러오지 못했습니다.') as string}</Hint></Section>;
  if (!data) return null;

  const canEdit = data.can_edit;
  const nameOf = (h: HolidayRow) => (i18n.language?.startsWith('en') && h.name_en) ? h.name_en : h.name;
  const past = data.holidays.filter((h) => h.date < today);
  const upcoming = data.holidays.filter((h) => h.date >= today);
  // 올해만 지난 휴일을 접는다 — 다른 해는 통째로 보여준다.
  const visible = year === thisYear && !showPast ? upcoming : data.holidays;
  const countryOpts = [
    { value: '', label: t('holidays.countryNone', '사용 안 함') as string },
    // 대한민국을 맨 위에, 나머지는 화면 언어의 이름순.
    ...data.supported_countries
      .map((c) => ({ value: c, label: t(`holidays.country${c}`, c) as string }))
      .sort((a, b) => (a.value === 'KR' ? -1 : b.value === 'KR' ? 1 : a.label.localeCompare(b.label, i18n.language))),
  ];

  return (
    <Section data-testid="holiday-section">
      <Head>
        <Title>{t('holidays.title', '휴일·근무일') as string}</Title>
      </Head>
      <Hint>{t('holidays.desc', '근무 요일(기본 월~금)에 해당하는 휴일만 가용시간·휴가 차감일에서 빠지고, 그날은 상담 예약을 받지 않습니다. 개인 휴가는 근태 > 휴가에서 신청합니다.') as string}</Hint>

      <CountryRow>
        <Label>{t('holidays.country', '국가 공휴일') as string}</Label>
        <CountrySlot data-testid="holiday-country">
          <AutoSaveField key={`country-${businessId}`} type="select" onSave={persistCountry}>
            <PlanQSelect
              size="sm"
              isDisabled={!canEdit}
              options={countryOpts}
              value={countryOpts.find((o) => o.value === country) || countryOpts[0]}
              onChange={(o) => setCountry(((o as { value: string } | null)?.value) || '')}
            />
          </AutoSaveField>
        </CountrySlot>
      </CountryRow>
      {!canEdit && <Hint>{t('holidays.readOnly', '워크스페이스 관리자만 변경할 수 있습니다.') as string}</Hint>}

      <Toolbar>
        <YearNav>
          <NavBtn type="button" aria-label={t('holidays.prevYear', '이전 해') as string} onClick={() => setYear((y) => y - 1)}>‹</NavBtn>
          <YearLabel>{year}</YearLabel>
          <NavBtn type="button" aria-label={t('holidays.nextYear', '다음 해') as string} onClick={() => setYear((y) => y + 1)}>›</NavBtn>
        </YearNav>
        {canEdit && !adding && (
          // autosave-exempt: 추가는 액션이다(입력을 다 채우고 누른다)
          <ActionButton size="sm" tone="secondary" data-testid="holiday-add-open" onClick={() => { setAdding(true); setAddErr(null); }}>
            + {t('holidays.add', '휴일 추가') as string}
          </ActionButton>
        )}
      </Toolbar>

      {adding && (
        <AddRow>
          <SingleDateField value={newDate} onChange={setNewDate} placeholder={t('holidays.col.date', '날짜') as string} />
          <NameInput
            value={newName} maxLength={100}
            placeholder={t('holidays.namePlaceholder', '이름 (예: 창립기념일)') as string}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitAdd(); }}
          />
          <ActionButton size="sm" tone="primary" data-testid="holiday-add-submit"
            disabled={submitting || !newDate || !newName.trim()} onClick={() => void submitAdd()}>
            {t('holidays.addSubmit', '추가') as string}
          </ActionButton>
          <ActionButton size="sm" tone="secondary" onClick={() => { setAdding(false); setAddErr(null); }}>
            {t('holidays.cancel', '취소') as string}
          </ActionButton>
          {addErr && <ErrText>{addErr === 'duplicate'
            ? t('holidays.duplicate', '이미 있는 날짜입니다') as string
            : t('holidays.addError', '추가하지 못했습니다. 다시 시도하세요.') as string}</ErrText>}
        </AddRow>
      )}

      {past.length > 0 && year === thisYear && (
        <PastToggle type="button" onClick={() => setShowPast((v) => !v)}>
          {showPast
            ? t('holidays.hidePast', '지난 휴일 접기') as string
            : t('holidays.showPast', { count: past.length, defaultValue: '지난 휴일 보기 ({{count}})' }) as string}
        </PastToggle>
      )}

      {visible.length === 0 ? (
        <Empty>{data.country || data.holidays.length
          ? t('holidays.emptyYear', '이 해에 표시할 휴일이 없습니다.') as string
          : t('holidays.emptyOff', '국가 공휴일을 켜거나 휴일을 직접 추가하세요.') as string}</Empty>
      ) : (
        <List>
          {visible.map((h) => (
            <Row key={h.id} data-testid={`holiday-row-${h.date}`} $muted={!h.on_workday || !h.is_off}>
              <DateCell>{formatDay(h.date, { weekday: true, year: 'always' })}</DateCell>
              <NameCell>
                <span>{nameOf(h)}</span>
                <Badge $custom={h.source === 'custom'}>
                  {h.source === 'custom' ? t('holidays.source.custom', '직접') as string : t('holidays.source.national', '공휴일') as string}
                </Badge>
                {!h.on_workday && <Note>{t('holidays.notWorkday', '근무 요일 아님 — 반영 없음') as string}</Note>}
              </NameCell>
              <Actions>
                <AutoSaveField key={`hol-${h.id}`} type="toggle" onSave={() => persistToggle(h.id)}>
                  <Switch
                    type="button" role="switch" aria-checked={h.is_off} $on={h.is_off}
                    aria-label={t('holidays.col.off', '휴무') as string}
                    data-testid={`holiday-toggle-${h.date}`}
                    disabled={!canEdit}
                    onClick={() => flip(h.id)}
                  >
                    <SwitchKnob $on={h.is_off} />
                  </Switch>
                </AutoSaveField>
                {canEdit && h.source === 'custom' && (
                  // autosave-exempt: 삭제는 액션이다
                  <DelBtn type="button" data-testid={`holiday-delete-${h.date}`}
                    aria-label={t('holidays.delete', '삭제') as string} title={t('holidays.delete', '삭제') as string}
                    onClick={() => void remove(h.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </DelBtn>
                )}
              </Actions>
            </Row>
          ))}
        </List>
      )}
    </Section>
  );
}

const Section = styled.section`
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; margin-bottom: 20px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
`;
const Head = styled.div` display: flex; align-items: center; justify-content: space-between; `;
const Title = styled.h3` margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A; `;
const Hint = styled.p` margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5; `;
const CountryRow = styled.div` display: flex; align-items: center; gap: 12px; flex-wrap: wrap; `;
const Label = styled.span` font-size: 0.8125rem; font-weight: 600; color: #334155; `;
const CountrySlot = styled.div` width: 200px; max-width: 100%; `;
const Toolbar = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; `;
const YearNav = styled.div` display: flex; align-items: center; gap: 4px; `;
const NavBtn = styled.button`
  width: 36px; height: 36px; border-radius: 8px; border: 1px solid #E2E8F0; background: #fff;
  color: #334155; font-size: 1.125rem; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const YearLabel = styled.span` min-width: 48px; text-align: center; font-weight: 700; color: #0F172A; `;
const AddRow = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; `;
const NameInput = styled.input`
  flex: 1 1 180px; min-width: 0; height: 36px; padding: 0 10px;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.875rem;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const ErrText = styled.span` flex-basis: 100%; font-size: 0.75rem; color: #DC2626; `;
const PastToggle = styled.button`
  align-self: flex-start; border: none; background: none; padding: 4px 0;
  font-size: 0.8125rem; color: #0F766E; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const Empty = styled.div` padding: 16px 0; font-size: 0.8125rem; color: #94A3B8; `;
const List = styled.ul` list-style: none; margin: 0; padding: 0; border-top: 1px solid #F1F5F9; `;
const Row = styled.li<{ $muted: boolean }>`
  display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 0;
  border-bottom: 1px solid #F1F5F9;
  color: ${(p) => (p.$muted ? '#94A3B8' : '#0F172A')};
`;
const DateCell = styled.span` flex: 0 0 auto; min-width: 120px; font-size: 0.8125rem; font-variant-numeric: tabular-nums; `;
const NameCell = styled.span`
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 0.875rem;
`;
const Badge = styled.span<{ $custom: boolean }>`
  font-size: 0.6875rem; padding: 2px 6px; border-radius: 6px;
  background: ${(p) => (p.$custom ? '#F0FDFA' : '#F1F5F9')};
  color: ${(p) => (p.$custom ? '#0F766E' : '#64748B')};
`;
const Note = styled.span` font-size: 0.75rem; color: #94A3B8; `;
const Actions = styled.span` flex: 0 0 auto; display: flex; align-items: center; gap: 4px; `;
const DelBtn = styled.button`
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px; color: #94A3B8; cursor: pointer;
  &:hover { background: #FEF2F2; color: #DC2626; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
