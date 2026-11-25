// WorkspacePageSettings — 설정 › «공개 페이지» 탭 (2026-11-20)
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §4 · §7 ② (Irene «권고대로»)
//   자리: 권한 탭 안 «고객 창구» 카드가 찾기 어려웠다(Irene «어디에서 링크 바로 알게») → 설정의 독립 탭.
//
// ★ 데이터는 GET/PUT `/api/businesses/:id/customer-entry` 한 문 — 모양은 서버 `services/workspacePage.js` 한 곳.
//   미리 보기도 서버가 준 `preview`(= 고객이 받는 `publicView` 그대로)를 `EntryInfoView` 로 그린다.
//   화면이 따로 조립하면 «미리 보기엔 보이는데 고객 화면엔 없음» 이 생긴다.
// ★ 저장은 칸마다 **자기 키만** 보낸다(PUT 이 보낸 칸만 바꾼다). 최신값은 ref 로 읽는다(자동저장 절).
// ★ 고치는 사람은 오너·플랫폼 관리자(서버 assertEntryAdmin 과 같은 술어). 멤버는 보기·주소 복사.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';
import StandardModal from '../Common/StandardModal';
import { Switch, SwitchKnob } from '../Common/switchShell';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import CustomerEntrySection from '../Permissions/CustomerEntrySection';
import PublicListingCard, { type CriteriaGoKey } from './PublicListingCard';
import EntryInfoView from '../../pages/Guest/EntryInfoView';
import type { EntryInfo } from '../../pages/Guest/GuestWorkspacePage';
import { formatWorkHours, type WorkHours } from '../../utils/workHoursText';

interface Props { businessId: number; isOwner: boolean; }

type Service = {
  id: string; name: string; name_en: string; summary: string; summary_en: string;
  price_text: string; price_text_en: string; image_url: string;
};
type Extra = { label: string; label_en: string; value: string; value_en: string };
type Form = { enabled: boolean; ask_phone: boolean; ask_company: boolean };
type Entry = { intro: string; intro_en: string; hidden: string[]; services: Service[]; extras: Extra[]; form: Form };
type Auto = Record<string, string | WorkHours | null>;

const SERVICE_MAX = 12;
const EXTRA_MAX = 8;
const emptyService = (): Service => ({ id: '', name: '', name_en: '', summary: '', summary_en: '', price_text: '', price_text_en: '', image_url: '' });

export default function WorkspacePageSettings({ businessId, isOwner }: Props) {
  const { t } = useTranslation('settings');
  const { t: tg } = useTranslation('guest');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry>({ intro: '', intro_en: '', hidden: [], services: [], extras: [], form: { enabled: true, ask_phone: false, ask_company: false } });
  const [auto, setAuto] = useState<Auto>({});
  const [autoKeys, setAutoKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<EntryInfo | null>(null);
  const [introLang, setIntroLang] = useState<'ko' | 'en'>('ko');
  const [editing, setEditing] = useState<{ index: number; svc: Service } | null>(null);
  const [askDelete, setAskDelete] = useState<number | null>(null);
  const [svcErr, setSvcErr] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [listingReload, setListingReload] = useState(0);
  /** 공개 카드의 ✗ 기준을 누르면 — 같은 화면의 그 칸으로 스크롤하고 손댈 곳에 포커스 */
  const goToCriteria = useCallback((key: CriteriaGoKey) => {
    const [box, focus] = key === 'intro' ? ['wspage-intro-text', 'wspage-intro-text']
      : key === 'services' ? ['wspage-services', 'wspage-service-add']
        : ['wspage-form', 'wspage-form-toggle-enabled'];
    document.querySelector(`[data-testid="${box}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (document.querySelector(`[data-testid="${focus}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);

  const entryRef = useRef(entry);
  entryRef.current = entry;
  const extrasSaveRef = useRef<AutoSaveHandle>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setLoadErr(j?.message || `error_${r.status}`); return; }
      const ce = j.data.customer_entry || {};
      setEntry({
        intro: ce.intro || '', intro_en: ce.intro_en || '',
        hidden: Array.isArray(ce.hidden) ? ce.hidden : [],
        services: Array.isArray(ce.services) ? ce.services : [],
        extras: Array.isArray(ce.extras) ? ce.extras : [],
        form: { enabled: ce.form?.enabled !== false, ask_phone: !!ce.form?.ask_phone, ask_company: !!ce.form?.ask_company },
      });
      setAuto(j.data.auto || {});
      setAutoKeys(Array.isArray(j.data.auto_keys) ? j.data.auto_keys : []);
      setPreview(j.data.preview || null);
      setLoadErr(null);
    } catch (e) { setLoadErr((e as Error).message); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  /** 보낸 칸만 저장 — **던진다**(삼키면 «!» 배지가 안 뜬다). 서버가 정규화한 값·미리 보기로 화면을 맞춘다. */
  const save = useCallback(async (patch: Partial<Entry>) => {
    const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
    if (j.data?.preview) setPreview(j.data.preview);
    setListingReload((n) => n + 1); // 소개글·서비스·문의 폼이 바뀌면 공개 기준(✓/✗)을 다시 받는다
    return j.data?.customer_entry as Entry | undefined;
  }, [businessId]);

  const saveHidden = useCallback(async () => { await save({ hidden: entryRef.current.hidden }); }, [save]);
  const saveForm = useCallback(async () => { await save({ form: entryRef.current.form }); }, [save]);
  const flipForm = (k: keyof Form) => setEntry((p) => ({ ...p, form: { ...p.form, [k]: !p.form[k] } }));
  const saveIntro = useCallback(async () => {
    await save({ intro: entryRef.current.intro, intro_en: entryRef.current.intro_en });
  }, [save]);
  const saveExtras = useCallback(async () => {
    // 빈 줄은 서버가 버린다 — 화면은 쓰던 줄을 들고 있는다(지우지 않는다).
    await save({ extras: entryRef.current.extras });
  }, [save]);
  /** 서비스는 목록 통째로 — 서버가 id 를 붙여 돌려준 것으로 화면을 맞춘다(새 카드의 id). */
  const saveServices = useCallback(async (list: Service[]) => {
    const saved = await save({ services: list });
    if (saved?.services) setEntry((p) => ({ ...p, services: saved.services }));
  }, [save]);

  const toggleHidden = (k: string) => setEntry((p) => ({
    ...p, hidden: p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k],
  }));

  const setExtra = (i: number, patch: Partial<Extra>) => {
    setEntry((p) => {
      const next = [...p.extras];
      next[i] = { ...next[i], ...patch };
      return { ...p, extras: next };
    });
    extrasSaveRef.current?.triggerSave();
  };
  const addExtra = () => setEntry((p) => (p.extras.length >= EXTRA_MAX ? p
    : { ...p, extras: [...p.extras, { label: '', label_en: '', value: '', value_en: '' }] }));
  const removeExtra = (i: number) => {
    setEntry((p) => ({ ...p, extras: p.extras.filter((_, j) => j !== i) }));
    extrasSaveRef.current?.triggerSave();
  };

  // ── 서비스 카드 편집 창 ──
  // autosave-exempt: 카드 하나를 여러 칸(이름·설명·가격·사진·영어)으로 쓰는 편집 창 — [저장] 을 눌러야 카드가 된다(이름 없는 빈 카드가 목록에 생기지 않게)
  const commitService = async () => {
    if (!editing) return;
    const svc = { ...editing.svc, name: editing.svc.name.trim() };
    if (!svc.name) { setSvcErr(t('wspage.svcNameRequired', '서비스 이름을 적어 주세요.') as string); return; }
    const list = [...entryRef.current.services];
    if (editing.index < 0) list.push(svc); else list[editing.index] = svc;
    try { await saveServices(list); setEditing(null); setSvcErr(null); }
    catch (e) { setSvcErr((e as Error).message); }
  };
  const [uploading, setUploading] = useState(false);
  const uploadImage = async (file: File) => {
    if (!editing) return;
    setUploading(true); setSvcErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry/service-image`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.message || `upload_failed_${r.status}`);
      setEditing((p) => (p ? { ...p, svc: { ...p.svc, image_url: j.data.url } } : p));
    } catch (e) {
      const m = (e as Error).message;
      setSvcErr(t(`wspage.err.${m}`, m) as string);
    } finally { setUploading(false); }
  };
  const removeService = async (i: number) => {
    const list = entryRef.current.services.filter((_, j) => j !== i);
    setEntry((p) => ({ ...p, services: list }));
    try { await saveServices(list); } catch { void load(); }
  };
  const moveService = async (from: number, to: number) => {
    if (from === to || to < 0) return;
    const list = [...entryRef.current.services];
    const [m] = list.splice(from, 1);
    list.splice(to, 0, m);
    setEntry((p) => ({ ...p, services: list }));
    try { await saveServices(list); } catch { void load(); }
  };

  if (loading) return <Card><Muted>{t('entry.loading', '불러오는 중…')}</Muted></Card>;
  if (loadErr) return <Card><Warn>{t('wspage.loadErr', '공개 페이지 설정을 불러오지 못했습니다.')} ({loadErr})</Warn></Card>;

  const autoLabel = (k: string) => {
    switch (k) {
      case 'tagline': return t('wspage.auto.tagline', '한 줄 소개');
      case 'website': return tg('entry.website', { defaultValue: '홈페이지' });
      case 'phone': return tg('entry.phone', { defaultValue: '전화' });
      case 'email': return tg('entry.email', { defaultValue: '이메일' });
      case 'address': return tg('entry.address', { defaultValue: '주소' });
      case 'work_hours': return tg('entry.workHours', { defaultValue: '근무시간' });
      case 'representative': return tg('entry.representative', { defaultValue: '대표자' });
      case 'biz_type': return tg('entry.bizType', { defaultValue: '업태·종목' });
      default: return k;
    }
  };
  const autoValue = (k: string): string => {
    const v = auto[k];
    if (k === 'work_hours') return v && typeof v === 'object' ? (formatWorkHours(v as WorkHours, tg) || '') : '';
    return typeof v === 'string' ? v : '';
  };

  return (
    <Layout data-testid="wspage-settings">
      <EditCol>
        <CustomerEntrySection businessId={businessId} isOwner={isOwner} />

        {/* 공개(회사 찾기·검색) — 확인 창에 «누구나 보게 되는 항목» 을 적는다(지금 보임으로 켜 둔 것만) */}
        <PublicListingCard businessId={businessId} isOwner={isOwner} reloadKey={listingReload} onGoTo={goToCriteria}
          shownItems={[
            t('wspage.auto.name', '회사 이름·로고') as string,
            ...autoKeys.filter((k) => !entry.hidden.includes(k) && autoValue(k)).map((k) => autoLabel(k) as string),
            ...(entry.intro ? [t('wspage.introTitle', '소개글') as string] : []),
            ...(entry.services.length ? [`${t('wspage.servicesTitle', '서비스')} ${entry.services.length}`] : []),
            ...entry.extras.filter((x) => x.label && x.value).map((x) => x.label),
          ]} />

        <Card data-testid="wspage-auto">
          <CardHeader>
            <Title>{t('wspage.autoTitle', '자동으로 들어간 정보')}</Title>
            <Desc>
              {t('wspage.autoDesc', '워크스페이스 정보에서 가져옵니다. 보이지 않게 할 항목은 끄세요. 값이 비어 있으면 줄 자체가 나오지 않습니다.')}
              {' '}
              <LinkBtn type="button" onClick={() => navigate('/business/settings')} data-testid="wspage-edit-info">
                {t('wspage.editInfo', '정보 고치기 →')}
              </LinkBtn>
            </Desc>
          </CardHeader>
          <AutoRow>
            <AutoKey>{t('wspage.auto.name', '회사 이름·로고')}</AutoKey>
            <AutoVal>{(auto.name as string) || '—'}</AutoVal>
            <Always>{t('wspage.alwaysShown', '항상 보임')}</Always>
          </AutoRow>
          {autoKeys.map((k) => {
            const val = autoValue(k);
            const on = !entry.hidden.includes(k);
            return (
              <AutoRow key={k} data-testid={`wspage-auto-${k}`}>
                <AutoKey>{autoLabel(k)}</AutoKey>
                <AutoVal $empty={!val} title={val}>{val || t('wspage.emptyValue', '(비어 있음)')}</AutoVal>
                <AutoSaveField type="toggle" key={`wspage-hide-${businessId}-${k}`} onSave={saveHidden}>
                  <Switch type="button" role="switch" aria-checked={on} $on={on} disabled={!isOwner}
                    aria-label={`${autoLabel(k)} ${on ? t('wspage.shown', '보임') : t('wspage.hidden', '가림')}`}
                    data-testid={`wspage-auto-toggle-${k}`} onClick={() => toggleHidden(k)}>
                    <SwitchKnob $on={on} />
                  </Switch>
                </AutoSaveField>
              </AutoRow>
            );
          })}
        </Card>

        <Card data-testid="wspage-intro">
          <CardHeader $row>
            <Title>{t('wspage.introTitle', '소개글')}</Title>
            <SegmentedToggle>
              <SegmentedBtn type="button" $active={introLang === 'ko'} onClick={() => setIntroLang('ko')} data-testid="wspage-intro-ko">
                {t('wspage.langKo', '한국어')}
              </SegmentedBtn>
              <SegmentedBtn type="button" $active={introLang === 'en'} onClick={() => setIntroLang('en')} data-testid="wspage-intro-en">
                English
              </SegmentedBtn>
            </SegmentedToggle>
          </CardHeader>
          <AutoSaveField key={`wspage-intro-${businessId}-${introLang}`} onSave={saveIntro}>
            <Area
              data-testid="wspage-intro-text"
              rows={6}
              maxLength={2000}
              disabled={!isOwner}
              placeholder={(introLang === 'ko'
                ? t('wspage.introPh', '어떤 일을 하는 회사인지, 누구에게 무엇을 해 주는지 적어 주세요.')
                : t('wspage.introPhEn', '(선택) 영어로 보는 고객에게 보일 소개. 비우면 한국어 소개가 보입니다.')) as string}
              value={introLang === 'ko' ? entry.intro : entry.intro_en}
              onChange={(e) => {
                const v = e.target.value;
                setEntry((p) => (introLang === 'ko' ? { ...p, intro: v } : { ...p, intro_en: v }));
              }}
            />
          </AutoSaveField>
        </Card>

        <Card data-testid="wspage-services">
          <CardHeader>
            <Title>{t('wspage.servicesTitle', '서비스')}</Title>
            <Desc>{t('wspage.servicesDesc', { count: SERVICE_MAX, defaultValue: '최대 {{count}}개 · 끌어서 순서를 바꿉니다. 고객은 카드의 [이 서비스 문의] 로 바로 문의합니다.' })}</Desc>
          </CardHeader>
          {entry.services.length === 0 && <Muted>{t('wspage.noServices', '아직 서비스가 없습니다. 무엇을 해 주는지 카드로 보여 주세요.')}</Muted>}
          <SvcList>
            {entry.services.map((s, i) => (
              <SvcRow
                key={s.id || i}
                data-testid={`wspage-service-${i}`}
                draggable={isOwner}
                $drag={dragIdx === i}
                onDragStart={() => setDragIdx(i)}
                onDragEnd={() => setDragIdx(null)}
                onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) void moveService(dragIdx, i); setDragIdx(null); }}
              >
                {isOwner && <Grip aria-hidden>⠿</Grip>}
                {s.image_url ? <Thumb src={`${s.image_url}?w=96`} alt="" /> : <ThumbEmpty aria-hidden />}
                <SvcText>
                  <SvcName>{s.name}</SvcName>
                  {s.price_text && <SvcSub>{s.price_text}</SvcSub>}
                </SvcText>
                {isOwner && (
                  <RowBtns>
                    {/* 폰에서는 끌기가 어렵다 — 위·아래 버튼을 같이 둔다 */}
                    <IconBtn type="button" disabled={i === 0} onClick={() => moveService(i, i - 1)}
                      aria-label={t('wspage.moveUp', '위로') as string} data-testid={`wspage-service-up-${i}`}>↑</IconBtn>
                    <IconBtn type="button" disabled={i === entry.services.length - 1} onClick={() => moveService(i, i + 1)}
                      aria-label={t('wspage.moveDown', '아래로') as string}>↓</IconBtn>
                    <SmallBtn type="button" onClick={() => { setSvcErr(null); setEditing({ index: i, svc: { ...emptyService(), ...s } }); }}
                      data-testid={`wspage-service-edit-${i}`}>{t('wspage.edit', '고치기')}</SmallBtn>
                    <SmallBtn type="button" $danger onClick={() => setAskDelete(i)} data-testid={`wspage-service-del-${i}`}>
                      {t('wspage.delete', '삭제')}
                    </SmallBtn>
                  </RowBtns>
                )}
              </SvcRow>
            ))}
          </SvcList>
          {isOwner && entry.services.length < SERVICE_MAX && (
            <AddBtn type="button" data-testid="wspage-service-add"
              onClick={() => { setSvcErr(null); setEditing({ index: -1, svc: emptyService() }); }}>
              + {t('wspage.addService', '서비스 추가')}
            </AddBtn>
          )}
        </Card>

        <Card data-testid="wspage-extras">
          <CardHeader>
            <Title>{t('wspage.extrasTitle', '추가 항목')}</Title>
            <Desc>{t('wspage.extrasDesc', { count: EXTRA_MAX, defaultValue: '설립 연도·인스타그램·자격증처럼 더 알리고 싶은 줄을 최대 {{count}}줄 넣습니다. 값이 주소(https://…)면 링크가 됩니다.' })}</Desc>
          </CardHeader>
          <AutoSaveField type="list" ref={extrasSaveRef} key={`wspage-extras-${businessId}`} onSave={saveExtras}>
            <ExtraList>
              {entry.extras.map((x, i) => (
                <ExtraRow key={i} data-testid={`wspage-extra-${i}`}>
                  <Input $w="34%" maxLength={30} disabled={!isOwner} value={x.label}
                    placeholder={t('wspage.extraLabelPh', '항목 (예: 설립)') as string}
                    aria-label={t('wspage.extraLabel', '항목 이름') as string}
                    onChange={(e) => setExtra(i, { label: e.target.value })} />
                  <Input maxLength={200} disabled={!isOwner} value={x.value}
                    placeholder={t('wspage.extraValuePh', '내용 (예: 2019년)') as string}
                    aria-label={t('wspage.extraValue', '내용') as string}
                    onChange={(e) => setExtra(i, { value: e.target.value })} />
                  {isOwner && (
                    <IconBtn type="button" onClick={() => removeExtra(i)} aria-label={t('wspage.delete', '삭제') as string}
                      data-testid={`wspage-extra-del-${i}`}>×</IconBtn>
                  )}
                </ExtraRow>
              ))}
            </ExtraList>
          </AutoSaveField>
          {isOwner && entry.extras.length < EXTRA_MAX && (
            <AddBtn type="button" onClick={addExtra} data-testid="wspage-extra-add">+ {t('wspage.addExtra', '항목 추가')}</AddBtn>
          )}
        </Card>
        <Card data-testid="wspage-form">
          <CardHeader>
            <Title>{t('wspage.formTitle', '문의 받기')}</Title>
            <Desc>{t('wspage.formDesc', '고객 페이지 맨 아래에 로그인 없이 쓰는 문의 폼이 생깁니다. 문의가 오면 Q sale «신규 문의» 에 쌓이고 대표·관리자에게 알림이 갑니다. 문의한 분에게는 «접수되었습니다» 안내 메일이 한 번 갑니다.')}</Desc>
          </CardHeader>
          {([
            ['enabled', t('wspage.formEnabled', '문의 폼')],
            ['ask_phone', t('wspage.formPhone', '전화번호도 받기')],
            ['ask_company', t('wspage.formCompany', '회사명도 받기')],
          ] as [keyof Form, string][]).map(([k, label]) => (
            <AutoRow key={k} data-testid={`wspage-form-${k}`}>
              <AutoKey>{label}</AutoKey>
              <AutoVal />
              <AutoSaveField type="toggle" key={`wspage-form-${businessId}-${k}`} onSave={saveForm}>
                <Switch type="button" role="switch" aria-checked={entry.form[k]} $on={entry.form[k]} aria-label={label}
                  disabled={!isOwner || (k !== 'enabled' && !entry.form.enabled)}
                  data-testid={`wspage-form-toggle-${k}`} onClick={() => flipForm(k)}>
                  <SwitchKnob $on={entry.form[k]} />
                </Switch>
              </AutoSaveField>
            </AutoRow>
          ))}
        </Card>
      </EditCol>

      <PreviewCol>
        <PreviewCard data-testid="wspage-preview">
          <CardHeader>
            <Title>{t('wspage.previewTitle', '미리 보기')}</Title>
            <Desc>{t('wspage.previewDesc', '고객이 링크를 열면 보는 «안내» 화면입니다. 고치는 즉시 바뀝니다.')}</Desc>
          </CardHeader>
          <PreviewHead>
            {auto.logo_url ? <PLogo src={`${auto.logo_url}?w=80`} alt="" /> : <PInitial>{String(auto.name || '·').charAt(0)}</PInitial>}
            <div>
              <PName>{(auto.name as string) || '—'}</PName>
              {preview?.tagline && <PSub>{preview.tagline}</PSub>}
            </div>
          </PreviewHead>
          <PreviewBody>
            <EntryInfoView entry={preview} bookingOn={!!preview?.booking?.enabled} onAsk={() => {}} onBook={() => {}} preview
              workspaceName={(auto.name as string) || ''} />
          </PreviewBody>
        </PreviewCard>
      </PreviewCol>

      <StandardModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={(editing && editing.index >= 0 ? t('wspage.editService', '서비스 고치기') : t('wspage.addService', '서비스 추가')) as string}
        size="md"
        footer={(
          <>
            <SmallBtn type="button" onClick={() => setEditing(null)}>{t('common.cancel', '취소')}</SmallBtn>
            <SmallBtn type="button" $primary onClick={commitService} disabled={uploading} data-testid="wspage-service-save">
              {t('wspage.save', '저장')}
            </SmallBtn>
          </>
        )}
      >
        {editing && (
          <>
            <FieldLabel>{t('wspage.svcName', '서비스 이름')} *</FieldLabel>
            <Input maxLength={40} value={editing.svc.name} data-testid="wspage-service-name"
              placeholder={t('wspage.svcNamePh', '예: 브랜드 아이덴티티') as string}
              onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, name: e.target.value } } : p))} />
            <FieldLabel>{t('wspage.svcSummary', '설명 (한두 줄)')}</FieldLabel>
            {/* draft-exempt: 서비스 카드 편집 창의 짧은 설명(200자) — [저장] 을 누르는 카드 폼이고 닫으면 카드 단위로 버린다(이름 칸과 한 묶음) */}
            <Area rows={3} maxLength={200} value={editing.svc.summary} data-testid="wspage-service-summary"
              placeholder={t('wspage.svcSummaryPh', '예: 로고·컬러·가이드까지 브랜드의 얼굴을 만듭니다.') as string}
              onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, summary: e.target.value } } : p))} />
            <FieldLabel>{t('wspage.svcPrice', '가격 문구 (선택)')}</FieldLabel>
            <Input maxLength={40} value={editing.svc.price_text} data-testid="wspage-service-price"
              placeholder={t('wspage.svcPricePh', '예: 300만원부터 · 견적 문의') as string}
              onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, price_text: e.target.value } } : p))} />
            <FieldLabel>{t('wspage.svcImage', '사진 (선택)')}</FieldLabel>
            <ImgRow>
              {editing.svc.image_url && <Thumb src={`${editing.svc.image_url}?w=96`} alt="" />}
              <FileLabel>
                {uploading ? t('wspage.uploading', '올리는 중…') : editing.svc.image_url ? t('wspage.changeImage', '사진 바꾸기') : t('wspage.addImage', '사진 올리기')}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="wspage-service-image"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadImage(f); }} />
              </FileLabel>
              {editing.svc.image_url && (
                <SmallBtn type="button" onClick={() => setEditing((p) => (p ? { ...p, svc: { ...p.svc, image_url: '' } } : p))}>
                  {t('wspage.removeImage', '사진 빼기')}
                </SmallBtn>
              )}
            </ImgRow>
            <Muted>{t('wspage.imageHint', 'PNG·JPG·WEBP, 3MB 이하. 가로로 긴 사진이 잘 보입니다.')}</Muted>
            <Details>
              <summary>{t('wspage.svcEnglish', 'English (선택 — 비우면 한국어가 보입니다)')}</summary>
              <FieldLabel>Name</FieldLabel>
              <Input maxLength={40} value={editing.svc.name_en}
                onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, name_en: e.target.value } } : p))} />
              <FieldLabel>Description</FieldLabel>
              {/* draft-exempt: 위 설명 칸의 영어판 — 같은 카드 폼 */}
              <Area rows={2} maxLength={200} value={editing.svc.summary_en}
                onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, summary_en: e.target.value } } : p))} />
              <FieldLabel>Price</FieldLabel>
              <Input maxLength={40} value={editing.svc.price_text_en}
                onChange={(e) => setEditing((p) => (p ? { ...p, svc: { ...p.svc, price_text_en: e.target.value } } : p))} />
            </Details>
            {svcErr && <Warn data-testid="wspage-service-error">{svcErr}</Warn>}
          </>
        )}
      </StandardModal>

      <ConfirmDialog
        isOpen={askDelete !== null}
        title={t('wspage.deleteServiceTitle', '이 서비스를 지울까요?') as string}
        message={askDelete !== null ? `${entry.services[askDelete]?.name || ''}\n${t('wspage.deleteServiceBody', '고객 페이지에서 바로 사라집니다.')}` : ''}
        confirmText={t('wspage.delete', '삭제') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="danger"
        onConfirm={() => { const i = askDelete; setAskDelete(null); if (i !== null) void removeService(i); }}
        onClose={() => setAskDelete(null)}
      />
    </Layout>
  );
}

// ── 스타일 — 설정 카드(CustomerEntrySection 과 같은 값) ──
// 넓으면 편집 | 미리 보기 두 칸(미리 보기는 따라온다). 1024 이하는 한 칸 — 미리 보기는 맨 아래.
const Layout = styled.div`
  display:grid;grid-template-columns:minmax(0, 1fr) minmax(320px, 420px);gap:16px;align-items:start;
  @media (max-width:1180px){ grid-template-columns:minmax(0, 1fr); }
`;
const EditCol = styled.div`display:flex;flex-direction:column;gap:16px;min-width:0;`;
const PreviewCol = styled.div`
  position:sticky;top:12px;min-width:0;
  @media (max-width:1180px){ position:static; }
`;
const Card = styled.div`
  background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;
  display:flex;flex-direction:column;gap:12px;min-width:0;
  @media (max-width:640px){ padding:14px; }
`;
const PreviewCard = styled(Card)`background:#F8FAFC;`;
const CardHeader = styled.div<{ $row?: boolean }>`
  display:flex;flex-direction:${p => (p.$row ? 'row' : 'column')};gap:4px;
  ${p => (p.$row ? 'align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;' : '')}
`;
const Title = styled.h3`margin:0;font-size:0.9375rem;font-weight:700;color:#0f172a;`;
const Desc = styled.p`margin:0;font-size:0.75rem;color:#64748b;line-height:1.5;`;
const Muted = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const Warn = styled.div`
  padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#B91C3C;
`;
const LinkBtn = styled.button`
  border:none;background:none;padding:0;cursor:pointer;color:#0D9488;font-size:0.75rem;font-weight:600;
  &:hover{text-decoration:underline;}
`;
const AutoRow = styled.div`
  display:flex;align-items:center;gap:12px;min-height:36px;border-top:1px solid #F1F5F9;padding-top:6px;
  &:first-of-type{border-top:none;}
`;
const AutoKey = styled.span`flex:0 0 110px;font-size:0.8125rem;font-weight:600;color:#334155;
  @media (max-width:640px){ flex-basis:84px; }`;
const AutoVal = styled.span<{ $empty?: boolean }>`
  flex:1;min-width:0;font-size:0.8125rem;color:${p => (p.$empty ? '#CBD5E1' : '#475569')};
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const Always = styled.span`flex-shrink:0;font-size:0.75rem;color:#94A3B8;`;
const Area = styled.textarea`
  width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;box-sizing:border-box;
  font-size:0.8125rem;line-height:1.6;color:#0f172a;resize:vertical;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#f8fafc;color:#94a3b8;}
`;
const Input = styled.input<{ $w?: string }>`
  ${p => (p.$w ? `flex:0 0 ${p.$w};` : 'flex:1;')}min-width:0;width:100%;height:36px;padding:0 12px;box-sizing:border-box;
  border:1px solid #e2e8f0;border-radius:8px;font-size:0.8125rem;color:#0f172a;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#f8fafc;color:#94a3b8;}
  @media (max-width:640px){ height:40px; }
`;
const SvcList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const SvcRow = styled.div<{ $drag?: boolean }>`
  display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;
  opacity:${p => (p.$drag ? 0.5 : 1)};
  @media (max-width:640px){ flex-wrap:wrap; }
`;
const Grip = styled.span`flex-shrink:0;color:#CBD5E1;cursor:grab;font-size:1rem;user-select:none;
  @media (max-width:640px){ display:none; }`;
const Thumb = styled.img`flex-shrink:0;width:48px;height:36px;object-fit:cover;border-radius:6px;background:#F1F5F9;`;
const ThumbEmpty = styled.span`flex-shrink:0;width:48px;height:36px;border-radius:6px;background:#F1F5F9;`;
const SvcText = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;`;
const SvcName = styled.span`font-size:0.8125rem;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const SvcSub = styled.span`font-size:0.75rem;color:#0D9488;font-weight:600;`;
const RowBtns = styled.div`display:flex;align-items:center;gap:4px;flex-shrink:0;
  @media (max-width:640px){ width:100%;justify-content:flex-end; }`;
const SmallBtn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  flex-shrink:0;height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;
  font-size:0.8125rem;font-weight:600;
  border:1px solid ${p => (p.$primary ? '#14B8A6' : p.$danger ? '#FECDD3' : '#cbd5e1')};
  background:${p => (p.$primary ? '#14B8A6' : '#fff')};
  color:${p => (p.$primary ? '#fff' : p.$danger ? '#B91C3C' : '#334155')};
  &:hover:not(:disabled){border-color:${p => (p.$danger ? '#F43F5E' : '#14B8A6')};}
  &:disabled{opacity:.55;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const IconBtn = styled(SmallBtn)`width:36px;padding:0;`;
const AddBtn = styled.button`
  align-self:flex-start;height:36px;padding:0 14px;border-radius:8px;cursor:pointer;
  border:1px dashed #94A3B8;background:#fff;color:#334155;font-size:0.8125rem;font-weight:600;
  &:hover{border-color:#14B8A6;color:#0D9488;}
`;
const ExtraList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const ExtraRow = styled.div`display:flex;align-items:center;gap:6px;`;
const FieldLabel = styled.label`font-size:0.75rem;font-weight:600;color:#475569;margin-top:2px;`;
const ImgRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const FileLabel = styled.label`
  display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:8px;cursor:pointer;
  border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:0.8125rem;font-weight:600;
  &:hover{border-color:#14B8A6;}
`;
const Details = styled.details`
  border-top:1px solid #F1F5F9;padding-top:10px;display:flex;flex-direction:column;gap:6px;
  summary{cursor:pointer;font-size:0.75rem;font-weight:600;color:#64748B;margin-bottom:6px;}
  &[open]{display:flex;}
`;
const PreviewHead = styled.div`display:flex;align-items:center;gap:10px;`;
const PLogo = styled.img`width:40px;height:40px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid #E2E8F0;`;
const PInitial = styled.span`
  width:40px;height:40px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;
  background:#14B8A6;color:#fff;font-weight:700;
`;
const PName = styled.div`font-size:0.9375rem;font-weight:700;color:#0F172A;`;
const PSub = styled.div`font-size:0.75rem;color:#64748B;`;
const PreviewBody = styled.div`display:flex;flex-direction:column;gap:14px;`;
