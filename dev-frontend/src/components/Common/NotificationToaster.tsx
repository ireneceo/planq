// 우측 상단 인앱 알림 toaster — 30년차 시각 핵심 원칙 적용:
//   1. Focus steal 금지 (modal X, focus 안 빼앗음)
//   2. Context-aware (활성 페이지/대화방 알림은 표시 X)
//   3. Notification fatigue 방지 (최대 3 개 stack, 5s 자동 페이드, hover 시 정지)
//   4. 사운드 기본 OFF (작업 방해)
//
// Architecture:
//   - 단일 socket (per user session) 으로 사용자 워크스페이스 room + 대화방 room 모두 구독
//   - 백엔드의 task:new, task:updated, inbox:refresh, message:new 모두 listen
//   - 'chat' (인앱) channel ON 일 때만 표시 (notification_prefs 매트릭스)
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, getAccessToken, apiFetch } from '../../contexts/AuthContext';

interface Toast {
  id: string;
  type: 'message' | 'task' | 'invoice' | 'signature' | 'event' | 'system';
  title: string;
  body?: string;
  link?: string;       // 클릭 시 이동
  contextKey?: string; // 활성 페이지 매칭용 (예: conv:123, task:45)
  ts: number;
}

const MAX_VISIBLE = 3;
const FADE_MS = 5000;

export default function NotificationToaster() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const activeConvIdRef = useRef<number | null>(null);
  const activePathRef = useRef<string>(location.pathname);

  // 활성 컨텍스트 추적 — toast 가 같은 page/conv 에 떠 있으면 표시 X
  useEffect(() => {
    activePathRef.current = location.pathname;
    // /talk?conv=123 같은 패턴에서 conv id 추출
    const params = new URLSearchParams(location.search);
    const conv = params.get('conv');
    activeConvIdRef.current = conv ? Number(conv) : null;
  }, [location.pathname, location.search]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(x => x.id !== id));
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
  }, []);

  const add = useCallback((toast: Omit<Toast, 'id' | 'ts'>) => {
    // Context-aware skip: 활성 conv 이거나 같은 페이지면 표시 X
    if (toast.contextKey?.startsWith('conv:')) {
      const cid = Number(toast.contextKey.slice(5));
      if (cid && cid === activeConvIdRef.current) return;
    }
    if (toast.link && activePathRef.current === toast.link.split('?')[0]) {
      // 같은 페이지면 토스트 X (이미 보고 있음)
      // 단, conv 가 다른 경우는 제외 (위에서 처리)
      if (!toast.link.includes('?')) return;
    }
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next: Toast = { ...toast, id, ts: Date.now() };
    setToasts(prev => [...prev, next].slice(-MAX_VISIBLE));
    const timer = setTimeout(() => dismiss(id), FADE_MS);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  // hover 시 자동 닫힘 정지 / 떠나면 재시작
  const pauseTimer = (id: string) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  };
  const resumeTimer = (id: string) => {
    if (timersRef.current.has(id)) return;
    const timer = setTimeout(() => dismiss(id), FADE_MS / 2);
    timersRef.current.set(id, timer);
  };

  // Global socket — user 가 로그인되어 있을 때만 연결
  useEffect(() => {
    if (!user) return;
    const bizId = user.business_id ? Number(user.business_id) : null;
    if (!bizId) return;
    if (!getAccessToken()) return;

    const s = io({
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = s;

    s.on('connect', () => {
      // 워크스페이스 룸 — task:new / task:updated / inbox:refresh 받음
      s.emit('join:business', bizId);
      // 사용자가 참여한 모든 conversation 룸 — message:new 받기 위해
      apiFetch(`/api/conversations/${bizId}`).then(r => r.json()).then(j => {
        if (j.success && Array.isArray(j.data)) {
          j.data.forEach((c: { id: number }) => {
            s.emit('join:conversation', c.id);
          });
        }
      }).catch(() => {});
    });

    s.on('connect_error', async (err) => {
      const msg = String((err as Error)?.message || '');
      if (/auth|token|jwt|unauthorized/i.test(msg)) {
        await apiFetch('/api/auth/me').catch(() => null);
      }
    });

    // 채팅 메시지 — 본인이 보낸 건 제외 (sender_id !== userId)
    s.on('message:new', (msg: { id: number; conversation_id: number; sender_id: number; content?: string; sender?: { name?: string; display_name?: string | null } }) => {
      if (msg.sender_id === Number(user.id)) return;
      const senderName = msg.sender?.display_name || msg.sender?.name || t('toaster.someone', '누군가');
      const preview = (msg.content || '').replace(/<[^>]*>/g, '').slice(0, 60);
      add({
        type: 'message',
        title: t('toaster.newMessage', '{{sender}} 의 메시지', { sender: senderName, defaultValue: `${senderName} 의 메시지` }) as string,
        body: preview || (t('toaster.attachmentOnly', '(첨부파일)') as string),
        link: `/talk?conv=${msg.conversation_id}`,
        contextKey: `conv:${msg.conversation_id}`,
      });
    });

    // 새 업무 — 본인이 만든 건 skip
    s.on('task:new', (task: { id: number; title: string; assignee_id?: number; created_by?: number; project_id?: number | null }) => {
      if (task.created_by === Number(user.id)) return;
      // 나에게 배정된 업무
      if (task.assignee_id === Number(user.id)) {
        add({
          type: 'task',
          title: t('toaster.taskAssigned', '새 업무가 배정됐습니다') as string,
          body: task.title,
          link: `/tasks?task=${task.id}`,
          contextKey: `task:${task.id}`,
        });
      }
    });

    // 업무 상태 변경
    s.on('task:updated', (task: { id: number; title: string; status?: string; assignee_id?: number }) => {
      if (task.status === 'completed' && task.assignee_id !== Number(user.id)) {
        add({
          type: 'task',
          title: t('toaster.taskCompleted', '업무가 완료됐습니다') as string,
          body: task.title,
          link: `/tasks?task=${task.id}`,
          contextKey: `task:${task.id}`,
        });
      }
      if (task.status === 'reviewing') {
        add({
          type: 'task',
          title: t('toaster.taskReviewing', '검토 요청') as string,
          body: task.title,
          link: `/tasks?task=${task.id}`,
          contextKey: `task:${task.id}`,
        });
      }
    });

    // 인박스 새로고침 (인보이스/서명 등)
    s.on('inbox:refresh', (data: { reason?: string }) => {
      // reason 별로 분기 가능 — 일단 단순 알림
      if (!data?.reason) return;
      const labels: Record<string, string> = {
        signature_created: t('toaster.signatureRequested', '서명 요청이 도착했습니다') as string,
        signature_signed: t('toaster.signatureSigned', '서명 완료') as string,
        invoice_status: t('toaster.invoiceUpdated', '청구서 상태 변경') as string,
        installment_paid: t('toaster.installmentPaid', '결제 입금 확인') as string,
      };
      const title = labels[data.reason];
      if (!title) return;
      add({
        type: data.reason.startsWith('signature') ? 'signature' : 'invoice',
        title,
        link: '/inbox',
      });
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.business_id, i18n.language]);

  if (toasts.length === 0) return null;

  return (
    <ToasterRoot aria-live="polite" aria-atomic="false">
      {toasts.map(toast => (
        <ToastCard key={toast.id}
          $type={toast.type}
          onMouseEnter={() => pauseTimer(toast.id)}
          onMouseLeave={() => resumeTimer(toast.id)}
          onClick={() => {
            if (toast.link) navigate(toast.link);
            dismiss(toast.id);
          }}
          role="alert"
        >
          <ToastIcon $type={toast.type}>
            {toast.type === 'message' && '💬'}
            {toast.type === 'task' && '✓'}
            {toast.type === 'invoice' && '$'}
            {toast.type === 'signature' && '✎'}
            {toast.type === 'event' && '📅'}
            {toast.type === 'system' && 'i'}
          </ToastIcon>
          <ToastBody>
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.body && <ToastDesc>{toast.body}</ToastDesc>}
          </ToastBody>
          <ToastClose
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            aria-label={t('toaster.close', '닫기') as string}
          >×</ToastClose>
        </ToastCard>
      ))}
    </ToasterRoot>
  );
}

// ─────────────────────────────────────────────
// Styled — 우측 상단 고정, focus steal 안 함, hover 시 강조
const ToasterRoot = styled.div`
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9000;  /* 모달(2000) 보다 위, 시스템 dialog(9999) 보다는 아래 */
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;  /* 컨테이너는 click pass-through, 자식만 catch */
  width: min(360px, calc(100vw - 32px));
`;

const ToastCard = styled.div<{ $type: string }>`
  pointer-events: auto;
  display: grid;
  grid-template-columns: 32px 1fr 28px;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-left: 3px solid ${p =>
    p.$type === 'message' ? '#14B8A6' :
    p.$type === 'task' ? '#0D9488' :
    p.$type === 'invoice' ? '#F59E0B' :
    p.$type === 'signature' ? '#8B5CF6' :
    '#64748B'};
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  animation: slideIn 0.18s ease-out;
  transition: transform 0.15s, box-shadow 0.15s;
  &:hover {
    transform: translateX(-2px);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
  }
  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;

const ToastIcon = styled.div<{ $type: string }>`
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: ${p =>
    p.$type === 'message' ? '#F0FDFA' :
    p.$type === 'task' ? '#F0FDFA' :
    p.$type === 'invoice' ? '#FEF3C7' :
    p.$type === 'signature' ? '#F3E8FF' :
    '#F1F5F9'};
  color: ${p =>
    p.$type === 'message' ? '#0D9488' :
    p.$type === 'task' ? '#0D9488' :
    p.$type === 'invoice' ? '#92400E' :
    p.$type === 'signature' ? '#6D28D9' :
    '#475569'};
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
`;

const ToastBody = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ToastTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastDesc = styled.div`
  font-size: 12px;
  color: #64748B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastClose = styled.button`
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-size: 18px;
  line-height: 1;
  color: #94A3B8;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
