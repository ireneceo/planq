// #63 데이터 내보내기 — 본인 L1 자료(파일·문서) zip / 워크스페이스 백업(관리자, L1 개인 제외).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import { formatBytes } from '../../services/files';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  fetchMyExportPreview, fetchWorkspaceExportPreview,
  exportMyData, exportWorkspaceData,
  fetchTransferTargets, type ExportPreview, type TransferTarget,
  createTransferJob, createExportJob, fetchExportJobs, downloadExportJob, deleteExportJob, type ExportJob,
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
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
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
  // Phase 2/3 — 워크스페이스 간 이전 (job 기반: 복사/이동 + Q Note + 비동기)
  const [targets, setTargets] = useState<TransferTarget[]>([]);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [trMode, setTrMode] = useState<'copy' | 'move'>('copy');
  const [trQnote, setTrQnote] = useState(false);
  const [busyTr, setBusyTr] = useState(false);
  const [trMsg, setTrMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [trConfirm, setTrConfirm] = useState(false);
  // Phase 3 — 비동기 작업 내역
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [busyExportJob, setBusyExportJob] = useState(false);
  const [exportQnote, setExportQnote] = useState(false);

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

  const loadJobs = useCallback(async () => {
    if (!businessId) return;
    fetchExportJobs(businessId).then(setJobs).catch(() => { /* keep */ });
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    fetchTransferTargets(businessId).then(setTargets).catch(() => setTargets([]));
    loadJobs();
  }, [businessId, loadJobs]);

  // 진행 중(queued/running) job 있으면 3초 폴링 — 완료/다운로드 자동 반영 (서버 알림과 별개 안전망)
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!active) return;
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  const doTransfer = async () => {
    if (!targetId || busyTr) return;
    setBusyTr(true); setTrMsg(null);
    try {
      await createTransferJob(businessId, { target_business_id: targetId, mode: trMode, include_qnote: trQnote });
      setTrMsg({ tone: 'ok', text: tr('dataExport.trQueued', '백그라운드에서 처리 중입니다. 완료되면 알림과 아래 작업 내역에 표시됩니다.') });
      loadJobs();
    } catch {
      setTrMsg({ tone: 'err', text: tr('dataExport.trErr', '이전 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.') });
    } finally {
      setBusyTr(false);
    }
  };

  const doExportJob = async () => {
    if (busyExportJob) return;
    setBusyExportJob(true);
    try {
      await createExportJob(businessId, exportQnote);
      loadJobs();
    } finally {
      setBusyExportJob(false);
    }
  };

  const doDownloadJob = async (job: ExportJob) => {
    if (!job.download_token) { await loadJobs(); return; }
    await downloadExportJob(businessId, job.id, job.download_token);
  };

  const doDeleteJob = async (job: ExportJob) => {
    setJobs(prev => prev.filter(j => j.id !== job.id)); // 낙관적 제거
    try { await deleteExportJob(businessId, job.id); } catch { await loadJobs(); }
  };

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
          <ToggleRow type="button" role="switch" aria-checked={exportQnote} onClick={() => setExportQnote(v => !v)}>
            <Switch $on={exportQnote}><SwitchKnob $on={exportQnote} /></Switch>
            <ToggleText>{tr('dataExport.includeQnote', 'Q Note 세션 포함 (요약·전사를 문서로 변환)')}</ToggleText>
          </ToggleRow>
        </CardBody>
        <CardActions>
          {exportQnote ? (
            <ActionButton
              tone="primary" size="md" loading={busyExportJob}
              onClick={doExportJob}
              icon={<IconClock />}
            >
              {tr('dataExport.bgExport', '백그라운드 내보내기')}
            </ActionButton>
          ) : (
            <ActionButton
              tone="primary" size="md" loading={busyMe}
              onClick={onExportMe}
              disabled={loading || ((myPreview?.files ?? 0) === 0 && (myPreview?.documents ?? 0) === 0)}
              icon={<IconDownload />}
            >
              {tr('dataExport.download', 'ZIP 다운로드')}
            </ActionButton>
          )}
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

      {/* ── 워크스페이스 간 이전 (복사, 원본 유지) ── */}
      {targets.length > 0 && (
        <Card>
          <CardHead>
            <CardIcon $bg="#F0FDFA" $fg="#0F766E"><IconDownload /></CardIcon>
            <CardTitleWrap>
              <CardTitle>{tr('dataExport.trTitle', '다른 워크스페이스로 이전')}</CardTitle>
              <CardSub>{tr('dataExport.trDesc2', '내 개인(나만 보기) 자료를 내가 속한 다른 워크스페이스로 옮깁니다. 복사(원본 유지) 또는 이동(원본 정리)을 선택하세요. 백그라운드로 처리됩니다.')}</CardSub>
            </CardTitleWrap>
          </CardHead>
          <CardBody>
            <TrRow>
              <PlanQSelect
                size="md"
                placeholder={tr('dataExport.trPick', '대상 워크스페이스 선택')}
                value={targetId ? { value: String(targetId), label: targets.find((x) => x.id === targetId)?.name || '' } : null}
                onChange={(opt) => setTargetId(opt ? Number((opt as { value: string }).value) : null)}
                options={targets.map((x) => ({ value: String(x.id), label: x.name }))}
              />
            </TrRow>
            <ModeRow role="radiogroup" aria-label={tr('dataExport.trModeLabel', '이전 방식')}>
              <ModeOpt type="button" role="radio" aria-checked={trMode === 'copy'} $active={trMode === 'copy'} onClick={() => setTrMode('copy')}>
                <ModeTitle>{tr('dataExport.modeCopy', '복사')}</ModeTitle>
                <ModeDesc>{tr('dataExport.modeCopyDesc', '원본을 그대로 두고 복제')}</ModeDesc>
              </ModeOpt>
              <ModeOpt type="button" role="radio" aria-checked={trMode === 'move'} $active={trMode === 'move'} onClick={() => setTrMode('move')}>
                <ModeTitle>{tr('dataExport.modeMove', '이동')}</ModeTitle>
                <ModeDesc>{tr('dataExport.modeMoveDesc', '옮긴 뒤 원본을 정리')}</ModeDesc>
              </ModeOpt>
            </ModeRow>
            <ToggleRow type="button" role="switch" aria-checked={trQnote} onClick={() => setTrQnote(v => !v)}>
              <Switch $on={trQnote}><SwitchKnob $on={trQnote} /></Switch>
              <ToggleText>{tr('dataExport.includeQnote', 'Q Note 세션 포함 (요약·전사를 문서로 변환)')}</ToggleText>
            </ToggleRow>
            {trMsg && <TrNote $tone={trMsg.tone} role="alert">{trMsg.text}</TrNote>}
          </CardBody>
          <CardActions>
            <ActionButton
              tone={trMode === 'move' ? 'danger' : 'secondary'} size="md" loading={busyTr}
              onClick={() => setTrConfirm(true)}
              disabled={!targetId || busyTr}
              icon={<IconDownload />}
            >
              {trMode === 'move' ? tr('dataExport.trActionMove', '이동하기') : tr('dataExport.trActionCopy', '복사하기')}
            </ActionButton>
          </CardActions>
        </Card>
      )}

      {/* ── 작업 내역 (비동기 이전/내보내기) ── */}
      {jobs.length > 0 && (
        <Card>
          <CardHead>
            <CardIcon $bg="#EEF2F7" $fg="#475569"><IconClock /></CardIcon>
            <CardTitleWrap>
              <CardTitle>{tr('dataExport.jobsTitle', '내보내기·이전 작업')}</CardTitle>
              <CardSub>{tr('dataExport.jobsDesc', '백그라운드로 처리되는 작업입니다. 내보내기 결과는 30일간 다운로드할 수 있어요.')}</CardSub>
            </CardTitleWrap>
          </CardHead>
          <CardBody>
            <JobList>
              {jobs.map((j) => (
                <JobRow key={j.id}>
                  <JobMain>
                    <JobKind>{j.kind === 'transfer' ? (j.mode === 'move' ? tr('dataExport.jobMove', '이동') : tr('dataExport.jobCopy', '복사')) : tr('dataExport.jobExport', '내보내기')}{j.include_qnote ? tr('dataExport.jobQnoteTag', ' · Q Note 포함') : ''}</JobKind>
                    <JobMeta>{new Date(j.created_at).toLocaleString()}</JobMeta>
                  </JobMain>
                  <JobRight>
                    <JobStatus $s={j.status}>
                      {j.status === 'queued' ? tr('dataExport.stQueued', '대기 중')
                        : j.status === 'running' ? tr('dataExport.stRunning', '처리 중')
                        : j.status === 'done' ? tr('dataExport.stDone', '완료')
                        : tr('dataExport.stFailed', '실패')}
                    </JobStatus>
                    {j.kind === 'export' && j.has_download && (
                      <ActionButton tone="primary" size="sm" onClick={() => doDownloadJob(j)} icon={<IconDownload />}>
                        {tr('dataExport.jobDownload', '다운로드')}
                      </ActionButton>
                    )}
                    {j.status !== 'running' && (
                      <JobDelBtn type="button" onClick={() => doDeleteJob(j)} title={tr('dataExport.jobDelete', '내역에서 삭제') as string} aria-label={tr('dataExport.jobDelete', '내역에서 삭제') as string}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </JobDelBtn>
                    )}
                  </JobRight>
                </JobRow>
              ))}
            </JobList>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        isOpen={trConfirm}
        title={trMode === 'move' ? tr('dataExport.moveConfirmTitle', '워크스페이스로 이동') : tr('dataExport.trConfirmTitle', '워크스페이스로 복사')}
        message={trMode === 'move'
          ? tr('dataExport.moveConfirmMsg', '선택한 워크스페이스로 내 개인 자료를 옮기고 이 워크스페이스의 원본은 정리됩니다(파일 삭제·문서 보관처리). 계속할까요?')
          : tr('dataExport.trConfirmMsg', '선택한 워크스페이스로 내 개인 자료를 복사합니다. 원본은 그대로 유지됩니다. 계속할까요?')}
        confirmText={trMode === 'move' ? tr('dataExport.trActionMove', '이동하기') : tr('dataExport.trActionCopy', '복사하기')}
        onConfirm={() => { setTrConfirm(false); doTransfer(); }}
        onClose={() => setTrConfirm(false)}
      />
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
const TrRow = styled.div`max-width:360px;`;
const TrNote = styled.div<{ $tone: 'ok' | 'err' }>`font-size:12px;margin-top:10px;color:${p => p.$tone === 'ok' ? '#0F766E' : '#EF4444'};`;
// #63 Phase 3 — 이동 방식 라디오 + Q Note 토글 + 작업 내역
const ModeRow = styled.div`display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;`;
const ModeOpt = styled.button<{ $active?: boolean }>`
  flex:1;min-width:140px;text-align:left;padding:10px 14px;border-radius:10px;cursor:pointer;
  background:${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border:1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  transition:all 0.15s;&:hover{border-color:#14B8A6;}
`;
const ModeTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const ModeDesc = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;`;
const ToggleRow = styled.button`display:flex;align-items:center;gap:10px;margin-top:12px;background:none;border:none;padding:0;cursor:pointer;text-align:left;`;
const Switch = styled.span<{ $on?: boolean }>`width:38px;height:22px;border-radius:999px;flex-shrink:0;position:relative;transition:background 0.15s;background:${p => p.$on ? '#14B8A6' : '#CBD5E1'};`;
const SwitchKnob = styled.span<{ $on?: boolean }>`position:absolute;top:2px;left:${p => p.$on ? '18px' : '2px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.15s;box-shadow:0 1px 2px rgba(0,0,0,0.15);`;
const ToggleText = styled.span`font-size:13px;color:#334155;`;
const JobList = styled.div`display:flex;flex-direction:column;gap:8px;`;
const JobRow = styled.div`display:flex;align-items:center;gap:12px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;`;
const JobMain = styled.div`flex:1;min-width:0;`;
const JobKind = styled.div`font-size:13px;font-weight:600;color:#0F172A;`;
const JobMeta = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;`;
const JobRight = styled.div`display:flex;align-items:center;gap:10px;flex-shrink:0;`;
const JobStatus = styled.span<{ $s: string }>`
  font-size:12px;font-weight:600;
  color:${p => p.$s === 'done' ? '#0F766E' : p.$s === 'failed' ? '#EF4444' : '#64748B'};
`;
const JobDelBtn = styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:#94A3B8;border-radius:6px;cursor:pointer;flex-shrink:0;transition:all 0.15s;&:hover{background:#FEF2F2;color:#EF4444;}`;
const SkRow = styled.div`display:flex;gap:12px;`;
const Sk = styled.div`flex:1;height:62px;border-radius:10px;background:linear-gradient(90deg,#F1F5F9 0px,#E2E8F0 40px,#F1F5F9 80px);background-size:200px 100%;animation:dxsk 1.2s linear infinite;@keyframes dxsk{0%{background-position:-200px 0}100%{background-position:200px 0}}`;
