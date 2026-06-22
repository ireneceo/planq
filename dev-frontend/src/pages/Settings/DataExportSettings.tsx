// #63 데이터 내보내기 — 본인 L1 자료(파일·문서) zip / 워크스페이스 백업(관리자, L1 개인 제외).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import { formatBytes } from '../../services/files';
import {
  fetchMyExportPreview, fetchWorkspaceExportPreview,
  exportMyData, exportWorkspaceData, type ExportPreview,
} from '../../services/export';

interface Props {
  businessId: number;
  isOwner: boolean;
}

const IconDownload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const DataExportSettings: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const tr = (k: string, fb?: string) => t(k, (fb ?? '') as string) as unknown as string;

  const [myPreview, setMyPreview] = useState<ExportPreview | null>(null);
  const [wsPreview, setWsPreview] = useState<ExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMe, setBusyMe] = useState(false);
  const [busyWs, setBusyWs] = useState(false);
  const [errMe, setErrMe] = useState('');
  const [errWs, setErrWs] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [mine, ws] = await Promise.all([
        fetchMyExportPreview(businessId).catch(() => null),
        isOwner ? fetchWorkspaceExportPreview(businessId).catch(() => null) : Promise.resolve(null),
      ]);
      setMyPreview(mine);
      setWsPreview(ws);
    } finally {
      setLoading(false);
    }
  }, [businessId, isOwner]);

  useEffect(() => { load(); }, [load]);

  const errMessage = (code?: string) => {
    if (code === 'nothing_to_export') return tr('dataExport.errEmpty', '내보낼 자료가 없습니다.');
    return tr('dataExport.errGeneric', '다운로드 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
  };

  const onExportMe = async () => {
    setBusyMe(true); setErrMe('');
    try {
      const res = await exportMyData(businessId);
      if (!res.ok) setErrMe(errMessage(res.message));
    } catch {
      setErrMe(errMessage());
    } finally {
      setBusyMe(false);
    }
  };

  const onExportWs = async () => {
    setBusyWs(true); setErrWs('');
    try {
      const res = await exportWorkspaceData(businessId);
      if (!res.ok) setErrWs(errMessage(res.message));
    } catch {
      setErrWs(errMessage());
    } finally {
      setBusyWs(false);
    }
  };

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <StatItem><StatVal>{value}</StatVal><StatLabel>{label}</StatLabel></StatItem>
  );

  return (
    <Wrap>
      <SectionDesc>{tr('dataExport.intro', '내 개인 자료 또는 워크스페이스 자료를 ZIP 파일로 내보냅니다. 파일은 원본 그대로, 문서는 HTML로 저장됩니다.')}</SectionDesc>

      {/* ── 내 데이터 내보내기 (모든 멤버) ── */}
      <Card>
        <CardHead>
          <CardIcon $bg="#F0FDFA" $fg="#0F766E"><IconDownload /></CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('dataExport.myTitle', '내 데이터 내보내기')}</CardTitle>
            <CardSub>{tr('dataExport.myDesc', '내가 올린 개인(나만 보기) 파일과 내가 작성한 문서를 받습니다.')}</CardSub>
          </CardTitleWrap>
        </CardHead>
        <CardBody>
          {loading ? (
            <SkRow><Sk /><Sk /><Sk /></SkRow>
          ) : (
            <StatRow>
              <Stat label={tr('dataExport.files', '파일')} value={String(myPreview?.files ?? 0)} />
              <Stat label={tr('dataExport.documents', '문서')} value={String(myPreview?.documents ?? 0)} />
              <Stat label={tr('dataExport.size', '용량')} value={formatBytes(myPreview?.total_bytes ?? 0)} />
            </StatRow>
          )}
          {errMe && <ErrText role="alert">{errMe}</ErrText>}
        </CardBody>
        <CardActions>
          <ActionButton
            tone="primary" size="md" loading={busyMe}
            onClick={onExportMe}
            disabled={loading || ((myPreview?.files ?? 0) === 0 && (myPreview?.documents ?? 0) === 0)}
            icon={<IconDownload />}
          >
            {tr('dataExport.download', 'ZIP 다운로드')}
          </ActionButton>
        </CardActions>
      </Card>

      {/* ── 워크스페이스 백업 (관리자만) ── */}
      {isOwner && (
        <Card>
          <CardHead>
            <CardIcon $bg="#FEF3C7" $fg="#92400E"><IconShield /></CardIcon>
            <CardTitleWrap>
              <CardTitle>{tr('dataExport.wsTitle', '워크스페이스 데이터 백업')}</CardTitle>
              <CardSub>{tr('dataExport.wsDesc', '워크스페이스 공용 자료(팀·워크스페이스·외부 공개)를 받습니다. 멤버 개인(나만 보기) 자료는 포함되지 않습니다.')}</CardSub>
            </CardTitleWrap>
          </CardHead>
          <CardBody>
            {loading ? (
              <SkRow><Sk /><Sk /><Sk /></SkRow>
            ) : (
              <StatRow>
                <Stat label={tr('dataExport.files', '파일')} value={String(wsPreview?.files ?? 0)} />
                <Stat label={tr('dataExport.documents', '문서')} value={String(wsPreview?.documents ?? 0)} />
                <Stat label={tr('dataExport.size', '용량')} value={formatBytes(wsPreview?.total_bytes ?? 0)} />
              </StatRow>
            )}
            {(wsPreview?.confidential_count ?? 0) > 0 && (
              <Notice>
                <NoticeIcon><IconShield /></NoticeIcon>
                <NoticeText>{tr('dataExport.confidentialNote', '기밀 자료 {{n}}건이 포함됩니다. 관리자 권한으로 내보내며 감사 로그에 기록됩니다.').replace('{{n}}', String(wsPreview?.confidential_count ?? 0))}</NoticeText>
              </Notice>
            )}
            {errWs && <ErrText role="alert">{errWs}</ErrText>}
          </CardBody>
          <CardActions>
            <ActionButton
              tone="secondary" size="md" loading={busyWs}
              onClick={onExportWs}
              disabled={loading || ((wsPreview?.files ?? 0) === 0 && (wsPreview?.documents ?? 0) === 0)}
              icon={<IconDownload />}
            >
              {tr('dataExport.downloadBackup', '백업 ZIP 다운로드')}
            </ActionButton>
          </CardActions>
        </Card>
      )}
    </Wrap>
  );
};

export default DataExportSettings;

const Wrap = styled.div`display:flex;flex-direction:column;gap:12px;`;
const SectionDesc = styled.p`font-size:13px;color:#64748B;line-height:1.6;margin:0 0 4px;`;
const Card = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px;`;
const CardHead = styled.div`display:flex;align-items:flex-start;gap:12px;`;
const CardIcon = styled.div<{ $bg: string; $fg: string }>`width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${p => p.$bg};color:${p => p.$fg};`;
const CardTitleWrap = styled.div`flex:1;min-width:0;`;
const CardTitle = styled.div`font-size:15px;font-weight:700;color:#0F172A;margin-bottom:3px;`;
const CardSub = styled.div`font-size:13px;color:#64748B;line-height:1.55;`;
const CardBody = styled.div``;
const CardActions = styled.div`display:flex;gap:8px;justify-content:flex-end;`;
const StatRow = styled.div`display:flex;gap:12px;flex-wrap:wrap;`;
const StatItem = styled.div`flex:1;min-width:96px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 16px;`;
const StatVal = styled.div`font-size:20px;font-weight:700;color:#0F172A;line-height:1.2;word-break:break-all;`;
const StatLabel = styled.div`font-size:12px;color:#94A3B8;margin-top:4px;`;
const Notice = styled.div`display:flex;gap:8px;align-items:flex-start;background:#FEF3C7;border-radius:8px;padding:10px 12px;margin-top:12px;`;
const NoticeIcon = styled.span`color:#92400E;flex-shrink:0;display:flex;`;
const NoticeText = styled.div`font-size:12px;color:#92400E;line-height:1.5;`;
const ErrText = styled.div`font-size:12px;color:#EF4444;margin-top:10px;`;
const SkRow = styled.div`display:flex;gap:12px;`;
const Sk = styled.div`flex:1;height:62px;border-radius:10px;background:linear-gradient(90deg,#F1F5F9 0px,#E2E8F0 40px,#F1F5F9 80px);background-size:200px 100%;animation:dxsk 1.2s linear infinite;@keyframes dxsk{0%{background-position:-200px 0}100%{background-position:200px 0}}`;
