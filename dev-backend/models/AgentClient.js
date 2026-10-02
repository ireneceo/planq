// AgentClient — 외부 AI 앱(ChatGPT·Claude 등)이 동적 등록(DCR, RFC 7591)한 OAuth 클라이언트 (#439).
//
//   PlanQ 가 **OAuth 2.1 인증 서버**가 되어 외부 AI 에게 토큰을 발급한다. 이 행은 «어떤 앱이 연결을 요청하는가» 다.
//   ★ redirect_uris 는 등록 때 **허용 호스트**(services/agent_oauth/providers)만 받는다 — 아무 주소나 등록되면
//     인가 코드를 남의 서버로 빼돌리는 문이 된다.
//   ★ client_secret(기밀 클라이언트일 때만)은 **암호화**해 둔다. SDK 의 클라이언트 인증이 평문 비교라 해시로는 못 둔다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AgentClient extends Model {}

AgentClient.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  client_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  client_name: { type: DataTypes.STRING(200), allowNull: true },
  redirect_uris: { type: DataTypes.JSON, allowNull: false },
  provider_hint: { type: DataTypes.STRING(20), allowNull: true },          // 'openai' | 'anthropic' — 허용 호스트에서 정한다
  token_endpoint_auth_method: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'none' },
  client_secret_enc: { type: DataTypes.TEXT, allowNull: true },           // 기밀 클라이언트만 — 암호화
  metadata: { type: DataTypes.JSON, allowNull: true },                    // 등록 요청 원본(화이트리스트 필드만)
  last_used_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'agent_clients', timestamps: true, underscored: true,
});

module.exports = AgentClient;
