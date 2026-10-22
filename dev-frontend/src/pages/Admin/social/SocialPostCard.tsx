// SNS 발송 — 채널 한 곳의 소재(본문·첫 댓글·상태·행위). 상태 전이는 서버 한 문(services/social/socialTransition)이 판정한다.
//   본문은 자동저장(AutoSaveField) — 승인한 뒤 고치면 서버가 초안으로 되돌린다(승인한 것과 나가는 것이 같아야 한다).
//   반자동(네이버·카카오): [원고 복사]·[이미지 내려받기]·[게시함 표시]. 자동 채널은 단계 1 에선 «승인» 에서 멈춘다.
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../../../components/Common/AutoSaveField';
import ActionButton from '../../../components/Common/ActionButton';
import ConfirmDialog from '../../../components/Common/ConfirmDialog';
import { formatDayTime } from '../../../utils/dateFormat';
import { SOCIAL_API, socialCall, jsonInit, downloadMedia, type SocialPost } from './socialApi';

interface Props {
  post: SocialPost;
  maxChars: number;
  slug: string;
  onChanged: (p: SocialPost) => void;
  onError: (code: string) => void;
}

const LOCKED = new Set(['sent', 'canceled', 'sending']);

export default function SocialPostCard({ post, maxChars, slug, onChanged, onError }: Props) {
  const { t } = useTranslation('admin');
  const [body, setBody] = useState(post.body || '');
  const [comment, setComment] = useState(post.first_comment || '');
  const bodyRef = useRef(body);
  const commentRef = useRef(comment);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [postedUrl, setPostedUrl] = useState('');
  const [ask, setAsk] = useState<'posted' | 'cancel' | null>(null);

  // 서버가 바꾼 값(다른 관리자·다른 탭)을 받되, 입력 중인 칸은 덮지 않는다
  useEffect(() => {
    if (document.activeElement?.getAttribute('data-social-post') !== String(post.id)) {
      setBody(post.body || ''); bodyRef.current = post.body || '';
      setComment(post.first_comment || ''); commentRef.current = post.first_comment || '';
    }
  }, [post.id, post.body, post.first_comment]);

  const channel = t(`social.provider.${post.provider}`);
  const locked = LOCKED.has(post.status);
  const semi = post.mode === 'semi';
  const over = body.length > maxChars;

  const save = async (patch: Record<string, string>) => {
    const p = await socialCall<SocialPost>(`${SOCIAL_API}/posts/${post.id}`, jsonInit('PATCH', patch));
    onChanged(p);
  };

  const act = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(action);
    try {
      const p = await socialCall<SocialPost>(`${SOCIAL_API}/posts/${post.id}/${action}`, jsonInit('POST', payload || {}));
      onChanged(p);
    } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(bodyRef.current);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { onError('copy_failed'); }
  };

  const downloadAll = async () => {
    setBusy('download');
    try {
      for (const m of post.media) await downloadMedia(post.id, m.index, `${slug}-${post.provider}-${m.index + 1}.jpg`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Card data-testid={`social-post-${post.provider}`}>
      <Head>
        <Name>{channel}</Name>
        <ModeTag $semi={semi}>{t(`social.mode.${semi ? 'semi' : 'auto'}`)}</ModeTag>
        <StatusChip $s={post.status}>{t(`social.status.${post.status}`)}</StatusChip>
      </Head>

      <Label htmlFor={`sp-body-${post.id}`}>{t('social.body')}</Label>
      {locked ? (
        <ReadBody>{post.body}</ReadBody>
      ) : (
        <AutoSaveField key={`sp${post.id}-body`} type="input" onSave={async () => {
          if (bodyRef.current !== (post.body || '')) await save({ body: bodyRef.current });
        }}>
          <Area
            id={`sp-body-${post.id}`}
            data-social-post={post.id}
            value={body}
            rows={post.provider === 'naver' ? 12 : 7}
            onChange={(e) => { setBody(e.target.value); bodyRef.current = e.target.value; }}
          />
        </AutoSaveField>
      )}
      <Meta $warn={over}>{over ? t('social.overLimit') : ''} {t('social.chars', { n: body.length.toLocaleString(), max: maxChars.toLocaleString() })}</Meta>

      {post.provider === 'linkedin' && (
        <>
          <Label htmlFor={`sp-fc-${post.id}`}>{t('social.firstComment')}</Label>
          {locked ? <ReadBody>{post.first_comment}</ReadBody> : (
            <AutoSaveField key={`sp${post.id}-fc`} type="input" onSave={async () => {
              if (commentRef.current !== (post.first_comment || '')) await save({ first_comment: commentRef.current });
            }}>
              <Input id={`sp-fc-${post.id}`} data-social-post={post.id} value={comment}
                onChange={(e) => { setComment(e.target.value); commentRef.current = e.target.value; }} />
            </AutoSaveField>
          )}
        </>
      )}

      {post.status === 'approved' && !semi && <Hint>{t('social.autoWaiting')}</Hint>}
      {post.status === 'approved' && <Hint>{t('social.editUnapproves')}</Hint>}
      {locked && post.status !== 'sending' && <Hint>{t('social.readOnly')}</Hint>}
      {post.status === 'sent' && (
        <Hint>
          {post.sent_at ? t('social.postedAt', { date: formatDayTime(post.sent_at) }) : ''}
          {post.external_url && (<> · <a href={post.external_url} target="_blank" rel="noopener noreferrer">{t('social.openPosted')}</a></>)}
        </Hint>
      )}

      {semi && post.status === 'approved' && (
        <Input aria-label={t('social.postedUrl')} placeholder={t('social.postedUrl')} value={postedUrl}
          onChange={(e) => setPostedUrl(e.target.value)} />
      )}

      <Actions>
        {semi && (
          <>
            <ActionButton tone="secondary" size="sm" onClick={copyText}>{copied ? t('social.copied') : t('social.copy')}</ActionButton>
            {post.media.length > 0 && (
              <ActionButton tone="secondary" size="sm" loading={busy === 'download'} onClick={downloadAll}>{t('social.draft.downloadAll')}</ActionButton>
            )}
          </>
        )}
        <Spacer />
        {post.status === 'canceled' && (
          <ActionButton tone="secondary" size="sm" loading={busy === 'restore'} onClick={() => act('restore')}>{t('social.restore')}</ActionButton>
        )}
        {(post.status === 'draft' || post.status === 'approved') && (
          <ActionButton tone="secondary" size="sm" disabled={!!busy} onClick={() => setAsk('cancel')}>{t('social.cancel')}</ActionButton>
        )}
        {post.status === 'draft' && (
          <ActionButton tone="primary" size="sm" data-testid={`social-approve-${post.provider}`} loading={busy === 'approve'}
            disabled={!body.trim() || !!busy} onClick={() => act('approve')}>{t('social.approve')}</ActionButton>
        )}
        {semi && post.status === 'approved' && (
          <ActionButton tone="primary" size="sm" loading={busy === 'mark-posted'} onClick={() => setAsk('posted')}>{t('social.markPosted')}</ActionButton>
        )}
      </Actions>

      <ConfirmDialog
        isOpen={ask === 'posted'}
        onClose={() => setAsk(null)}
        onConfirm={() => { setAsk(null); void act('mark-posted', postedUrl.trim() ? { external_url: postedUrl.trim() } : {}); }}
        title={t('social.confirmPostedTitle')}
        message={t('social.confirmPostedMsg', { channel })}
        confirmText={t('social.confirmPostedOk')}
        cancelText={t('social.close')}
      />
      <ConfirmDialog
        isOpen={ask === 'cancel'}
        onClose={() => setAsk(null)}
        onConfirm={() => { setAsk(null); void act('cancel'); }}
        title={t('social.confirmCancelTitle')}
        message={t('social.confirmCancelMsg', { channel })}
        confirmText={t('social.confirmCancelOk')}
        cancelText={t('social.close')}
        variant="warning"
      />
    </Card>
  );
}

const STATUS_COLOR: Record<string, [string, string]> = {
  draft: ['#F1F5F9', '#475569'],
  approved: ['#CCFBF1', '#0F766E'],
  scheduled: ['#E0F2FE', '#0369A1'],
  sending: ['#E0F2FE', '#0369A1'],
  sent: ['#DCFCE7', '#15803D'],
  failed: ['#FFE4E6', '#BE123C'],
  canceled: ['#F1F5F9', '#94A3B8'],
};

const Card = styled.section`
  border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; background: #fff;
  display: flex; flex-direction: column; gap: 8px;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Name = styled.h4`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const ModeTag = styled.span<{ $semi: boolean }>`
  font-size: 0.75rem; padding: 2px 8px; border-radius: 999px;
  background: ${(p) => (p.$semi ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$semi ? '#92400E' : '#64748B')};
`;
const StatusChip = styled.span<{ $s: string }>`
  margin-left: auto; font-size: 0.75rem; font-weight: 600; padding: 2px 10px; border-radius: 999px;
  background: ${(p) => (STATUS_COLOR[p.$s] || STATUS_COLOR.draft)[0]}; color: ${(p) => (STATUS_COLOR[p.$s] || STATUS_COLOR.draft)[1]};
`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Area = styled.textarea`
  width: 100%; box-sizing: border-box; border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px;
  font: inherit; font-size: 0.8125rem; line-height: 1.6; color: #0F172A; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const Input = styled.input`
  width: 100%; box-sizing: border-box; height: 36px; border: 1px solid #CBD5E1; border-radius: 8px; padding: 0 12px;
  font: inherit; font-size: 0.8125rem; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,.15); }
`;
const ReadBody = styled.div`
  white-space: pre-wrap; font-size: 0.8125rem; line-height: 1.6; color: #334155; background: #F8FAFC;
  border-radius: 8px; padding: 10px 12px; max-height: 260px; overflow: auto; overflow-wrap: anywhere;
`;
const Meta = styled.div<{ $warn: boolean }>`
  font-size: 0.75rem; text-align: right; color: ${(p) => (p.$warn ? '#BE123C' : '#94A3B8')};
`;
const Hint = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.5; a { color: #0D9488; }`;
const Actions = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px;`;
const Spacer = styled.span`flex: 1 1 auto;`;
