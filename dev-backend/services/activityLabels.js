// 활동 기록 «관리 행위» 표 — 감사 action → 화면 라벨 키 · 대표가 보는 «관리 행위만» 범위에 드는가.
//   docs/ORG_STAGE0_DESIGN.md 9절 6(Fable 2026-10-22). 패턴이 아니라 **명시 목록**이다 —
//   모르는 action 은 «관리 행위만» 에서 빠지고(fail-closed), «전체» 에서는 코드 그대로 보인다.
//   새 관리 행위 감사를 만들면 여기 한 줄 + i18n org.activity.label.<라벨> 을 더한다.
//   ★ 항목 이름(업무 제목 등)은 싣지 않는다 — 감사 old/new 값에 «나만 보기» 제목이 있을 수 있다(D2).
//     사람·부서·역할 대상만 target_label 을 붙인다(비밀이 아니다).

const L = (label, extra = {}) => ({ label, admin: true, ...extra });

const TABLE = {
  // 사람
  'business_member.invite': L('member_invite'),
  'invite.accept': L('member_join'),
  'business_member.remove': L('member_remove'),
  'business_member.handover': L('member_handover'),
  'member.default_role_change': L('member_role'),
  'member_role.change': L('member_role'),
  'member_permission.update': L('member_permission'),
  'member.rate.update': L('member_rate'),
  'member.work_hours_change': L('member_hours'),
  'member_role.create': L('role_dict'), 'member_role.delete': L('role_dict'),
  'member_role.rename': L('role_dict'), 'member_role.reorder': L('role_dict'),
  'org.department_create': L('org_change'), 'org.department_update': L('org_change'), 'org.department_delete': L('org_change'),
  'org.team_create': L('org_change'), 'org.team_update': L('org_change'), 'org.team_delete': L('org_change'),
  'org.member_assign': L('org_change'),
  'leave.approve': L('leave_decision'), 'leave.reject': L('leave_decision'), 'leave.grant': L('leave_decision'),
  'project.members.replace': L('access_change'),
  'conversation.participant_add': L('access_change'), 'conversation.participant_remove': L('access_change'),
  // 워크스페이스 설정·요금
  'business.update': L('workspace_settings'), 'business.settings_update': L('workspace_settings'),
  'business.permissions_updated': L('workspace_settings'), 'business.mail_settings_update': L('workspace_settings'),
  'business.report_settings_update': L('workspace_settings'), 'business.holiday_country_update': L('workspace_settings'),
  'business.default_billing_owner.update': L('workspace_settings'), 'business.card_payees.update': L('workspace_settings'),
  'business.stripe_settings.update': L('workspace_settings'), 'business.storage_change': L('workspace_settings'),
  'business.symbol_upload': L('workspace_settings'), 'workspace.brand_update': L('workspace_settings'),
  'workspace.legal_update': L('workspace_settings'), 'customer_entry.update': L('workspace_settings'),
  'sales_intake.update': L('workspace_settings'), 'mail_criteria.update': L('workspace_settings'),
  'mail_domain_rule.create': L('workspace_settings'), 'mail_domain_rule.update': L('workspace_settings'), 'mail_domain_rule.delete': L('workspace_settings'),
  'mail_alias.create': L('workspace_settings'), 'mail_alias.update': L('workspace_settings'), 'mail_alias.delete': L('workspace_settings'),
  'business.module_toggle': L('module_toggle'),
  'business.transfer_ownership': L('ownership_transfer'),
  'plan.upgrade': L('plan_change'), 'plan.downgrade_schedule': L('plan_change'), 'plan.cancel_schedule': L('plan_change'),
  'plan.trial_start': L('plan_change'), 'plan.trial_plan_change': L('plan_change'),
  'subscription.checkout': L('plan_change'), 'subscription.stripe_checkout': L('plan_change'),
  'addon.apply': L('plan_change'), 'addon.cancel': L('plan_change'),
  'payment.refund_requested': L('refund'), 'payment.refund_request_canceled': L('refund'),
  'data.export.workspace': L('data_export'), 'data_export.request': L('data_export'), 'data.transfer_job.create': L('data_export'),
  // 연결
  'agent_client.register': L('ai_api'), 'api_token.create': L('ai_api'), 'api_token.revoke': L('ai_api'),
  'cloud.connect': L('integration'), 'cloud.disconnect': L('integration'),
  'email_account.create': L('integration'), 'email_account.disconnect': L('integration'),
  'external_connection.connect': L('integration'), 'external_connection.disconnect': L('integration'),
  'oauth_connection.connect': L('integration'), 'oauth_connection.disconnect': L('integration'),
  'mail.spam_purge': L('spam_purge'),
  // 삭제(책임 소재 — 2026-08-31 Irene «삭제하고 문제되면 책임여부»)
  'task.delete': L('delete'), 'task_attachment.delete': L('delete'), 'task_comment.delete': L('delete'),
  'post.delete': L('delete'), 'post.comment_delete': L('delete'),
  'file.delete': L('delete'), 'file.bulk_delete': L('delete'), 'file.purge': L('purge'), 'file.trash_empty': L('purge'),
  'file_folder.delete': L('delete'), 'project.delete': L('delete'), 'project_note.delete': L('delete'),
  'conversation.delete': L('delete'), 'message.delete': L('delete'), 'client.deleted': L('delete'),
  'invoice.delete': L('delete'), 'event.deleted': L('delete'), 'kb.document_delete': L('delete'),
  'record.delete': L('delete'), 'workspace_weekly_report.delete': L('delete'),
  // 밖으로 여는 것·범위
  'task.share_create': L('share_create'), 'post.share_create': L('share_create'), 'file.share_create': L('share_create'),
  'file.share_link_create': L('share_create'), 'kb.share_create': L('share_create'), 'kb.share_bundle_create': L('share_create'),
  'event.share_create': L('share_create'), 'document.share': L('share_create'), 'post.share_email': L('share_create'),
  'share.email': L('share_create'),
  'task.share_revoke': L('share_revoke'), 'post.share_revoke': L('share_revoke'), 'file.share_revoke': L('share_revoke'),
  'file.share_link_revoke': L('share_revoke'), 'kb.share_revoke': L('share_revoke'), 'kb.share_bundle_revoke': L('share_revoke'),
  'event.share_revoke': L('share_revoke'), 'document.share_revoke': L('share_revoke'), 'guest_link.revoke': L('share_revoke'),
  'file.visibility_change': L('visibility_change'), 'post.visibility_change': L('visibility_change'),
  'file.security_level_change': L('security_level'), 'post.security_level_change': L('security_level'),
  'kb.security_level_change': L('security_level'), 'document.security_level_change': L('security_level'),
  // 급여 — 급여 담당(대표 + 지정)만 본다(admin 자동 아님, services/payrollAccess)
  'payroll.run_confirm': L('payroll', { payroll: true }), 'payroll.run_paid': L('payroll', { payroll: true }),
  'payroll.run_export': L('payroll', { payroll: true }), 'payroll.run_delete': L('payroll', { payroll: true }),
  'payroll.managers_update': L('payroll', { payroll: true }), 'payroll.bank_account_view': L('payroll', { payroll: true }),
  'payroll.contract_delete': L('payroll', { payroll: true }), 'payroll.person_delete': L('payroll', { payroll: true }),
  'payroll.item_delete': L('payroll', { payroll: true }),
};

/** «관리 행위만» 범위에 드는 action 목록(급여는 보는 사람이 급여 담당일 때만). */
function adminActions({ includePayroll = false } = {}) {
  return Object.entries(TABLE).filter(([, v]) => v.admin && (includePayroll || !v.payroll)).map(([k]) => k);
}

function labelOf(action) { return TABLE[action]?.label || null; }
function isPayrollAction(action) { return String(action || '').startsWith('payroll.'); }

module.exports = { adminActions, labelOf, isPayrollAction, TABLE };
