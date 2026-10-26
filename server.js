const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'Public')));


// PostgreSQL 連線設定 (結合您提供的連線參數與時區設定)
let dbUrl = process.env.DATABASE_URL || 'postgresql://root:123@db:5432/LV';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 移除強制 SSL，改為如果連線字串有需要才啟用，或者直接關閉
  ssl: false,
  options: '-c timezone=Asia/Taipei'
});


// ==========================================
// 初始化資料庫與預設職業表
// ==========================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        line_user_id VARCHAR(255) PRIMARY KEY,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255) NOT NULL,
        line_display_name VARCHAR(255),
        allow_search VARCHAR(10) DEFAULT 'N',
        joined_line_group VARCHAR(10) DEFAULT 'N',
        joined_dc VARCHAR(10) DEFAULT 'N',
        account_status VARCHAR(50) DEFAULT '待審核',
        guild_role VARCHAR(50) DEFAULT '現任',
        team_group VARCHAR(255) DEFAULT '',
        dcid VARCHAR(255),
        tw VARCHAR(10) DEFAULT 'Y',
        update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS member_audit_logs (
        id SERIAL PRIMARY KEY,
        line_user_id VARCHAR(255) NOT NULL,
        field VARCHAR(255) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS groups (
        group_name VARCHAR(255) PRIMARY KEY,
        group_status VARCHAR(50) DEFAULT '活躍',
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leaves (
        leave_id VARCHAR(255) PRIMARY KEY,
        leave_date VARCHAR(50) NOT NULL,
        leave_event VARCHAR(255) NOT NULL,
        target_uid VARCHAR(255) NOT NULL,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255),
        leave_reason TEXT NOT NULL,
        is_urgent VARCHAR(10) DEFAULT 'N',
        operator_uid VARCHAR(255),
        operator_name VARCHAR(255),
        submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leave_rules (
        event VARCHAR(255) PRIMARY KEY,
        latest_time VARCHAR(50) NOT NULL,
        cycle VARCHAR(100) DEFAULT '',
        enabled INT DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        date VARCHAR(50) NOT NULL,
        time VARCHAR(50) NOT NULL,
        signup_start VARCHAR(50),
        signup_end VARCHAR(50),
        max_limit INT DEFAULT 0,
        status VARCHAR(50) DEFAULT '報名中',
        is_archived INT DEFAULT 0,
        description TEXT,
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
        CREATE TABLE IF NOT EXISTS event_attendees (
        id SERIAL PRIMARY KEY,
        event_id VARCHAR(255) NOT NULL,
        line_user_id VARCHAR(255) NOT NULL,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255) NOT NULL,
        signup_time VARCHAR(50) NOT NULL,
        note TEXT DEFAULT '',
        CONSTRAINT unique_event_user UNIQUE (event_id, line_user_id)
     );



      CREATE TABLE IF NOT EXISTS broadcast_schedules (
        broadcast_id VARCHAR(255) PRIMARY KEY,
        item VARCHAR(255) NOT NULL,
        freq VARCHAR(50) NOT NULL,
        cycle VARCHAR(100),
        time VARCHAR(50),
        content TEXT NOT NULL,
        active INT DEFAULT 1
      );
      
      -- 公告主表
  CREATE TABLE IF NOT EXISTS bulletins (
    post_id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(50) NOT NULL DEFAULT '重要公告',
    title VARCHAR(255) NOT NULL,
    image_urls TEXT,
    content TEXT NOT NULL,
    link_text VARCHAR(100),
    link_url TEXT,
    is_pinned INT DEFAULT 0, -- 1 代表置頂，0 代表一般
    author VARCHAR(100) NOT NULL,
    date VARCHAR(50) NOT NULL
);

-- 公告已閱紀錄表
    CREATE TABLE IF NOT EXISTS bulletin_reads (
    post_id VARCHAR(50) REFERENCES bulletins(post_id) ON DELETE CASCADE,
    line_user_id VARCHAR(100) NOT NULL,
    game_nickname VARCHAR(100) NOT NULL,
    game_class VARCHAR(100) NOT NULL,
    read_time VARCHAR(50) NOT NULL,
    PRIMARY KEY (post_id, line_user_id)
);


      CREATE TABLE IF NOT EXISTS system_configs (
        config_key VARCHAR(255) PRIMARY KEY,
        config_value TEXT
      );

      CREATE TABLE IF NOT EXISTS game_classes (
        class_name VARCHAR(255) PRIMARY KEY,
        sort_order INT DEFAULT 0,
        color_theme VARCHAR(50) DEFAULT 'red',
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 自動初始化預設職業進 game_classes (若表內無資料)
    const classCheck = await client.query('SELECT COUNT(*) FROM game_classes');
    if (parseInt(classCheck.rows[0].count) === 0) {
      const defaultClasses = [
        "超魔導士", "學者（智者）", "神射手", "搞笑藝人（詩人）", 
        "冷豔舞姬（舞孃）", "騎士領主", "聖殿十字軍", "十字刺客", 
        "神行（神偷）", "神官（大主教）", "武術宗師", "神工匠", "創造者（鍊金術士）"
      ];
      for (let i = 0; i < defaultClasses.length; i++) {
        await client.query(
          'INSERT INTO game_classes (class_name, sort_order) VALUES ($1, $2) ON CONFLICT (class_name) DO NOTHING',
          [defaultClasses[i], i]
        );
      }
      console.log('[Database] 預設職業已成功寫入 game_classes！');
    }

    console.log('[Database] 資料庫與所有擴充表初始化完畢！');
  } catch (err) {
    console.error('[Database] 建表失敗:', err);
  } finally {
    client.release();
  }
}

initDatabase();

app.get('/', (req, res) => { res.json({ status: 'success', message: 'GuildMaster 後台服務運作中！' }); });
app.get('/api/health', (req, res) => { res.json({ status: 'success', message: 'GuildMaster PostgreSQL 後台運行中！' }); });


// ==========================================
// 公開查詢 API 放在最前面（避免被 :uid 攔截）
// ==========================================
app.get('/api/members/search', async (req, res) => {
  const keyword = (req.query.q || '').trim();
  if (!keyword) {
    return res.json({ status: "success", data: [] });
  }

  try {
    const query = `
      SELECT * FROM members 
      WHERE account_status = '已審核' 
        AND allow_search = 'Y' 
        AND (game_nickname ILIKE $1 OR line_display_name ILIKE $1)
      ORDER BY update_time DESC 
      LIMIT 20
    `;
    const result = await pool.query(query, [`%${keyword}%`]);
    
    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id,
      gameNickname: m.game_nickname,
      gameClass: m.game_class,
      lineDisplayName: m.line_display_name,
      allowSearch: m.allow_search,
      accountStatus: m.account_status,
      guildRole: m.guild_role
    }));

    res.json({ status: "success", data: members });
  } catch (err) {
    console.error('[Database] 搜尋會員失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});


// ==========================================
// 會員相關 API
// ==========================================
// 1. 查詢單一會員資料
app.get('/api/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    const result = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [lineUserId]);
    if (result.rows.length > 0) {
      const member = result.rows[0];
      res.json({
        status: "found",
        gameNickname: member.game_nickname,
        gameClass: member.game_class,
        lineDisplayName: member.line_display_name,
        allowSearch: member.allow_search || 'N',
        joinedLineGroup: member.joined_line_group || 'N',
        joinedDc: member.joined_dc || 'N',
        guildRole: member.guild_role,
        accountStatus: member.account_status,
        account_status: member.account_status,
        guild_role: member.guild_role,
        tw: member.tw || 'Y',
        dcid: member.dcid || ''
      });
    } else {
      res.json({ status: "not_found" });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 2. 會員前台登記 / 更新資料 (已修正缺少反引號的語法錯誤)
app.post('/api/members/bind', async (req, res) => {
  const { lineUserId, lineDisplayName, gameNickname, gameClass, allowSearch, tw, dcid } = req.body;
  if (!lineUserId || !gameNickname || !gameClass) {
    return res.status(400).json({ status: "error", message: "缺少必要欄位" });
  }
  try {
    const oldRes = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [lineUserId]);
    const oldMember = oldRes.rows[0];
    const newAccountStatus = (oldMember && oldMember.account_status === '已審核') ? '已審核' : '待審核';

    const finalTw = oldMember ? (oldMember.tw || 'Y') : (tw || 'Y');
    const finalDcid = oldMember ? (oldMember.dcid || dcid || null) : (dcid || null);

    await pool.query(`
      INSERT INTO members (line_user_id, game_nickname, game_class, line_display_name, allow_search, account_status, tw, dcid, update_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET 
        game_nickname = EXCLUDED.game_nickname, 
        game_class = EXCLUDED.game_class, 
        line_display_name = EXCLUDED.line_display_name, 
        allow_search = EXCLUDED.allow_search, 
        account_status = $6, 
        update_time = CURRENT_TIMESTAMP
    `, [lineUserId, gameNickname, gameClass, lineDisplayName, allowSearch || 'N', newAccountStatus, finalTw, finalDcid]);

    if (!oldMember) {
      await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '新會員註冊', '-', `${gameNickname} (${gameClass})`]);
    } else {
      if (oldMember.game_nickname !== gameNickname) {
        await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '遊戲暱稱', oldMember.game_nickname, gameNickname]);
      }
      if (oldMember.game_class !== gameClass) {
        await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '遊戲職業', oldMember.game_class, gameClass]);
      }
    }
    res.json({ status: "success", message: "會員資料已成功更新" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 3. 幹部後台會員清單
app.get('/api/admin/members', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM members ORDER BY update_time DESC');
    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id,
      gameNickname: m.game_nickname,
      gameClass: m.game_class,
      lineDisplayName: m.line_display_name,
      allowSearch: m.allow_search || 'N',
      joinedLineGroup: m.joined_line_group || 'N',
      joinedDc: m.joined_dc || 'N',
      accountStatus: m.account_status,
      guildRole: m.guild_role,
      teamGroup: m.team_group,
      tw: m.tw || 'Y',
      dcid: m.dcid || '',
      updateTime: m.update_time
    }));
    res.json({ status: "success", members });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 4. 幹部審核與狀態修改
app.post('/api/admin/members/status', async (req, res) => {
  const { lineUserId, accountStatus, guildRole } = req.body;
  try {
    await pool.query('UPDATE members SET account_status = $1, guild_role = $2, update_time = CURRENT_TIMESTAMP WHERE line_user_id = $3', [accountStatus, guildRole, lineUserId]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 5. 幹部編輯 / 新增會員 (已修正缺少反引號的語法錯誤)
app.post('/api/admin/members/save', async (req, res) => {
  const {
    lineUserId, gameNickname, gameClass, lineDisplayName,
    guildRole, teamGroup, accountStatus, joinedLineGroup,
    joinedDc, tw, dcid
  } = req.body;
  try {
    await pool.query(`
      INSERT INTO members (
        line_user_id, game_nickname, game_class, line_display_name, 
        guild_role, team_group, account_status, joined_line_group, 
        joined_dc, tw, dcid, update_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET 
        game_nickname = EXCLUDED.game_nickname, 
        game_class = EXCLUDED.game_class, 
        line_display_name = EXCLUDED.line_display_name, 
        guild_role = EXCLUDED.guild_role, 
        team_group = EXCLUDED.team_group, 
        account_status = EXCLUDED.account_status, 
        joined_line_group = EXCLUDED.joined_line_group, 
        joined_dc = EXCLUDED.joined_dc,
        tw = COALESCE(EXCLUDED.tw, members.tw, 'Y'),
        dcid = COALESCE(EXCLUDED.dcid, members.dcid),
        update_time = CURRENT_TIMESTAMP
    `, [
      lineUserId, gameNickname, gameClass, lineDisplayName,
      guildRole, teamGroup, accountStatus,
      joinedLineGroup || 'N', joinedDc || 'N',
      tw || 'Y', dcid || null
    ]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 6. 會員修改紀錄
app.get('/api/admin/members/logs/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    const result = await pool.query("SELECT field, old_value, TO_CHAR(update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time, new_value FROM member_audit_logs WHERE line_user_id = $1 ORDER BY update_time DESC", [lineUserId]);
    const logs = result.rows.map(l => ({ field: l.field, oldValue: l.old_value, newValue: l.new_value, updateTime: l.update_time }));
    res.json({ status: "success", logs });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 7. 刪除會員
app.delete('/api/admin/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    await pool.query('DELETE FROM members WHERE line_user_id = $1', [lineUserId]);
    await pool.query('DELETE FROM member_audit_logs WHERE line_user_id = $1', [lineUserId]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 1. 發起 Discord 授權跳轉（支援帶入 uid 作為 state）
app.get('/api/auth/discord', (req, res) => {
  const fromUid = req.query.uid || 'login_only';
  const state = encodeURIComponent(fromUid); // 👈 關鍵：將 LINE UID 放入 state
  const scope = encodeURIComponent('identify guilds guilds.join');
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&scope=${scope}&state=${state}`;
  res.redirect(authUrl);
});

// 2. 接收 Discord 授權回調
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("授權失敗：未取得驗證碼");

  try {
    // A. 交換 Token
    const tokenParams = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DISCORD_REDIRECT_URI,
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      throw new Error(`Token 交換失敗: ${errTxt}`);
    }

    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;

    // B. 取得 Discord 個人身分
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${userAccessToken}` }
    });
    const dcUser = await userRes.json();
    const dcId = String(dcUser.id);
    const dcName = dcUser.global_name || dcUser.username;
    const dcAvatar = dcUser.avatar
      ? `https://cdn.discordapp.com/avatars/${dcId}/${dcUser.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    // C. 自動拉進 Discord 伺服器 (台灣與大陸成員都適用)
    try {
      await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ access_token: userAccessToken })
      });
      console.log(`[Discord] 已自動將成員 ${dcName} (${dcId}) 拉進公會伺服器`);
    } catch (botErr) {
      console.warn('[Discord 自動加群異常]:', botErr.message);
    }

    // D. 判斷來源身分：是台灣成員從 LINE 綁定，還是大陸成員登入？
    const targetLineUid = state ? decodeURIComponent(state) : 'login_only';

    if (targetLineUid && targetLineUid !== 'login_only') {
      // ----------------------------------------------------
      // 【情境一：台灣成員從 LINE 系統加綁 DC】
      // ----------------------------------------------------
      // 檢查此 DC 帳號是否已經被其他成員綁定過
      const duplicateCheck = await pool.query(
        "SELECT game_nickname FROM members WHERE dcid = $1 AND line_user_id != $2",
        [dcId, targetLineUid]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.send(`
          <script>
            alert("⚠️ 此 Discord 帳號已被其他公會成員【${duplicateCheck.rows[0].game_nickname}】綁定！請登入正確的 Discord 帳號。");
            window.location.href = "/";
          </script>
        `);
      }

      // 更新該台灣成員的 dcid 與 joined_dc 狀態
      await pool.query(
        `UPDATE members 
         SET dcid = $1, joined_dc = 'Y', update_time = CURRENT_TIMESTAMP 
         WHERE line_user_id = $2`,
        [dcId, targetLineUid]
      );

      // 跳轉回台灣 LIFF 頁面並提示成功
      return res.redirect(`/?bindSuccess=dc`);

    } else {
      // ----------------------------------------------------
      // 【情境二：大陸成員專屬通道進入】
      // ----------------------------------------------------
      // 防呆：防止已綁定的台灣成員誤闖大陸通道重複建檔
      const checkExistingTw = await pool.query(
        "SELECT line_user_id, game_nickname, tw FROM members WHERE dcid = $1 AND (tw = 'Y' OR line_user_id != $1)",
        [dcId]
      );

      if (checkExistingTw.rows.length > 0) {
        return res.status(403).send("此 Discord 帳號已綁定台灣成員，請一律透過 LINE 進入系統！");
      }

      const existCheck = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [dcId]);
      if (existCheck.rows.length === 0) {
        await pool.query(`
          INSERT INTO members (line_user_id, dcid, tw, game_nickname, game_class, line_display_name, joined_dc, account_status, update_time)
          VALUES ($1, $1, 'N', $2, '未設定', $2, 'Y', '待審核', CURRENT_TIMESTAMP)
          ON CONFLICT (line_user_id) DO NOTHING
        `, [dcId, dcName]);
      } else {
        await pool.query(`
          UPDATE members 
          SET dcid = $1, tw = 'N', joined_dc = 'Y', update_time = CURRENT_TIMESTAMP 
          WHERE line_user_id = $1
        `, [dcId]);
      }

      return res.redirect(`/cn-hub.html?uid=${encodeURIComponent(dcId)}&name=${encodeURIComponent(dcName)}&avatar=${encodeURIComponent(dcAvatar)}`);
    }

  } catch (err) {
    console.error('[Discord OAuth2 回調失敗]:', err.message);
    res.status(500).send("Discord 帳號授權失敗，請返回重試。");
  }
});

// Google 試算表同步 API
app.get('/api/sheet/members', async (req, res) => {
  const secretKey = req.query.key;
  if (secretKey !== 'gm-lv') {
    return res.status(403).json({ status: "error", message: "無權存取" });
  }
  try {
    const result = await pool.query('SELECT * FROM members ORDER BY update_time DESC');
    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id,
      gameNickname: m.game_nickname,
      gameClass: m.game_class,
      lineDisplayName: m.line_display_name || "",
      allowSearch: m.allow_search || "N",
      accountStatus: m.account_status || "待審核",
      updateTime: m.update_time ? new Date(m.update_time).toISOString().replace('T', ' ').substring(0, 16) : "",
      guildRole: m.guild_role || "現任",
      teamGroup: m.team_group || "",
      joinedLineGroup: m.joined_line_group || "N",
      joinedDc: m.joined_dc || "N",
      tw: m.tw || "Y",
      dcid: m.dcid || ""
    }));
    res.json({ status: "success", members });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 大陸成員專屬 Discord OAuth2 端點
// ==========================================
const DISCORD_CLIENT_ID = '1561789656478130337';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YlFXNoWW9F5iGa6yk3Z075zOPp7-OVy7';
const DISCORD_REDIRECT_URI = 'https://guildmaster-lv.duckdns.org/api/auth/discord/callback';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'MTU2MTc4OTY1NjQ3ODEzMDMzNw.GSjvoT.nTJB8MvPJ_ZFx2I3w';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '1563947532072001768';

// 1. 發起 Discord 授權跳轉
app.get('/api/auth/discord', (req, res) => {
  const scope = encodeURIComponent('identify guilds guilds.join');
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&scope=${scope}`;
  res.redirect(authUrl);
});

// 2. 接收 Discord 授權回調
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("授權失敗：未取得驗證碼");

  try {
    const tokenParams = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DISCORD_REDIRECT_URI,
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenRes.ok) {
      const errTxt = await tokenRes.text();
      throw new Error(`Token 交換失敗: ${errTxt}`);
    }

    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${userAccessToken}` }
    });
    const dcUser = await userRes.json();
    const dcId = String(dcUser.id);
    const dcName = dcUser.global_name || dcUser.username;
    const dcAvatar = dcUser.avatar
      ? `https://cdn.discordapp.com/avatars/${dcId}/${dcUser.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 防呆：防止台灣成員從 DC 通道重複建立帳號
    const checkExistingTw = await pool.query(
      "SELECT line_user_id, game_nickname, tw FROM members WHERE dcid = $1 AND (tw = 'Y' OR line_user_id != $1)",
      [dcId]
    );

    if (checkExistingTw.rows.length > 0) {
      const twUser = checkExistingTw.rows[0];
      return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="zh-Hant">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>帳號登入限制</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-[#FFFDF7] min-h-screen flex items-center justify-center p-4 text-slate-800">
          <div class="max-w-md w-full bg-white rounded-3xl p-6 border-2 border-rose-200 shadow-xl text-center space-y-4">
            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-2xl font-black">⚠️</div>
            <h2 class="text-base font-black text-slate-900">此 Discord 帳號已綁定台灣成員</h2>
            <p class="text-xs text-slate-500 leading-relaxed text-left bg-rose-50/50 p-3.5 rounded-2xl border border-rose-100">
              親愛的 <b>${twUser.game_nickname || '公會成員'}</b>：<br>
              系統偵測到此 Discord 帳號已綁定於您的 <b>LINE 會員身分</b>。<br><br>
              為避免產生重複紀錄，<b>請直接使用 LINE 點開公會專區進行各項操作</b>，無須使用大陸專屬通道註冊。
            </p>
            <a href="https://line.me" class="inline-block w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-3 rounded-xl transition">
              返回 LINE 使用系統
            </a>
          </div>
        </body>
        </html>
      `);
    }

    // 自動拉進 Discord 伺服器
    try {
      await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ access_token: userAccessToken })
      });
      console.log(`[Discord] 已將大陸成員 ${dcName} (${dcId}) 拉進公會伺服器`);
    } catch (botErr) {
      console.warn('[Discord 自動加群異常]:', botErr.message);
    }

    // 寫入資料庫
    const existCheck = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [dcId]);

    if (existCheck.rows.length === 0) {
      await pool.query(`
        INSERT INTO members (line_user_id, dcid, tw, game_nickname, game_class, line_display_name, joined_dc, account_status, update_time)
        VALUES ($1, $1, 'N', $2, '未設定', $2, 'Y', '待審核', CURRENT_TIMESTAMP)
        ON CONFLICT (line_user_id) DO NOTHING
      `, [dcId, dcName]);
    } else {
      await pool.query(`
        UPDATE members 
        SET dcid = $1, tw = 'N', joined_dc = 'Y', update_time = CURRENT_TIMESTAMP 
        WHERE line_user_id = $1
      `, [dcId]);
    }

    res.redirect(`/cn-hub.html?uid=${encodeURIComponent(dcId)}&name=${encodeURIComponent(dcName)}&avatar=${encodeURIComponent(dcAvatar)}`);

  } catch (err) {
    console.error('[Discord OAuth2 回調失敗]:', err.message);
    res.status(500).send("Discord 帳號授權失敗，請返回重試。");
  }
});


// ==========================================
// 請假表單 API
// ==========================================

app.post('/api/leaves', async (req, res) => {
  const { leaveDate, leaveEvent, targetUid, gameNickname, gameClass, leaveReason, note, isUrgent, operatorUid, operatorName } = req.body;
  
  if (!leaveDate || !leaveEvent || !targetUid || !gameNickname || !leaveReason) {
    return res.status(400).json({ status: "error", message: "缺少必要的請假欄位" });
  }

  try {
    // 產生唯一請假 ID
    const leaveId = 'L' + Date.now() + Math.random().toString(36).substring(2, 7);
    
    // 若有填寫備註 (note)，將其附加在請假原因後方
    const finalReason = note ? `${leaveReason} (備註: ${note})` : leaveReason;

    // 取得精準的台灣時間 (UTC+8)
    const nowTaipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

    // 將 isUrgent 與 submit_time ($11) 寫入資料庫
    await pool.query(`
      INSERT INTO leaves (leave_id, leave_date, leave_event, target_uid, game_nickname, game_class, leave_reason, is_urgent, operator_uid, operator_name, submit_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      leaveId, 
      leaveDate, 
      leaveEvent, 
      targetUid, 
      gameNickname, 
      gameClass || '', 
      finalReason, 
      isUrgent || 'N', 
      operatorUid || targetUid, 
      operatorName || '本人',
      nowTaipei 
    ]);

    res.json({ status: "success", message: "請假申請已成功送出並記錄", leaveId });
  } catch (err) {
    console.error('[Database] 請假寫入失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 檢查特定日期與活動是否已有請假紀錄
app.get('/api/leaves/check', async (req, res) => {
  const { targetUid, leaveDate, leaveEvent } = req.query;
  if (!targetUid || !leaveDate || !leaveEvent) {
    return res.status(400).json({ status: "error", message: "缺少必要查詢參數" });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM leaves WHERE target_uid = $1 AND leave_date = $2 AND leave_event = $3',
      [targetUid, leaveDate, leaveEvent]
    );
    
    if (result.rows.length > 0) {
      res.json({ status: "exists", message: "該成員同天已請過此活動" });
    } else {
      res.json({ status: "available", message: "可正常請假" });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 幹部讀取請假紀錄規則 API
app.get('/api/admin/leaves', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leaves ORDER BY submit_time DESC');
    const leaves = result.rows.map(l => ({
      id: l.leave_id,
      date: l.leave_date,
      event: l.leave_event,
      gameNickname: l.game_nickname,
      gameClass: l.game_class,
      reason: l.leave_reason,
      isUrgent: l.is_urgent === 'Y',
      operator: l.operator_name || '本人',
      operator_name: l.operator_name || '本人', // 👈 多加這行，確保前端用 operator_name 也能抓到
      submitTime: l.submit_time
    }));
    res.json({ status: "success", leaves });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 儲存或更新請假項目規則 API
app.post('/api/admin/leave-rules/save', async (req, res) => {
  const { originalEvent, event, latestTime, cycle, enabled } = req.body;
  try {
    if (originalEvent && originalEvent !== event) {
      await pool.query('DELETE FROM leave_rules WHERE event = $1', [originalEvent]);
    }
    await pool.query(`
      INSERT INTO leave_rules (event, latest_time, cycle, enabled)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (event) 
      DO UPDATE SET latest_time = EXCLUDED.latest_time, cycle = EXCLUDED.cycle, enabled = EXCLUDED.enabled
    `, [event, latestTime, cycle, enabled]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 刪除請假項目規則 API
app.delete('/api/admin/leave-rules/:event', async (req, res) => {
  const eventName = req.params.event;
  try {
    await pool.query('DELETE FROM leave_rules WHERE event = $1', [eventName]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 提供給 Google 試算表同步請假紀錄用的 API
app.get('/api/sheet/leaves', async (req, res) => {
  const secretKey = req.query.key;
  if (secretKey !== 'gm-lv') { // 請保持與您原本的 key 一致
    return res.status(403).json({ status: "error", message: "無權存取" });
  }

  try {
    const result = await pool.query('SELECT * FROM leaves ORDER BY submit_time DESC');
    
    // 將資料庫欄位對應轉換成試算表 A ~ H 欄的格式
    // 對應欄位：請假日期(A), 遊戲暱稱(B), 遊戲職業(C), 請假活動(D), 請假原因(E), 填單時間(F), 請假人(G), 註記(H)
    const leaves = result.rows.map(l => ({
      leaveDate: l.leave_date || "",
      gameNickname: l.game_nickname || "",
      gameClass: l.game_class || "",
      leaveEvent: l.leave_event || "",
      leaveReason: l.leave_reason || "",
      submitTime: l.submit_time ? new Date(l.submit_time).toISOString().replace('T', ' ').substring(0, 16) : "",
      operatorName: l.operator_name || "本人",
      isUrgent: l.is_urgent === 'Y' ? '緊急' : ''
    }));

    res.json({ status: "success", leaves });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 活動列表 API
// ==========================================

// 共用的時間檢查與狀態計算函式
function getComputedStatus(evt) {
  // 如果已經手動封存或狀態已被設為已結束，保持原狀
  if (evt.is_archived === 1 || evt.status === '已結束') {
    return evt.status;
  }
  
  const now = new Date();
  const eventDateTime = new Date(`${evt.date} ${evt.time || '23:59:59'}`);
  const signupEnd = new Date(evt.signup_end);
  const signupStart = new Date(evt.signup_start);

  // 1. 如果活動時間已經過去，自動判定為「已結束」
  if (now > eventDateTime) {
    return '已結束';
  } else if (now > signupEnd) {
    return '已截止';
  } else if (now >= signupStart) {
    return '報名中';
  } else {
    return '尚未開始';
  }
}

// ==========================================
// 1. 取得所有活動與報名名單 API (GET) - 包含 note 備註
// ==========================================
app.get('/api/admin/events', async (req, res) => {
  try {
    const eventsResult = await pool.query('SELECT * FROM events ORDER BY date ASC');
    const attendeesResult = await pool.query('SELECT * FROM event_attendees');
    
    const events = eventsResult.rows.map(evt => {
      const attendees = attendeesResult.rows
        .filter(a => a.event_id === evt.event_id)
        .map(a => ({
          lineUserId: a.line_user_id,
          gameNickname: a.game_nickname,
          gameClass: a.game_class,
          signupTime: a.signup_time,
          note: a.note || "" // 👈 支援帶出備註
        }));

      // 動態計算當前真實狀態
      const computedStatus = getComputedStatus(evt);

      return {
        id: evt.event_id,
        title: evt.title,
        date: evt.date,
        time: evt.time,
        signupStart: evt.signup_start,
        signupEnd: evt.signup_end,
        maxLimit: evt.max_limit,
        status: computedStatus,
        isArchived: evt.is_archived === 1,
        desc: evt.description,
        attendees: attendees
      };
    });

    res.json({ status: "success", events });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 2. 進行報名 API (POST) - 支援儲存與更新 note 備註
// ==========================================
app.post('/api/events/signup', async (req, res) => {
  const { eventId, lineUserId, gameNickname, gameClass, note } = req.body;
  
  try {
    // 檢查活動是否存在以及是否已過報名截止時間
    const eventResult = await pool.query('SELECT * FROM events WHERE event_id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "找不到此活動" });
    }

    const event = eventResult.rows[0];
    const now = new Date();
    if (now > new Date(event.signup_end)) {
      return res.status(400).json({ status: "error", message: "報名已截止，無法進行報名" });
    }

    // 進行報名寫入（若重複報名則更新報名時間與備註內容，達到可修改備註的效果）
    const signupTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    await pool.query(`
      INSERT INTO event_attendees (event_id, line_user_id, game_nickname, game_class, signup_time, note)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id, line_user_id) DO UPDATE 
      SET signup_time = EXCLUDED.signup_time, note = EXCLUDED.note
    `, [eventId, lineUserId, gameNickname, gameClass, signupTime, note || '']);
    
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 3. 取消報名 API (DELETE)
// ==========================================
app.delete('/api/events/signup', async (req, res) => {
  const { eventId, lineUserId } = req.body;
  
  try {
    const eventResult = await pool.query('SELECT * FROM events WHERE event_id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "找不到此活動" });
    }

    const event = eventResult.rows[0];
    const now = new Date();
    if (now > new Date(event.signup_end)) {
      return res.status(400).json({ status: "error", message: "報名已截止，無法自行取消報名" });
    }

    await pool.query(`
      DELETE FROM event_attendees WHERE event_id = $1 AND line_user_id = $2
    `, [eventId, lineUserId]);
    
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 4. 建立或更新活動 API (POST)
// ==========================================
app.post('/api/admin/events/save', async (req, res) => {
  const { id, title, date, time, signupStart, signupEnd, maxLimit, status, desc, isArchived } = req.body;
  try {
    await pool.query(`
      INSERT INTO events (event_id, title, date, time, signup_start, signup_end, max_limit, status, description, is_archived)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (event_id) 
      DO UPDATE SET title = EXCLUDED.title, date = EXCLUDED.date, time = EXCLUDED.time, 
                    signup_start = EXCLUDED.signup_start, signup_end = EXCLUDED.signup_end, 
                    max_limit = EXCLUDED.max_limit, status = EXCLUDED.status, 
                    description = EXCLUDED.description, is_archived = EXCLUDED.is_archived
    `, [id, title, date, time, signupStart, signupEnd, maxLimit, status, desc, isArchived ? 1 : 0]);

    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 5. 刪除活動 API (DELETE)
// ==========================================
app.delete('/api/admin/events/:id', async (req, res) => {
  const eventId = req.params.id;
  try {
    // 1. 先刪除該活動底下的所有報名成員紀錄
    await pool.query('DELETE FROM event_attendees WHERE event_id = $1', [eventId]);

    // 2. 刪除活動主檔 (欄位是 event_id)
    await pool.query('DELETE FROM events WHERE event_id = $1', [eventId]);

    res.json({ status: "success", message: "活動已成功刪除" });
  } catch (err) {
    console.error('[Database] 刪除活動失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});



// ==========================================
// 推播群駔設定 API 
// ==========================================
// 取得系統設定參數 API
app.get('/api/admin/configs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_configs');
    const configs = {};
    result.rows.forEach(r => { 
      configs[r.config_key] = r.config_value; 
    });
    res.json({ status: "success", configs });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 儲存 LINE 群組 ID 設定 API
app.post('/api/admin/configs', async (req, res) => {
  const { guild_group_id, admin_group_id } = req.body;
  
  try {
    if (guild_group_id !== undefined) {
      await pool.query(`
        INSERT INTO system_configs (config_key, config_value) 
        VALUES ('guild_group_id', $1)
        ON CONFLICT (config_key) 
        DO UPDATE SET config_value = EXCLUDED.config_value
      `, [guild_group_id]);
    }

    if (admin_group_id !== undefined) {
      await pool.query(`
        INSERT INTO system_configs (config_key, config_value) 
        VALUES ('admin_group_id', $1)
        ON CONFLICT (config_key) 
        DO UPDATE SET config_value = EXCLUDED.config_value
      `, [admin_group_id]);
    }

    res.json({ status: "success", message: "群組 ID 設定已成功儲存" });
  } catch (err) {
    console.error('[Database] 儲存群組 ID 失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 遊戲職業管理 API (支援顏色設定)
// ==========================================

// 1. 取得所有職業清單（包含顏色）
app.get('/api/admin/classes', async (req, res) => {
  try {
    const result = await pool.query('SELECT class_name, color_theme FROM game_classes ORDER BY sort_order ASC, create_time ASC');
    const classes = result.rows.map(r => ({
      className: r.class_name,
      colorTheme: r.color_theme || 'amber'
    }));
    res.json({ status: "success", classes });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 2. 新增職業（同時儲存顏色）
app.post('/api/admin/classes/add', async (req, res) => {
  const { className, colorTheme } = req.body;
  if (!className) return res.status(400).json({ status: "error", message: "缺少職業名稱" });
  
  try {
    await pool.query(
      'INSERT INTO game_classes (class_name, color_theme) VALUES ($1, $2) ON CONFLICT (class_name) DO UPDATE SET color_theme = EXCLUDED.color_theme',
      [className.trim(), colorTheme || 'amber']
    );
    res.json({ status: "success", message: "職業新增成功" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 3. 修改職業名稱或顏色（連帶更新所有綁定該職業的會員資料）
app.post('/api/admin/classes/rename', async (req, res) => {
  const { oldName, newName, colorTheme } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ status: "error", message: "缺少必要欄位" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 如果改了名稱，檢查新名稱是否與其他職業重複
    if (oldName !== newName.trim()) {
      const checkExist = await client.query('SELECT * FROM game_classes WHERE class_name = $1', [newName.trim()]);
      if (checkExist.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ status: "error", message: "此職業名稱已存在" });
      }
    }

    // 透過 UPDATE 同時更新名稱與代表色（若名稱改變，也能正確同步）
    // 如果原本是以 class_name 當主鍵，改名需要用 DELETE + INSERT，但我們要把 color_theme 一起帶過去！
    await client.query('DELETE FROM game_classes WHERE class_name = $1', [oldName]);
    await client.query(
      'INSERT INTO game_classes (class_name, color_theme) VALUES ($1, $2) ON CONFLICT (class_name) DO UPDATE SET color_theme = EXCLUDED.color_theme',
      [newName.trim(), colorTheme || 'amber']
    );
    
    // 同步更新所有會員表格中對應的職業名稱
    if (oldName !== newName.trim()) {
      await client.query(
        'UPDATE members SET game_class = $1 WHERE game_class = $2',
        [newName.trim(), oldName]
      );
    }
    
    await client.query('COMMIT');
    res.json({ status: "success", message: "職業設定已成功更新" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Database] 修改職業失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    client.release();
  }
});

// 4. 刪除職業
app.post('/api/admin/classes/delete', async (req, res) => {
  const { className } = req.body;
  if (!className) return res.status(400).json({ status: "error", message: "缺少職業名稱" });

  try {
    await pool.query('DELETE FROM game_classes WHERE class_name = $1', [className]);
    res.json({ status: "success", message: "刪除職業成功" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 請假項目規則 API
app.get('/api/admin/leave-rules', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leave_rules');
    res.json({ status: "success", rules: result.rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 公告專區 API 串接邏輯
// ==========================================

// 1. 取得所有公告與已閱名單 (GET)
app.get('/api/admin/bulletins', async (req, res) => {
  try {
    const postsResult = await pool.query('SELECT * FROM bulletins ORDER BY is_pinned DESC, date DESC');
    const readsResult = await pool.query('SELECT * FROM bulletin_reads');

    const bulletins = postsResult.rows.map(post => {
      const readUsers = readsResult.rows
        .filter(r => r.post_id === post.post_id)
        .map(r => ({
          uid: r.line_user_id,
          nick: r.game_nickname,
          class: r.game_class,
          time: r.read_time
        }));

      // 支援多張圖片解析（若原本是字串或 JSON）
      let parsedImages = [];
      try {
        parsedImages = post.image_urls ? JSON.parse(post.image_urls) : (post.image_url ? [post.image_url] : []);
      } catch (e) {
        parsedImages = post.image_url ? [post.image_url] : [];
      }

      return {
        id: post.post_id,
        category: post.category,
        isPinned: post.is_pinned === 1,
        title: post.title,
        author: post.author,
        date: post.date,
        imageUrls: parsedImages, // 支援多圖陣列
        content: post.content,
        linkText: post.link_text || "",
        linkUrl: post.link_url || "",
        readUsers: readUsers
      };
    });

    res.json({ status: "success", bulletins });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 2. 建立或編輯公告 (POST)
app.post('/api/admin/bulletins/save', async (req, res) => {
  const { id, category, title, imageUrls, content, linkText, linkUrl, isPinned, author } = req.body;
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const postId = id || ("POST_" + Date.now());
  const pinnedVal = isPinned ? 1 : 0;
  const imagesJson = JSON.stringify(imageUrls || []);

  try {
    // 確保您的 bulletins 資料庫表中有 image_urls 欄位 (TEXT 類型)
    await pool.query(`
      INSERT INTO bulletins (post_id, category, title, image_urls, content, link_text, link_url, is_pinned, author, date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (post_id) 
      DO UPDATE SET 
        category = EXCLUDED.category,
        title = EXCLUDED.title,
        image_urls = EXCLUDED.image_urls,
        content = EXCLUDED.content,
        link_text = EXCLUDED.link_text,
        link_url = EXCLUDED.link_url,
        is_pinned = EXCLUDED.is_pinned
    `, [postId, category, title, imagesJson, content, linkText, linkUrl, pinnedVal, author, dateStr]);

    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 3. 刪除公告 (DELETE)
app.delete('/api/admin/bulletins/:id', async (req, res) => {
  const postId = req.params.id;
  try {
    await pool.query('DELETE FROM bulletins WHERE post_id = $1', [postId]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 4. 點擊已閱 API (改為僅能新增，不可取消)
app.post('/api/bulletins/read', async (req, res) => {
  const { postId, lineUserId, gameNickname, gameClass } = req.body;

  try {
    // 檢查是否已經點過已閱
    const checkResult = await pool.query(
      'SELECT * FROM bulletin_reads WHERE post_id = $1 AND line_user_id = $2',
      [postId, lineUserId]
    );

    // 如果已經讀過了，直接回傳成功（不執行刪除）
    if (checkResult.rows.length > 0) {
      return res.json({ status: "success", message: "已經完成已閱，無法重複操作" });
    }

    // 尚未讀過，寫入已閱紀錄
    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    await pool.query(`
      INSERT INTO bulletin_reads (post_id, line_user_id, game_nickname, game_class, read_time)
      VALUES ($1, $2, $3, $4, $5)
    `, [postId, lineUserId, gameNickname, gameClass, timeStr]);

    res.json({ status: "success", action: "added" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 推播排程 API
app.get('/api/admin/broadcasts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM broadcast_schedules');
    res.json({ status: "success", broadcasts: result.rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] 伺服器已在連接埠 ${PORT} 上運行`);
});



