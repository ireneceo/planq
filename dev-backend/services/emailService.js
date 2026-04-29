const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('SMTP not configured. Email sending disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  return transporter;
};

// sendEmail — 첨부 + 발신자 표시이름 + 회신주소 옵션
//   { to, subject, html, attachments?, fromName?, replyTo? }
//   attachments: [{ filename, content (Buffer), contentType }]
const sendEmail = async ({ to, subject, html, attachments, fromName, replyTo }) => {
  const transport = getTransporter();
  if (!transport) {
    console.warn(`Email skipped (no SMTP): to=${to}, subject=${subject}`);
    return false;
  }

  // 발신자: workspace 의 mail_from_name 있으면 "표시이름 <from-addr>" 형식
  const fromAddr = process.env.SMTP_FROM || 'noreply@planq.kr';
  const from = fromName ? `"${String(fromName).replace(/"/g, '')}" <${fromAddr}>` : fromAddr;

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    return true;
  } catch (error) {
    console.error('Email send failed:', error.message);
    return false;
  }
};

// ─── 초대 이메일 템플릿 ───
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

function inviteEmailHtml({ workspaceName, inviterName, targetName, kind, contextName, inviteUrl }) {
  // kind: 'project' | 'workspace_client' | 'workspace_member'
  const roleLine = kind === 'workspace_member'
    ? `에서 팀원으로 초대하셨습니다.`
    : kind === 'workspace_client'
      ? `에 고객으로 초대하셨습니다.`
      : `의 프로젝트 <b>${escapeHtml(contextName || '')}</b> 에 고객으로 초대하셨습니다.`;
  return `
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>PlanQ 초대</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.05);max-width:480px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="font-size:22px;font-weight:800;color:#0D9488;letter-spacing:-0.5px;">PlanQ</div>
        </td></tr>
        <tr><td style="padding:24px 0 8px;">
          <div style="font-size:14px;color:#64748B;">안녕하세요${targetName ? ` ${escapeHtml(targetName)}님` : ''},</div>
        </td></tr>
        <tr><td style="padding-bottom:8px;">
          <div style="font-size:15px;line-height:1.6;color:#0F172A;">
            <b>${escapeHtml(inviterName || '')}</b> 님이 <b>${escapeHtml(workspaceName || '')}</b> 워크스페이스${roleLine}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;background:#0D9488;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">초대 수락하기</a>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #E2E8F0;">
          <div style="font-size:12px;color:#94A3B8;line-height:1.5;">
            버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여 넣어주세요:<br>
            <span style="color:#64748B;word-break:break-all;">${inviteUrl}</span><br><br>
            이 초대 링크는 <b>30일</b> 동안 유효합니다. 본인이 아니라면 이 메일은 무시해 주세요.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c]));
}

async function sendInviteEmail({ to, workspaceName, inviterName, targetName, kind, contextName, token }) {
  if (!to) return false;
  const inviteUrl = `${APP_URL}/invite/${token}`;
  const subject = kind === 'workspace_member'
    ? `${inviterName || ''}님이 ${workspaceName} 팀에 초대했습니다`
    : `${inviterName || ''}님이 ${workspaceName}${contextName ? ` · ${contextName}` : ''} 에 초대했습니다`;
  return sendEmail({ to, subject, html: inviteEmailHtml({ workspaceName, inviterName, targetName, kind, contextName, inviteUrl }) });
}

// ─── 문서 공유 이메일 ───
function postShareEmailHtml({ docTitle, senderName, workspaceName, message, shareUrl }) {
  return `
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.05);max-width:520px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="font-size:22px;font-weight:800;color:#0D9488;letter-spacing:-0.5px;">PlanQ</div>
        </td></tr>
        <tr><td style="padding:24px 0 8px;">
          <div style="font-size:14px;color:#64748B;">
            <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` (${escapeHtml(workspaceName)})` : ''}님이 문서를 공유했습니다.
          </div>
        </td></tr>
        <tr><td style="padding:8px 0 4px;">
          <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(docTitle)}</div>
        </td></tr>
        ${message ? `
        <tr><td style="padding:12px 0 4px;">
          <div style="font-size:13px;color:#334155;line-height:1.6;background:#F8FAFC;border-left:3px solid #14B8A6;padding:12px 14px;border-radius:0 8px 8px 0;white-space:pre-wrap;">${escapeHtml(message)}</div>
        </td></tr>` : ''}
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${shareUrl}" style="display:inline-block;padding:14px 28px;background:#0D9488;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">문서 보기</a>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #E2E8F0;">
          <div style="font-size:12px;color:#94A3B8;line-height:1.5;">
            버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여 넣어주세요:<br>
            <span style="color:#64748B;word-break:break-all;">${shareUrl}</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendPostShareEmail({ to, docTitle, senderName, workspaceName, message, shareUrl }) {
  if (!to) return false;
  const subject = `[PlanQ] ${senderName || ''}님이 "${docTitle}" 문서를 공유했습니다`;
  return sendEmail({ to, subject, html: postShareEmailHtml({ docTitle, senderName, workspaceName, message, shareUrl }) });
}

// ─── 서명 요청 이메일 ───
function signatureRequestEmailHtml({ docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }) {
  const expireStr = expiresAt ? new Date(expiresAt).toLocaleDateString('ko-KR') : '';
  return `
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>서명 요청 — ${escapeHtml(docTitle)}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.05);max-width:520px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="font-size:22px;font-weight:800;color:#0D9488;letter-spacing:-0.5px;">PlanQ</div>
        </td></tr>
        <tr><td style="padding:24px 0 8px;">
          <div style="font-size:14px;color:#64748B;">
            안녕하세요${signerName ? ` ${escapeHtml(signerName)}님` : ''}, <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` (${escapeHtml(workspaceName)})` : ''}님이 서명을 요청했습니다.
          </div>
        </td></tr>
        <tr><td style="padding:8px 0 4px;">
          <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(docTitle)}</div>
        </td></tr>
        ${message ? `
        <tr><td style="padding:12px 0 4px;">
          <div style="font-size:13px;color:#334155;line-height:1.6;background:#F8FAFC;border-left:3px solid #14B8A6;padding:12px 14px;border-radius:0 8px 8px 0;white-space:pre-wrap;">${escapeHtml(message)}</div>
        </td></tr>` : ''}
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${signUrl}" style="display:inline-block;padding:14px 28px;background:#0D9488;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">문서 검토 및 서명하기</a>
        </td></tr>
        <tr><td style="padding-top:16px;">
          <div style="font-size:12px;color:#64748B;line-height:1.6;">
            서명 절차: ① 문서 검토 → ② 이메일 인증 코드 입력 → ③ 서명 → ④ 동의 확인<br>
            ${expireStr ? `이 요청은 <b>${expireStr}</b>까지 유효합니다.` : ''}
          </div>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #E2E8F0;">
          <div style="font-size:11px;color:#94A3B8;line-height:1.5;">
            버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여 넣어주세요:<br>
            <span style="color:#64748B;word-break:break-all;">${signUrl}</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendSignatureRequestEmail({ to, docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }) {
  if (!to) return false;
  const subject = `[PlanQ] 서명 요청 — "${docTitle}"`;
  return sendEmail({ to, subject, html: signatureRequestEmailHtml({ docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }) });
}

// ─── OTP 이메일 ───
function otpEmailHtml({ docTitle, code }) {
  return `
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>PlanQ 서명 인증</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="440" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.05);max-width:440px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="font-size:22px;font-weight:800;color:#0D9488;letter-spacing:-0.5px;">PlanQ</div>
        </td></tr>
        <tr><td style="padding:20px 0 4px;">
          <div style="font-size:14px;color:#334155;line-height:1.6;">
            <b>${escapeHtml(docTitle)}</b> 서명 본인 확인 인증 코드입니다.
          </div>
        </td></tr>
        <tr><td align="center" style="padding:20px 0;">
          <div style="display:inline-block;padding:18px 36px;background:#F0FDFA;border:1px solid #14B8A6;border-radius:12px;font-size:32px;font-weight:800;letter-spacing:8px;color:#0F766E;">${escapeHtml(code)}</div>
        </td></tr>
        <tr><td style="padding-top:8px;">
          <div style="font-size:12px;color:#64748B;line-height:1.6;">
            인증 코드는 <b>5분간</b> 유효합니다.<br>
            본인이 요청하지 않은 경우 이 메일을 무시해 주세요.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendSignatureOtpEmail({ to, docTitle, code }) {
  if (!to) return false;
  const subject = `[PlanQ] 서명 인증 코드 ${code}`;
  return sendEmail({ to, subject, html: otpEmailHtml({ docTitle, code }) });
}

// ─── 청구서 발송 이메일 ───
function invoiceEmailHtml({ invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl }) {
  const totalStr = currency === 'KRW'
    ? `₩${Number(total).toLocaleString('ko-KR')}`
    : `${currency} ${Number(total).toLocaleString('en-US')}`;
  const dueStr = dueDate ? new Date(dueDate).toISOString().split('T')[0] : '';
  return `
<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>청구서 — ${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.05);max-width:520px;">
        <tr><td align="center" style="padding-bottom:8px;">
          <div style="font-size:22px;font-weight:800;color:#0D9488;letter-spacing:-0.5px;">PlanQ</div>
        </td></tr>
        <tr><td style="padding:24px 0 8px;">
          <div style="font-size:14px;color:#64748B;">
            <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` (${escapeHtml(workspaceName)})` : ''}님이 청구서를 보냈습니다.
          </div>
        </td></tr>
        <tr><td style="padding:8px 0 4px;">
          <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:0.4px;">${escapeHtml(invoiceNumber)}</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;margin-top:4px;">${escapeHtml(title)}</div>
        </td></tr>
        <tr><td style="padding:16px 0 4px;">
          <div style="background:#F8FAFC;border-radius:10px;padding:14px 16px;">
            <div style="font-size:11px;color:#64748B;margin-bottom:4px;">총액</div>
            <div style="font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;">${totalStr}</div>
            ${dueStr ? `<div style="font-size:12px;color:#92400E;margin-top:6px;">결제 기한 ${dueStr}</div>` : ''}
          </div>
        </td></tr>
        ${message ? `
        <tr><td style="padding:12px 0 4px;">
          <div style="font-size:13px;color:#334155;line-height:1.6;background:#F8FAFC;border-left:3px solid #14B8A6;padding:12px 14px;border-radius:0 8px 8px 0;white-space:pre-wrap;">${escapeHtml(message)}</div>
        </td></tr>` : ''}
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${shareUrl}" style="display:inline-block;padding:14px 28px;background:#0D9488;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">청구서 보기 · 입금 안내</a>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #E2E8F0;">
          <div style="font-size:11px;color:#94A3B8;line-height:1.5;">
            버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여 넣어주세요:<br>
            <span style="color:#64748B;word-break:break-all;">${shareUrl}</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendInvoiceEmail({ to, invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl, attachments, fromName, replyTo }) {
  if (!to) return false;
  const subject = `[PlanQ] 청구서 — ${invoiceNumber} ${title}`;
  return sendEmail({
    to, subject,
    html: invoiceEmailHtml({ invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl }),
    attachments, fromName, replyTo,
  });
}

// ─── 이메일 변경 OTP (P-1.5) ───
function verificationCodeEmailHtml({ code, ttlMinutes, userName }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:32px;">
        <tr><td>
          <div style="font-size:13px;color:#64748B;letter-spacing:1px;text-transform:uppercase;font-weight:700;">PlanQ</div>
          <h1 style="margin:8px 0 16px;font-size:20px;color:#0F172A;font-weight:700;">이메일 변경 확인 코드</h1>
          <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;">
            ${userName ? escapeHtml(userName) + '님, ' : ''}새 이메일 주소로 변경하기 위한 확인 코드입니다. 아래 코드를 입력해 주세요.
          </p>
          <div style="margin:24px 0;padding:20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;text-align:center;">
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0F172A;font-family:monospace;">${escapeHtml(code)}</div>
          </div>
          <p style="margin:0;font-size:12px;color:#94A3B8;line-height:1.6;">
            이 코드는 ${ttlMinutes}분 동안 유효합니다. 본인이 요청한 게 아니면 이 메일을 무시하세요.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendVerificationCodeEmail({ to, code, ttlMinutes = 10, userName = '' }) {
  if (!to || !code) return false;
  return sendEmail({
    to,
    subject: `[PlanQ] 이메일 변경 코드 ${code}`,
    html: verificationCodeEmailHtml({ code, ttlMinutes, userName }),
  });
}

module.exports = { sendEmail, sendInviteEmail, sendPostShareEmail, sendSignatureRequestEmail, sendSignatureOtpEmail, sendInvoiceEmail, sendVerificationCodeEmail };
