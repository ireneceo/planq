// 플랫폼(=PlanQ 운영자) 설정 — platform_admin 만 접근.
// 메일 푸터·법적 표기·지원 메일 등 .env PLATFORM_*/EMAIL_LOGO_URL 대체.
// AutoSaveField 패턴: 각 필드 입력 → debounce 후 PUT (부분 업데이트).
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';

interface PlatformSettings {
  id?: number;
  brand: string;
  tagline: string | null;
  website: string | null;
  support_email: string | null;
  legal_entity: string | null;
  email_logo_url: string | null;
  // 약관 버전
  terms_version: string;
  privacy_version: string;
  // 점검·공지
  maintenance_mode: boolean;
  maintenance_message: string | null;
  announcement_text: string | null;
  announcement_dismissible: boolean;
  announcement_severity: 'info' | 'warn' | 'critical';
  // SEO / SNS (사이클 N+23)
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  og_image_url: string | null;
  app_ios_url: string | null;
  app_android_url: string | null;
}

const EMPTY: PlatformSettings = {
  brand: '', tagline: '', website: '', support_email: '', legal_entity: '', email_logo_url: '',
  terms_version: '1.0', privacy_version: '1.0',
  maintenance_mode: false, maintenance_message: '',
  announcement_text: '', announcement_dismissible: true, announcement_severity: 'info',
  seo_title: '', seo_description: '', seo_keywords: '', og_image_url: '',
  app_ios_url: '', app_android_url: '',
};

const AdminPlatformSettingsPage = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<PlatformSettings>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await (await apiFetch('/api/admin/platform-settings')).json();
      if (r.success && r.data) {
        setData({
          id: r.data.id,
          brand: r.data.brand || '',
          tagline: r.data.tagline || '',
          website: r.data.website || '',
          support_email: r.data.support_email || '',
          legal_entity: r.data.legal_entity || '',
          email_logo_url: r.data.email_logo_url || '',
          terms_version: r.data.terms_version || '1.0',
          privacy_version: r.data.privacy_version || '1.0',
          maintenance_mode: !!r.data.maintenance_mode,
          maintenance_message: r.data.maintenance_message || '',
          announcement_text: r.data.announcement_text || '',
          announcement_dismissible: r.data.announcement_dismissible !== false,
          announcement_severity: r.data.announcement_severity || 'info',
          seo_title: r.data.seo_title || '',
          seo_description: r.data.seo_description || '',
          seo_keywords: r.data.seo_keywords || '',
          og_image_url: r.data.og_image_url || '',
          app_ios_url: r.data.app_ios_url || '',
          app_android_url: r.data.app_android_url || '',
        });
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<PlatformSettings>) => {
    const r = await (await apiFetch('/api/admin/platform-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })).json();
    if (r.success && r.data) {
      setData((prev) => ({ ...prev, ...r.data }));
    } else {
      throw new Error(r.message || 'save_failed');
    }
  };

  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <PageShell title={t('platform.title', '플랫폼 설정')}>
        <Card><Skeleton /></Card>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('platform.title', '플랫폼 설정')}>
      <Card>
        <Hint>
          {t('platform.hint', 'PlanQ 운영자(워프로랩) 정보입니다. 메일 푸터·법적 표기·지원 메일 등에 사용됩니다. 변경 시 자동 저장되며, 메일 발송에는 5분 캐시 후 반영됩니다.')}
        </Hint>

        <Field>
          <Label>{t('platform.brand', '브랜드명')} *</Label>
          <AutoSaveField type="input" onSave={async () => save({ brand: data.brand })}>
            <Input
              value={data.brand}
              onChange={(e) => set('brand', e.target.value)}
              placeholder="PlanQ"
              maxLength={100}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.tagline', '슬로건')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ tagline: data.tagline })}>
            <Input
              value={data.tagline || ''}
              onChange={(e) => set('tagline', e.target.value)}
              placeholder={t('platform.taglinePh', '일이 일이 되지 않게 플랜큐가 도와드립니다.') as string}
              maxLength={300}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.website', '웹사이트')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ website: data.website })}>
            <Input
              value={data.website || ''}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://planq.kr"
              maxLength={300}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.support_email', '지원 메일')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ support_email: data.support_email })}>
            <Input
              type="email"
              value={data.support_email || ''}
              onChange={(e) => set('support_email', e.target.value)}
              placeholder="help@planq.kr"
              maxLength={200}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.legal_entity', '법인명')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ legal_entity: data.legal_entity })}>
            <Input
              value={data.legal_entity || ''}
              onChange={(e) => set('legal_entity', e.target.value)}
              placeholder={t('platform.legalEntityPh', '워프로랩') as string}
              maxLength={100}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.email_logo_url', '메일 로고 URL')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ email_logo_url: data.email_logo_url })}>
            <Input
              value={data.email_logo_url || ''}
              onChange={(e) => set('email_logo_url', e.target.value)}
              placeholder={t('platform.email_logo_hint', '비우면 기본 로고 사용 (cid 인라인 첨부)') as string}
              maxLength={500}
            />
          </AutoSaveField>
        </Field>
      </Card>

      <Card>
        <SectionTitle>{t('platform.legalSection', '약관 버전')}</SectionTitle>
        <SectionHint>{t('platform.legalHint', '버전을 올리면 모든 사용자에게 재동의 모달이 노출됩니다.')}</SectionHint>
        <FieldRow>
          <Field>
            <Label>{t('platform.terms_version', '이용약관 버전')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ terms_version: data.terms_version })}>
              <Input value={data.terms_version} onChange={(e) => set('terms_version', e.target.value)} placeholder="1.0" maxLength={20} />
            </AutoSaveField>
          </Field>
          <Field>
            <Label>{t('platform.privacy_version', '개인정보 처리방침 버전')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ privacy_version: data.privacy_version })}>
              <Input value={data.privacy_version} onChange={(e) => set('privacy_version', e.target.value)} placeholder="1.0" maxLength={20} />
            </AutoSaveField>
          </Field>
        </FieldRow>
      </Card>

      <Card>
        <SectionTitle>{t('platform.maintenanceSection', '점검 모드')}</SectionTitle>
        <SectionHint>{t('platform.maintenanceHint', '켜면 platform_admin 외 모든 사용자에게 503 응답. 운영자는 계속 사용 가능합니다.')}</SectionHint>
        <Field>
          <ToggleRow>
            <AutoSaveField type="toggle" onSave={async () => save({ maintenance_mode: data.maintenance_mode })}>
              <Switch type="button" role="switch" aria-checked={data.maintenance_mode}
                $on={data.maintenance_mode} onClick={() => set('maintenance_mode', !data.maintenance_mode)}>
                <SwitchKnob $on={data.maintenance_mode} />
              </Switch>
            </AutoSaveField>
            <ToggleHint>{data.maintenance_mode ? t('platform.maintenanceOn', '점검 중') : t('platform.maintenanceOff', '정상 운영')}</ToggleHint>
          </ToggleRow>
        </Field>
        <Field>
          <Label>{t('platform.maintenance_message', '점검 메시지 (사용자에게 표시)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ maintenance_message: data.maintenance_message })}>
            <Input value={data.maintenance_message || ''} onChange={(e) => set('maintenance_message', e.target.value)}
              placeholder={t('platform.maintenance_messagePh', '예: 시스템 점검 중 (~22:00 종료 예정)') as string} maxLength={500} />
          </AutoSaveField>
        </Field>
      </Card>

      <Card>
        <SectionTitle>{t('platform.announcementSection', '공지 배너')}</SectionTitle>
        <SectionHint>{t('platform.announcementHint', '입력하면 모든 사용자 사이드바 상단에 노출됩니다. 비우면 숨김.')}</SectionHint>
        <Field>
          <Label>{t('platform.announcement_text', '공지 내용')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ announcement_text: data.announcement_text })}>
            <Input value={data.announcement_text || ''} onChange={(e) => set('announcement_text', e.target.value)}
              placeholder={t('platform.announcement_textPh', '예: 5월 6일 22~23시 점검 예정') as string} maxLength={500} />
          </AutoSaveField>
        </Field>
        <FieldRow>
          <Field>
            <Label>{t('platform.severity', '중요도')}</Label>
            <AutoSaveField type="toggle" onSave={async () => save({ announcement_severity: data.announcement_severity })}>
              <SeverityRow>
                {(['info','warn','critical'] as const).map(sev => (
                  <SeverityBtn key={sev} type="button" $active={data.announcement_severity === sev} $sev={sev}
                    onClick={() => set('announcement_severity', sev)}>
                    {sev === 'info' ? t('platform.sev.info', '안내') : sev === 'warn' ? t('platform.sev.warn', '주의') : t('platform.sev.critical', '긴급')}
                  </SeverityBtn>
                ))}
              </SeverityRow>
            </AutoSaveField>
          </Field>
          <Field>
            <Label>{t('platform.dismissible', '사용자가 닫기 가능')}</Label>
            <AutoSaveField type="toggle" onSave={async () => save({ announcement_dismissible: data.announcement_dismissible })}>
              <Switch type="button" role="switch" aria-checked={data.announcement_dismissible}
                $on={data.announcement_dismissible} onClick={() => set('announcement_dismissible', !data.announcement_dismissible)}>
                <SwitchKnob $on={data.announcement_dismissible} />
              </Switch>
            </AutoSaveField>
          </Field>
        </FieldRow>
      </Card>

      {/* SEO / SNS 공유 메타 (사이클 N+23) */}
      <Card>
        <SectionTitle>{t('platform.seoSection', 'SEO · SNS 공유')}</SectionTitle>
        <SectionHint>
          {t('platform.seoHint', '카카오톡·페이스북·트위터 등에서 PlanQ 링크 공유 시 노출되는 제목·설명·썸네일입니다. 공개 문서(/public/posts/...) 같은 페이지는 자기 제목·요약을 우선 사용하고, 비어있으면 여기 기본값으로 fallback 합니다.')}
        </SectionHint>

        <Field>
          <Label>{t('platform.seo_title', 'SEO 기본 제목')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ seo_title: data.seo_title })}>
            <Input
              value={data.seo_title || ''}
              onChange={(e) => set('seo_title', e.target.value)}
              placeholder={t('platform.seoTitlePh', 'PlanQ — 일이 일이 되지 않게') as string}
              maxLength={255}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.seo_description', 'SEO 기본 설명')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ seo_description: data.seo_description })}>
            <Input
              value={data.seo_description || ''}
              onChange={(e) => set('seo_description', e.target.value)}
              placeholder={t('platform.seoDescPh', '업무·프로젝트·사람·시간·고객·청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진.') as string}
              maxLength={500}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.seo_keywords', 'SEO 키워드 (쉼표 구분)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ seo_keywords: data.seo_keywords })}>
            <Input
              value={data.seo_keywords || ''}
              onChange={(e) => set('seo_keywords', e.target.value)}
              placeholder={t('platform.seoKeywordsPh', '업무관리, 프로젝트관리, 고객관리, B2B SaaS, 워크스페이스') as string}
              maxLength={500}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.og_image_url', 'OG 썸네일 이미지 URL (1200×630 권장)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ og_image_url: data.og_image_url })}>
            <Input
              value={data.og_image_url || ''}
              onChange={(e) => set('og_image_url', e.target.value)}
              placeholder="https://planq.kr/og-default.png"
              maxLength={500}
            />
          </AutoSaveField>
          <OgPreviewRow>
            <OgThumb src={data.og_image_url || 'https://planq.kr/og-default.png'} alt="OG preview" />
            <OgHint>
              {t('platform.og_image_hint', '비우면 기본 썸네일(og-default.png — 슬로건 + 로고)을 사용합니다. SNS 표준 1200×630 권장.')}
            </OgHint>
          </OgPreviewRow>
        </Field>

        <Field>
          <Label>{t('platform.app_ios_url', '앱 다운로드 — iOS (App Store / TestFlight URL)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ app_ios_url: data.app_ios_url })}>
            <Input
              value={data.app_ios_url || ''}
              onChange={(e) => set('app_ios_url', e.target.value)}
              placeholder="https://apps.apple.com/app/... 또는 TestFlight 링크"
              maxLength={500}
            />
          </AutoSaveField>
        </Field>

        <Field>
          <Label>{t('platform.app_android_url', '앱 다운로드 — Android (Play Store / APK URL)')}</Label>
          <AutoSaveField type="input" onSave={async () => save({ app_android_url: data.app_android_url })}>
            <Input
              value={data.app_android_url || ''}
              onChange={(e) => set('app_android_url', e.target.value)}
              placeholder="https://play.google.com/... 또는 APK 다운로드 URL"
              maxLength={500}
            />
          </AutoSaveField>
          <OgHint>{t('platform.app_url_hint', '/app 다운로드 페이지가 방문자 환경(iOS/Android)에 맞춰 이 링크로 안내합니다. 비우면 "출시 준비 중"으로 표시됩니다.')}</OgHint>
        </Field>
      </Card>
    </PageShell>
  );
};

export default AdminPlatformSettingsPage;

const Card = styled.section`
  background: #FFFFFF;
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 720px;
  margin-bottom: 16px;
`;
const SectionTitle = styled.h3`
  margin: 0; font-size: 15px; font-weight: 700; color: #0F172A;
`;
const SectionHint = styled.p`
  margin: -12px 0 0; font-size: 12px; color: #64748B; line-height: 1.6;
`;
const FieldRow = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
`;
const ToggleRow = styled.div`
  display: flex; align-items: center; gap: 12px;
`;
const ToggleHint = styled.span`font-size: 13px; color: #475569;`;
const Switch = styled.button<{ $on: boolean }>`
  width: 40px; height: 22px; border-radius: 11px; padding: 0;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; cursor: pointer; position: relative;
  transition: background 0.15s;
`;
const SwitchKnob = styled.div<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '20px' : '2px'};
  width: 18px; height: 18px; border-radius: 50%;
  background: #FFFFFF; transition: left 0.15s;
`;
const SeverityRow = styled.div`display: flex; gap: 6px;`;
const SeverityBtn = styled.button<{ $active: boolean; $sev: 'info'|'warn'|'critical' }>`
  padding: 6px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  background: ${p => !p.$active ? '#FFFFFF' : (p.$sev === 'critical' ? '#FEF2F2' : p.$sev === 'warn' ? '#FEF3C7' : '#F0FDFA')};
  color: ${p => !p.$active ? '#64748B' : (p.$sev === 'critical' ? '#B91C1C' : p.$sev === 'warn' ? '#92400E' : '#0F766E')};
  border: 1px solid ${p => !p.$active ? '#E2E8F0' : (p.$sev === 'critical' ? '#FECACA' : p.$sev === 'warn' ? '#FDE68A' : '#99F6E4')};
  &:hover { border-color: #14B8A6; }
`;
const Hint = styled.p`
  margin: 0 0 8px;
  font-size: 13px;
  color: #64748B;
  line-height: 1.6;
`;
const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: #334155;
`;
const Input = styled.input`
  height: 38px;
  padding: 0 12px;
  font-size: 14px;
  color: #0F172A;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  background: #FFFFFF;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
  &::placeholder { color: #94A3B8; }
`;
const OgPreviewRow = styled.div`
  display: flex; gap: 16px; align-items: flex-start;
  padding: 12px; border: 1px dashed #E2E8F0; border-radius: 8px;
  background: #F8FAFC;
`;
const OgThumb = styled.img`
  width: 240px; height: 126px; object-fit: cover;
  border-radius: 6px; border: 1px solid #E2E8F0; background: #FFFFFF;
  flex-shrink: 0;
`;
const OgHint = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.6;
  flex: 1;
`;
const Skeleton = styled.div`
  height: 200px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 8px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;
