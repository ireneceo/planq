// API 토큰 (외부 연동, #D-4) — Claude Code 등 외부 에이전트가 이 워크스페이스를 **읽기**할 수 있는 토큰.
//   발급 시 평문은 1회만 노출(다시 못 봄). 읽기 전용 — 외부에서 데이터를 바꾸지 못한다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';

interface TokenRow {
  id: number;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const ApiTokenSection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('common');
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);   // 방금 발급된 평문 (1회 노출)
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/api-tokens?business_id=${businessId}`);
      const j = await res.json();
      if (res.ok && j.success) setRows(Array.isArray(j.data) ? j.data : []);
    } catch { /* 무해 */ } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true); setError(null); setIssued(null); setCopied(false);
    try {
      const res = await apiFetch('/api/api-tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, name: name.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) { setError(j.message || t('apitoken.errCreate', '발급하지 못했어요.')); return; }
      setIssued(j.data.token);
      setName('');
      await load();
    } catch { setError(t('apitoken.errCreate', '발급하지 못했어요.')); }
    finally { setCreating(false); }
  };

  const revoke = async (id: number) => {
    try {
      const res = await apiFetch(`/api/api-tokens/${id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } catch { /* 무해 */ }
  };

  const copy = () => {
    if (!issued) return;
    navigator.clipboard?.writeText(issued).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const active = rows.filter((r) => !r.revoked_at);

  return (
    <Wrap>
      <Title>{t('apitoken.title', 'API 토큰 (외부 연동)')}</Title>
      <Desc>{t('apitoken.desc', 'Claude Code 같은 외부 도구가 이 워크스페이스를 읽을 수 있는 토큰입니다. 읽기 전용 — 외부에서 데이터를 바꾸지 못합니다.')}</Desc>

      <CreateRow>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('apitoken.namePh', '토큰 이름 (예: Claude Code)') as string}
          maxLength={120}
        />
        <ActionButton tone="primary" size="sm" onClick={create} loading={creating}>
          {t('apitoken.create', '토큰 발급')}
        </ActionButton>
      </CreateRow>
      {error && <ErrLine>! {error}</ErrLine>}

      {issued && (
        <IssuedBox role="status">
          <IssuedLabel>{t('apitoken.issuedLabel', '토큰이 발급됐어요 — 지금만 볼 수 있어요. 안전한 곳에 복사하세요.')}</IssuedLabel>
          <IssuedRow>
            <Code>{issued}</Code>
            <ActionButton tone="secondary" size="sm" onClick={copy}>
              {copied ? t('apitoken.copied', '복사됨') : t('apitoken.copy', '복사')}
            </ActionButton>
          </IssuedRow>
        </IssuedBox>
      )}

      {loading ? (
        <Muted>{t('apitoken.loading', '불러오는 중…')}</Muted>
      ) : active.length === 0 ? (
        <Empty>{t('apitoken.empty', '아직 발급한 토큰이 없어요.')}</Empty>
      ) : (
        <List>
          {active.map((r) => (
            <Item key={r.id}>
              <div>
                <ItemName>{r.name || t('apitoken.unnamed', '(이름 없음)')}</ItemName>
                <ItemMeta>
                  {t('apitoken.created', '발급')} {String(r.created_at).slice(0, 10)}
                  {r.last_used_at ? ` · ${t('apitoken.lastUsed', '최근 사용')} ${String(r.last_used_at).slice(0, 10)}` : ` · ${t('apitoken.neverUsed', '미사용')}`}
                </ItemMeta>
              </div>
              <ActionButton tone="danger" size="sm" onClick={() => revoke(r.id)}>
                {t('apitoken.revoke', '회수')}
              </ActionButton>
            </Item>
          ))}
        </List>
      )}
    </Wrap>
  );
};

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px; max-width: 720px; margin-top: 28px; padding-top: 24px; border-top: 1px solid #e2e8f0;`;
const Title = styled.h3`font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;`;
const Desc = styled.p`font-size: 13px; color: #64748b; margin: 0; line-height: 1.5;`;
const CreateRow = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
const Input = styled.input`
  flex: 1; min-width: 200px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 13px;
  &:focus { outline: none; border-color: #0f766e; }
`;
const ErrLine = styled.div`font-size: 12px; color: #dc2626; font-weight: 600;`;
const IssuedBox = styled.div`border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px;`;
const IssuedLabel = styled.div`font-size: 12px; color: #0f766e; font-weight: 600;`;
const IssuedRow = styled.div`display: flex; gap: 8px; align-items: center;`;
const Code = styled.code`flex: 1; font-size: 12px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; word-break: break-all; color: #0f172a;`;
const Muted = styled.div`font-size: 13px; color: #94a3b8;`;
const Empty = styled.div`font-size: 13px; color: #94a3b8; padding: 12px 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Item = styled.div`display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;`;
const ItemName = styled.div`font-size: 13px; font-weight: 600; color: #0f172a;`;
const ItemMeta = styled.div`font-size: 11px; color: #94a3b8; margin-top: 2px;`;

export default ApiTokenSection;
