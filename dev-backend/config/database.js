const { Sequelize } = require('sequelize');
require('dotenv').config();

if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('Required DB environment variables not set: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
  process.exit(1);
}

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'production' ? false : (msg) => {
      // ★ 쿼리 문자열 안의 단어로 거르면 안 된다 — `external_connections` 테이블을 읽는 평범한 SELECT 가
      //   전부 "DB Query Error" 로 찍혀(2026-09-30 실측 수백 줄) 진짜 오류를 덮었다. 드라이버 오류 표식만 본다.
      if (/\bER_[A-Z_]+|ETIMEDOUT|ECONNREFUSED|ECONNRESET|PROTOCOL_CONNECTION_LOST/.test(msg)) {
        console.error('DB Query Error:', msg);
      }
    },
    dialectOptions: {
      connectTimeout: 60000,
      multipleStatements: false,
      timezone: '+00:00',
      dateStrings: false,
      typeCast: true
    },
    pool: {
      max: 20,
      min: 2,
      acquire: 60000,
      idle: 10000,
      evict: 1000,
      handleDisconnects: true
    },
    retry: {
      match: [
        /ETIMEDOUT/,
        /EHOSTUNREACH/,
        /ECONNRESET/,
        /ECONNREFUSED/,
        /ESOCKETTIMEDOUT/,
        /EPIPE/,
        /EAI_AGAIN/,
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/,
        /Connection lost/,
        /Lost connection to MySQL server/,
        /MySQL server has gone away/,
        /Too many connections/,
        /ER_LOCK_WAIT_TIMEOUT/,
        /ER_LOCK_DEADLOCK/
      ],
      max: 5
    },
    query: { raw: false },
    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('MySQL connected successfully.');
    return true;
  } catch (error) {
    console.error('MySQL connection failed:', error.message);
    return false;
  }
};

testConnection();

module.exports = { sequelize, Sequelize, testConnection };
