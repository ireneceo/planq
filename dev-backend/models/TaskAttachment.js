const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskAttachment extends Model {}

TaskAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' } },
  comment_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'task_comments', key: 'id' } },
  // context (4종, 사이클 N+6 부터):
  //  'description'        : TipTap 에디터 인라인 이미지 (description 본문 안 그림)
  //  'description_attach' : description 영역 댓글식 첨부 칩 (의뢰자 영역, 결과물과 분리)
  //  'task'               : 결과물 영역 직첨부 (수행자 영역)
  //  'comment'            : 댓글 첨부 (댓글 안)
  context: { type: DataTypes.ENUM('description', 'description_attach', 'task', 'comment'), allowNull: false, defaultValue: 'task' },
  // 운영 #401 후속 (Irene 2026-08-31): "업무설명에 파일/문서 첨부 … 다른 거 있으면 다 체크"
  //   여태 이 표는 **파일만** 담을 수 있었다. 그런데 화면은 문서(post)도 고를 수 있게 열어 두고,
  //   고른 값을 서버로 보내지도 저장하지도 않았다 — 사용자에겐 "골랐는데 추가 버튼이 안 켜진다".
  //   문서를 붙이는 것은 실무에서 당연한 일이라(견적서·계약서를 업무에 건다) 표를 넓혀 완성한다.
  //   ★ 문서 첨부 행은 물리 파일이 없다. 그렇다고 NOT NULL 을 풀지 않는다 —
  //     allowNull 변경은 sync-database 가 운영에 반영하지 못해 dev 만 통과하는 함정이 된다
  //     (memory: feedback_dev_cannot_reproduce_prod_schema). 대신 **값으로** 처리한다:
  //     original_name = 문서 제목 · stored_name/file_path = '' · file_size = 0 ·
  //     mime_type = POST_MIME. 판별은 post_id 로 한다.
  post_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'posts', key: 'id' } },
  original_name: { type: DataTypes.STRING(500), allowNull: false },
  stored_name: { type: DataTypes.STRING(255), allowNull: false },
  file_path: { type: DataTypes.STRING(500), allowNull: false },
  file_size: { type: DataTypes.BIGINT, allowNull: false },
  mime_type: { type: DataTypes.STRING(100), allowNull: true },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  // 's3' 누락 잠복버그 — link 라우트가 File.storage_provider 를 그대로 복사하는데 File 은 s3 를 쓸 수 있다.
  // ENUM 에 없으면 S3 파일을 업무에 연결하는 순간 저장이 깨진다. (모델=SSOT, sync 가 다시 벗기지 않게 append)
  storage_provider: { type: DataTypes.ENUM('planq', 'gdrive', 's3'), allowNull: false, defaultValue: 'planq' },
  external_id: { type: DataTypes.STRING(255), allowNull: true },
  external_url: { type: DataTypes.STRING(500), allowNull: true },
}, {
  sequelize,
  tableName: 'task_attachments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
});

module.exports = TaskAttachment;
