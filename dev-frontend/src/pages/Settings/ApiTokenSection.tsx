// 외부 AI 도구 연결 안내 (옛 «API 토큰 (외부 연동)», #D-4 → 2026-11-18 정리)
//   옛 API 토큰은 받아 줄 주소(`/mcp`)가 nginx 에 없어 발급해도 어디에도 쓸 수 없었다(한 번도 쓰인 적 없음).
//   같은 목적은 프로필 › 외부 연동 › «연결된 AI 앱»(OAuth · /agent/mcp)이 한다 → 여기는 그리로 안내만 한다.
//   이미 발급된 옛 토큰이 남아 있을 때만 목록 + [회수] 를 보여 정리하게 한다(새 발급 없음).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { formatDay } from '../../utils/dateFormat';

interface TokenRow {
  id: number;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const ApiTokenSection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [rows, setRows] = useState<TokenRow[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/api-tokens?business_id=${businessId}`);
      const j = await res.json();
      if (res.ok && j.success) setRows(Array.isArray(j.data) ? j.data : []);
    } catch { /* 무해 — 옛 토큰 목록은 정리용 부가 정보 */ }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // 회수는 되돌릴 수 없다 — 묻고 한다(0-J).
  const [revokeAsk, setRevokeAsk] = useState<{ id: number; name: string } | null>(null);
  const revoke = async (id: number) => {
    try {
      const res = await apiFetch(`/api/api-tokens/${id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } catch { /* 무해 */ }
  };

  const active = rows.filter((r) => !r.revoked_at);

  return (
    <Wrap>
      <Title>{t('apitoken.aiTitle', '외부 AI 도구 연결')}</Title>
      <Desc>{t('apitoken.aiDesc', 'ChatGPT·Claude·Claude Code 같은 AI 도구가 내 권한 안에서 이 워크스페이스의 업무·고객·문서를 읽고, 허락하면 추가·수정까지 할 수 있게 연결합니다.')}</Desc>
      <Steps>
        <li>{t('apitoken.aiStep1', '연결은 각자 자기 계정에서 합니다 — 프로필 › 외부 연동 › «연결된 AI 앱».')}</li>
        <li>{t('apitoken.aiStep2', '그 화면의 연결 주소를 AI 도구에 넣고, PlanQ 로그인 창에서 «읽기만» 또는 «읽기 + 추가·수정» 을 고릅니다.')}</li>
        <li>{t('apitoken.aiStep3', '연결을 끊으면 그 AI 도구는 바로 PlanQ 에 접근하지 못합니다.')}</li>
      </Steps>
      <div>
        <ActionButton tone="primary" size="sm" onClick={() => navigate('/profile/integrations?focus=ai')}>
          {t('apitoken.aiGo', 'AI 앱 연결하러 가기')}
        </ActionButton>
      </div>

      {active.length > 0 && (
        <Legacy>
          <LegacyTitle>{t('apitoken.legacyTitle', '예전에 발급한 API 토큰')}</LegacyTitle>
          <Desc>{t('apitoken.legacyDesc', '예전 방식의 토큰으로, 지금은 어디에도 쓰이지 않습니다. 회수해 정리해 주세요.')}</Desc>
          <List>
            {active.map((r) => (
              <Item key={r.id}>
                <div>
                  <ItemName>{r.name || t('apitoken.unnamed', '(이름 없음)')}</ItemName>
                  <ItemMeta>
                    {t('apitoken.created', '발급')} {formatDay(r.created_at, { year: 'always' })}
                    {r.last_used_at ? ` · ${t('apitoken.lastUsed', '최근 사용')} ${formatDay(r.last_used_at, { year: 'always' })}` : ` · ${t('apitoken.neverUsed', '미사용')}`}
                  </ItemMeta>
                </div>
                <ActionButton tone="danger" size="sm" onClick={() => setRevokeAsk({ id: r.id, name: r.name || '' })}
                  title={t('apitoken.revokeHint', '이 토큰을 폐기합니다.') as string}
                  aria-label={`${r.name || ''} ${t('apitoken.revoke', '회수')}`}>
                  {t('apitoken.revoke', '회수')}
                </ActionButton>
              </Item>
            ))}
          </List>
        </Legacy>
      )}
      <ConfirmDialog
        isOpen={!!revokeAsk}
        title={t('apitoken.revokeConfirmTitle', '토큰을 회수할까요?') as string}
        message={t('apitoken.revokeConfirmBody', { name: revokeAsk?.name || t('apitoken.unnamed', '(이름 없음)'), defaultValue: '«{{name}}» 토큰을 쓰는 외부 도구는 바로 연결이 끊깁니다. 되돌릴 수 없습니다.' }) as string}
        confirmText={t('apitoken.revoke', '회수') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
        onClose={() => setRevokeAsk(null)}
        onConfirm={() => { const a = revokeAsk; setRevokeAsk(null); if (a) void revoke(a.id); }}
      />
    </Wrap>
  );
};

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px; max-width: 720px; margin-top: 28px; padding-top: 24px; border-top: 1px solid #e2e8f0;`;
const Title = styled.h3`font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0;`;
const Desc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0; line-height: 1.5;`;
const Steps = styled.ol`margin: 0; padding-left: 20px; font-size: 0.8125rem; color: #334155; line-height: 1.6; display: flex; flex-direction: column; gap: 2px;`;
const Legacy = styled.div`display: flex; flex-direction: column; gap: 8px; margin-top: 8px;`;
const LegacyTitle = styled.h4`font-size: 0.875rem; font-weight: 700; color: #0f172a; margin: 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Item = styled.div`display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;`;
const ItemName = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0f172a;`;
const ItemMeta = styled.div`font-size: 0.6875rem; color: #94a3b8; margin-top: 2px;`;

export default ApiTokenSection;
