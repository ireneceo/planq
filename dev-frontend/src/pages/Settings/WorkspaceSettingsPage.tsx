import { useEffect, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { Tabs, Tab } from '../../components/Common/TabComponents';
import {
  getWorkspace,
  updateBrand,
  updateLegal,
  updateSettings,
  listMembers,
  getCueInfo,
  updateCue,
  type Workspace,
  type WorkspaceMember,
  type CueInfo,
} from '../../services/workspace';

type TabKey = 'brand' | 'legal' | 'language' | 'members' | 'cue';

// ─────────────────────────────────────────────
// Styled
// ─────────────────────────────────────────────
const Page = styled.div`
  padding: 24px 32px 48px;
  background: #f8fafc;
  min-height: calc(100vh - 64px);
  @media (max-width: 768px) { padding: 16px; }
`;

const Header = styled.div`
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: #64748b;
  margin: 0;
`;

const Card = styled.section`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
`;

const SectionDesc = styled.p`
  font-size: 13px;
  color: #64748b;
  margin: 0 0 20px;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;

const Field = styled.div<{ $full?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  ${(p) => p.$full && 'grid-column: 1 / -1;'}
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: #475569;
`;

const LabelHint = styled.span`
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
  margin-left: 6px;
`;

const TextInput = styled.input`
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 120ms;
  &:focus { border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
  &::placeholder { color: #cbd5e1; }
`;

const ColorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ColorSwatch = styled.input.attrs({ type: 'color' })`
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
`;

const ModeCard = styled.label<{ $active?: boolean; $disabled?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid ${(p) => (p.$active ? '#14b8a6' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#f0fdfa' : '#ffffff')};
  border-radius: 10px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  margin-bottom: 10px;
  transition: all 120ms;
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  &:hover { border-color: ${(p) => (p.$disabled ? '#e2e8f0' : '#14b8a6')}; }
`;

const ModeRadio = styled.input.attrs({ type: 'radio' })`
  margin-top: 3px;
  accent-color: #14b8a6;
`;

const ModeBody = styled.div`
  flex: 1;
`;

const ModeTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
`;

const ModeHint = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
`;

const UsageBar = styled.div`
  position: relative;
  height: 14px;
  background: #f1f5f9;
  border-radius: 8px;
  overflow: hidden;
  margin: 12px 0 8px;
`;

const UsageFill = styled.div<{ $ratio: number; $over?: boolean }>`
  height: 100%;
  width: ${(p) => Math.min(100, p.$ratio * 100)}%;
  background: ${(p) => (p.$over ? '#f43f5e' : 'linear-gradient(90deg, #14b8a6, #0d9488)')};
  transition: width 240ms ease;
`;

const UsageStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 12px;
  color: #475569;
  margin-top: 8px;
`;

const UsageStat = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const UsageStatLabel = styled.span`
  color: #94a3b8;
  font-size: 11px;
`;

const UsageStatValue = styled.span`
  color: #0f172a;
  font-weight: 700;
  font-size: 14px;
`;

const ByTypeList = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 18px;
  margin-top: 14px;
  font-size: 12px;
  color: #475569;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;

const ByTypeRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px dashed #e2e8f0;
`;

const PauseToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-top: 16px;
`;

const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  width: 44px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: ${(p) => (p.$on ? '#f43f5e' : '#cbd5e1')};
  cursor: pointer;
  padding: 0;
  transition: background 160ms;
  flex-shrink: 0;
  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${(p) => (p.$on ? '22px' : '2px')};
    width: 20px;
    height: 20px;
    background: #ffffff;
    border-radius: 50%;
    transition: left 160ms;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  }
`;

const MemberRow = styled.div<{ $ai?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid ${(p) => (p.$ai ? '#fecdd3' : '#e2e8f0')};
  background: ${(p) => (p.$ai ? '#fff1f2' : '#ffffff')};
  border-radius: 10px;
  margin-bottom: 8px;
`;

const Avatar = styled.div<{ $ai?: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${(p) => (p.$ai ? '#f43f5e' : '#14b8a6')};
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
`;

const MemberInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const MemberName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
`;

const MemberEmail = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RoleBadge = styled.span<{ $role?: string }>`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: ${(p) => (p.$role === 'owner' ? '#0f766e' : p.$role === 'ai' ? '#9f1239' : '#475569')};
  background: ${(p) => (p.$role === 'owner' ? '#ccfbf1' : p.$role === 'ai' ? '#ffe4e6' : '#f1f5f9')};
  border-radius: 10px;
  flex-shrink: 0;
`;

const DefaultRoleInput = styled.input`
  width: 80px;
  padding: 3px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 11px;
  color: #0f172a;
  background: #f8fafc;
  flex-shrink: 0;
  &:focus { outline: none; border-color: #14b8a6; background: #fff; }
  &::placeholder { color: #94a3b8; }
`;

const ErrorBanner = styled.div`
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #9f1239;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
`;

const InfoBanner = styled.div`
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  color: #0f766e;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
`;

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default function WorkspaceSettingsPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const businessId = user?.business_id || 0;
  const isAdmin = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';

  const [tab, setTab] = useState<TabKey>('brand');
  const [ws, setWs] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [cue, setCue] = useState<CueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 로컬 편집 상태
  const [brandName, setBrandName] = useState('');
  const [brandNameEn, setBrandNameEn] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandTaglineEn, setBrandTaglineEn] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandColor, setBrandColor] = useState('#F43F5E');

  const [legalName, setLegalName] = useState('');
  const [legalNameEn, setLegalNameEn] = useState('');
  const [legalEntityType, setLegalEntityType] = useState<string>('');
  const [taxId, setTaxId] = useState('');
  const [representative, setRepresentative] = useState('');
  const [representativeEn, setRepresentativeEn] = useState('');
  const [address, setAddress] = useState('');
  const [addressEn, setAddressEn] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  const [defaultLanguage, setDefaultLanguage] = useState<'ko' | 'en'>('ko');
  const [timezone, setTimezone] = useState('Asia/Seoul');

  // 초기 로드
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [w, m, c] = await Promise.all([
          getWorkspace(businessId),
          listMembers(businessId).catch(() => []),
          getCueInfo(businessId).catch(() => null),
        ]);
        if (cancelled) return;
        setWs(w);
        setMembers(m);
        setCue(c);
        setBrandName(w.brand_name || w.name || '');
        setBrandNameEn(w.brand_name_en || '');
        setBrandTagline(w.brand_tagline || '');
        setBrandTaglineEn(w.brand_tagline_en || '');
        setBrandLogoUrl(w.brand_logo_url || '');
        setBrandColor(w.brand_color || '#F43F5E');
        setLegalName(w.legal_name || '');
        setLegalNameEn(w.legal_name_en || '');
        setLegalEntityType(w.legal_entity_type || '');
        setTaxId(w.tax_id || '');
        setRepresentative(w.representative || '');
        setRepresentativeEn(w.representative_en || '');
        setAddress(w.address || '');
        setAddressEn(w.address_en || '');
        setPhone(w.phone || '');
        setEmail(w.email || '');
        setWebsite(w.website || '');
        setDefaultLanguage((w.default_language as 'ko' | 'en') || 'ko');
        setTimezone(w.timezone || 'Asia/Seoul');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const showEn = defaultLanguage === 'ko';

  // Save handlers
  const saveBrand = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateBrand(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const saveLegal = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateLegal(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const saveSettings = useCallback(async (payload: Partial<Workspace>) => {
    if (!businessId) return;
    const updated = await updateSettings(businessId, payload);
    setWs(updated);
  }, [businessId]);

  const changeCueMode = useCallback(async (mode: 'smart' | 'auto' | 'draft') => {
    if (!businessId) return;
    await updateCue(businessId, { mode });
    const c = await getCueInfo(businessId);
    setCue(c);
  }, [businessId]);

  const togglePause = useCallback(async () => {
    if (!businessId || !cue) return;
    const nextPaused = !cue.paused;
    await updateCue(businessId, { paused: nextPaused });
    const c = await getCueInfo(businessId);
    setCue(c);
  }, [businessId, cue]);

  const usageRatio = useMemo(() => {
    if (!cue) return 0;
    return cue.usage.limit > 0 ? cue.usage.action_count / cue.usage.limit : 0;
  }, [cue]);

  if (loading) {
    return (
      <Page>
        <Header>
          <Title>{t('page.title')}</Title>
        </Header>
        <Card>Loading...</Card>
      </Page>
    );
  }

  if (!businessId || !ws) {
    return (
      <Page>
        <Header>
          <Title>{t('page.title')}</Title>
        </Header>
        <Card>{error || 'No workspace'}</Card>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>{t('page.title')}</Title>
        <Subtitle>{t('page.subtitle')}</Subtitle>
      </Header>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!isAdmin && <InfoBanner>{t('messages.adminRequired')}</InfoBanner>}

      <Tabs>
        <Tab active={tab === 'brand'} onClick={() => setTab('brand')}>{t('tabs.brand')}</Tab>
        <Tab active={tab === 'legal'} onClick={() => setTab('legal')}>{t('tabs.legal')}</Tab>
        <Tab active={tab === 'language'} onClick={() => setTab('language')}>{t('tabs.language')}</Tab>
        <Tab active={tab === 'members'} onClick={() => setTab('members')}>{t('tabs.members')}</Tab>
        <Tab active={tab === 'cue'} onClick={() => setTab('cue')}>{t('tabs.cue')}</Tab>
      </Tabs>

      {/* ─── BRAND ─── */}
      {tab === 'brand' && (
        <Card>
          <SectionTitle>{t('brand.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('brand.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>{t('brand.name')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_name: brandName }); }}
              >
                <TextInput
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder={t('brand.namePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>
                  {t('brand.nameEn')}
                  <LabelHint>{t('brand.nameEnHint')}</LabelHint>
                </Label>
                <AutoSaveField
                  type="input"
                  onSave={async () => { await saveBrand({ brand_name_en: brandNameEn || null }); }}
                >
                  <TextInput
                    value={brandNameEn}
                    onChange={(e) => setBrandNameEn(e.target.value)}
                    placeholder={t('brand.nameEnPlaceholder') || ''}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('brand.tagline')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_tagline: brandTagline || null }); }}
              >
                <TextInput
                  value={brandTagline}
                  onChange={(e) => setBrandTagline(e.target.value)}
                  placeholder={t('brand.taglinePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field $full>
                <Label>{t('brand.taglineEn')}</Label>
                <AutoSaveField
                  type="input"
                  onSave={async () => { await saveBrand({ brand_tagline_en: brandTaglineEn || null }); }}
                >
                  <TextInput
                    value={brandTaglineEn}
                    onChange={(e) => setBrandTaglineEn(e.target.value)}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('brand.logoUrl')}</Label>
              <AutoSaveField
                type="input"
                onSave={async () => { await saveBrand({ brand_logo_url: brandLogoUrl || null }); }}
              >
                <TextInput
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  placeholder={t('brand.logoUrlPlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>
                {t('brand.color')}
                <LabelHint>{t('brand.colorHint')}</LabelHint>
              </Label>
              <AutoSaveField
                type="input"
                debounceMs={500}
                onSave={async () => { await saveBrand({ brand_color: brandColor }); }}
              >
                <ColorRow>
                  <ColorSwatch
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    disabled={!isAdmin}
                  />
                  <TextInput
                    style={{ flex: 1 }}
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    placeholder="#F43F5E"
                    disabled={!isAdmin}
                  />
                </ColorRow>
              </AutoSaveField>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {/* ─── LEGAL ─── */}
      {tab === 'legal' && (
        <Card>
          <SectionTitle>{t('legal.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('legal.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>{t('legal.legalName')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ legal_name: legalName || null }); }}>
                <TextInput
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder={t('legal.legalNamePlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>{t('legal.legalNameEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ legal_name_en: legalNameEn || null }); }}>
                  <TextInput
                    value={legalNameEn}
                    onChange={(e) => setLegalNameEn(e.target.value)}
                    placeholder={t('legal.legalNameEnPlaceholder') || ''}
                    disabled={!isAdmin}
                  />
                </AutoSaveField>
              </Field>
            )}

            <Field>
              <Label>{t('legal.entityType')}</Label>
              <AutoSaveField
                type="select"
                onSave={async () => { await saveLegal({ legal_entity_type: (legalEntityType as 'corporation' | 'individual' | 'llc' | 'other') || null }); }}
              >
                {(() => {
                  const entityOpts = [
                    { value: '', label: '—' },
                    { value: 'corporation', label: t('legal.entityTypeCorporation') },
                    { value: 'individual', label: t('legal.entityTypeIndividual') },
                    { value: 'llc', label: t('legal.entityTypeLlc') },
                    { value: 'other', label: t('legal.entityTypeOther') },
                  ];
                  return (
                    <PlanQSelect
                      value={entityOpts.find((o) => o.value === legalEntityType) || null}
                      onChange={(opt) => {
                        const v = (opt as { value: string } | null)?.value ?? '';
                        setLegalEntityType(v);
                      }}
                      options={entityOpts}
                      isDisabled={!isAdmin}
                      size="sm"
                    />
                  );
                })()}
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.taxId')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ tax_id: taxId || null }); }}>
                <TextInput
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder={t('legal.taxIdPlaceholder') || ''}
                  disabled={!isAdmin}
                />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.representative')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ representative: representative || null }); }}>
                <TextInput value={representative} onChange={(e) => setRepresentative(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field>
                <Label>{t('legal.representativeEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ representative_en: representativeEn || null }); }}>
                  <TextInput value={representativeEn} onChange={(e) => setRepresentativeEn(e.target.value)} disabled={!isAdmin} />
                </AutoSaveField>
              </Field>
            )}

            <Field $full>
              <Label>{t('legal.address')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ address: address || null }); }}>
                <TextInput value={address} onChange={(e) => setAddress(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            {showEn && (
              <Field $full>
                <Label>{t('legal.addressEn')}</Label>
                <AutoSaveField type="input" onSave={async () => { await saveLegal({ address_en: addressEn || null }); }}>
                  <TextInput value={addressEn} onChange={(e) => setAddressEn(e.target.value)} disabled={!isAdmin} />
                </AutoSaveField>
              </Field>
            )}

            <Field>
              <Label>{t('legal.phone')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ phone: phone || null }); }}>
                <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('legal.email')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ email: email || null }); }}>
                <TextInput value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>

            <Field $full>
              <Label>{t('legal.website')}</Label>
              <AutoSaveField type="input" onSave={async () => { await saveLegal({ website: website || null }); }}>
                <TextInput value={website} onChange={(e) => setWebsite(e.target.value)} disabled={!isAdmin} />
              </AutoSaveField>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {/* ─── LANGUAGE ─── */}
      {tab === 'language' && (
        <Card>
          <SectionTitle>{t('language.sectionTitle')}</SectionTitle>
          <SectionDesc>{t('language.sectionDesc')}</SectionDesc>

          <FieldGrid>
            <Field>
              <Label>
                {t('language.defaultLanguage')}
                <LabelHint>{t('language.defaultLanguageHint')}</LabelHint>
              </Label>
              <AutoSaveField
                type="select"
                onSave={async () => { await saveSettings({ default_language: defaultLanguage }); }}
              >
                {(() => {
                  const langOpts = [
                    { value: 'ko', label: t('language.languageKo') },
                    { value: 'en', label: t('language.languageEn') },
                  ];
                  return (
                    <PlanQSelect
                      value={langOpts.find((o) => o.value === defaultLanguage) || null}
                      onChange={(opt) => {
                        const v = (opt as { value: string } | null)?.value as 'ko' | 'en' | undefined;
                        if (v) setDefaultLanguage(v);
                      }}
                      options={langOpts}
                      isDisabled={!isAdmin}
                      size="sm"
                    />
                  );
                })()}
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('language.timezone')}</Label>
              <AutoSaveField
                type="select"
                onSave={async () => { await saveSettings({ timezone }); }}
              >
                {(() => {
                  const tzOpts = [
                    { value: 'Asia/Seoul', label: 'Asia/Seoul (UTC+9)' },
                    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
                    { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
                    { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8)' },
                    { value: 'Europe/London', label: 'Europe/London (UTC+0)' },
                    { value: 'UTC', label: 'UTC' },
                  ];
                  return (
                    <PlanQSelect
                      value={tzOpts.find((o) => o.value === timezone) || null}
                      onChange={(opt) => {
                        const v = (opt as { value: string } | null)?.value;
                        if (v) setTimezone(v);
                      }}
                      options={tzOpts}
                      isDisabled={!isAdmin}
                      size="sm"
                    />
                  );
                })()}
              </AutoSaveField>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {/* ─── MEMBERS ─── */}
      {tab === 'members' && (
        <>
          <Card>
            <SectionTitle>{t('members.cueCardTitle')}</SectionTitle>
            <SectionDesc>{t('members.cueCardDesc')}</SectionDesc>

            {cue && (
              <>
                <UsageBar>
                  <UsageFill $ratio={usageRatio} $over={cue.usage.action_count >= cue.usage.limit} />
                </UsageBar>
                <UsageStats>
                  <UsageStat>
                    <UsageStatLabel>{t('members.cueUsageThisMonth')}</UsageStatLabel>
                    <UsageStatValue>
                      {cue.usage.action_count.toLocaleString()} / {cue.usage.limit.toLocaleString()}
                    </UsageStatValue>
                  </UsageStat>
                  <UsageStat>
                    <UsageStatLabel>{t('members.cueUsageRemaining')}</UsageStatLabel>
                    <UsageStatValue>{cue.usage.remaining.toLocaleString()}</UsageStatValue>
                  </UsageStat>
                  <UsageStat>
                    <UsageStatLabel>{t('cue.usageCost')}</UsageStatLabel>
                    <UsageStatValue>${cue.usage.cost_usd.toFixed(4)}</UsageStatValue>
                  </UsageStat>
                </UsageStats>
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>{t('members.sectionTitle')}</SectionTitle>
            <SectionDesc>{t('members.sectionDesc')}</SectionDesc>
            {members.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>{t('members.emptyMembers')}</div>}
            {members.map((m) => {
              const isAi = m.role === 'ai' || !!m.user?.is_ai;
              const firstLetter = (m.user?.name || '?').charAt(0).toUpperCase();
              const roleLabel = m.role === 'owner'
                ? t('members.roleAdmin')
                : m.role === 'ai'
                  ? t('members.roleAi')
                  : t('members.roleMember');
              return (
                <MemberRow key={m.id} $ai={isAi}>
                  <Avatar $ai={isAi}>{isAi ? 'C' : firstLetter}</Avatar>
                  <MemberInfo>
                    <MemberName>{m.user?.name}</MemberName>
                    <MemberEmail>{isAi ? t('members.cueCardDesc') : m.user?.email}</MemberEmail>
                  </MemberInfo>
                  {!isAi && isAdmin && (
                    <DefaultRoleInput
                      type="text"
                      placeholder={t('members.defaultRolePlaceholder', 'e.g. Design')}
                      defaultValue={(m as unknown as Record<string, string>).default_role || ''}
                      onBlur={async (e) => {
                        const val = e.target.value.trim();
                        try {
                          await fetch(`/api/businesses/${businessId}/members/${m.id}/default-role`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ default_role: val || null }),
                          });
                        } catch { /* silent */ }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                  )}
                  <RoleBadge $role={m.role}>{roleLabel}</RoleBadge>
                </MemberRow>
              );
            })}
          </Card>
        </>
      )}

      {/* ─── CUE ─── */}
      {tab === 'cue' && cue && (
        <>
          <Card>
            <SectionTitle>{t('cue.sectionTitle')}</SectionTitle>
            <SectionDesc>{t('cue.sectionDesc')}</SectionDesc>

            <div style={{ marginTop: 8 }}>
              <Label>{t('cue.modeTitle')}</Label>
              <div style={{ marginTop: 10 }}>
                {(['smart', 'auto', 'draft'] as const).map((m) => (
                  <ModeCard
                    key={m}
                    $active={cue.mode === m}
                    $disabled={!isAdmin}
                    onClick={() => { if (isAdmin && cue.mode !== m) changeCueMode(m); }}
                  >
                    <ModeRadio
                      checked={cue.mode === m}
                      readOnly
                      disabled={!isAdmin}
                      onChange={() => {}}
                    />
                    <ModeBody>
                      <ModeTitle>{t(`cue.mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}</ModeTitle>
                      <ModeHint>{t(`cue.mode${m.charAt(0).toUpperCase() + m.slice(1)}Hint`)}</ModeHint>
                    </ModeBody>
                  </ModeCard>
                ))}
              </div>
            </div>

            <PauseToggleRow>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{t('cue.pauseTitle')}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t('cue.pauseHint')}</div>
                <div style={{ fontSize: 11, color: cue.paused ? '#f43f5e' : '#14b8a6', marginTop: 4, fontWeight: 700 }}>
                  {cue.paused ? t('cue.paused') : t('cue.active')}
                </div>
              </div>
              <Switch $on={cue.paused} onClick={() => { if (isAdmin) togglePause(); }} disabled={!isAdmin} />
            </PauseToggleRow>
          </Card>

          <Card>
            <SectionTitle>{t('cue.usageTitle')}</SectionTitle>
            <UsageBar>
              <UsageFill $ratio={usageRatio} $over={cue.usage.action_count >= cue.usage.limit} />
            </UsageBar>
            <UsageStats>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageLimit')}</UsageStatLabel>
                <UsageStatValue>{cue.usage.limit.toLocaleString()}</UsageStatValue>
              </UsageStat>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageRemaining')}</UsageStatLabel>
                <UsageStatValue>{cue.usage.remaining.toLocaleString()}</UsageStatValue>
              </UsageStat>
              <UsageStat>
                <UsageStatLabel>{t('cue.usageCost')}</UsageStatLabel>
                <UsageStatValue>${cue.usage.cost_usd.toFixed(4)}</UsageStatValue>
              </UsageStat>
            </UsageStats>

            {cue.usage.action_count >= cue.usage.limit && (
              <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 14 }}>
                {t('cue.usageExceeded')}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <Label>{t('cue.usageByType')}</Label>
              <ByTypeList>
                {Object.entries(cue.usage.by_type).length === 0 && (
                  <div style={{ color: '#94a3b8' }}>—</div>
                )}
                {Object.entries(cue.usage.by_type).map(([type, count]) => {
                  const labelKey = ({
                    answer: 'cue.usageAnswer',
                    task_execute: 'cue.usageTaskExecute',
                    summary: 'cue.usageSummary',
                    kb_embed: 'cue.usageKbEmbed',
                  } as Record<string, string>)[type] || type;
                  return (
                    <ByTypeRow key={type}>
                      <span>{t(labelKey, { defaultValue: type })}</span>
                      <span style={{ fontWeight: 700 }}>{count.toLocaleString()}</span>
                    </ByTypeRow>
                  );
                })}
              </ByTypeList>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
