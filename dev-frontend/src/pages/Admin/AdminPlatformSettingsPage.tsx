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
}

const EMPTY: PlatformSettings = {
  brand: '', tagline: '', website: '', support_email: '', legal_entity: '', email_logo_url: '',
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

  const set = (key: keyof PlatformSettings, value: string) => {
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
              placeholder="일이 일이 되지 않게 플랜큐가 도와드립니다."
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
              placeholder="워프로랩"
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
