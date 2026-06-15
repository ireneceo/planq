// 프로젝트에 초대됐지만 워크스페이스 Client 행이 없는 ProjectClient 백필 (멱등).
// 옛 버그: 미가입 이메일 초대 시 ProjectClient 만 생기고 Client 행 누락 → 청구서 고객목록 미노출.
// 실행: 백엔드 디렉터리에서  node /opt/planq/scripts/backfill-project-clients.js
const path = require('path');
const cwd = process.cwd();
const { sequelize } = require(path.join(cwd, 'config/database'));
const { ProjectClient, Project, Client } = require(path.join(cwd, 'models'));
(async () => {
  const rows = await ProjectClient.findAll({ where: { client_id: null } });
  console.log(`client_id 없는 ProjectClient: ${rows.length}건`);
  let created = 0, linked = 0, skipped = 0;
  for (const pc of rows) {
    const proj = await Project.findByPk(pc.project_id, { attributes: ['id', 'business_id'] });
    if (!proj) { skipped++; continue; }
    const bizId = proj.business_id;
    let client = null;
    if (pc.contact_user_id) client = await Client.findOne({ where: { business_id: bizId, user_id: pc.contact_user_id } });
    if (!client && pc.contact_email) client = await Client.findOne({ where: { business_id: bizId, invite_email: pc.contact_email } });
    if (!client) {
      client = await Client.create({
        business_id: bizId,
        user_id: pc.contact_user_id || null,
        invite_email: pc.contact_email || null,
        display_name: pc.contact_name || (pc.contact_email ? pc.contact_email.split('@')[0] : '고객'),
        status: 'invited',
        invited_by: pc.invited_by || null,
        invited_at: pc.invited_at || pc.created_at || new Date(),
      });
      created++;
    } else { linked++; }
    await pc.update({ client_id: client.id });
  }
  console.log(`백필 완료 — Client 생성:${created} 기존연결:${linked} 스킵:${skipped}`);
  await sequelize.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
