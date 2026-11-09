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
        gear_score NUMERIC DEFAULT 0,
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
        color_theme VARCHAR(50) DEFAULT 'white',
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 自動初始化預設職業進 game_classes (若表內無資料)
    const classCheck = await client.query('SELECT COUNT(*) FROM game_classes');
    if (parseInt(classCheck.rows[0].count) === 0) {
      const defaultClasses = [
        "法師", "賢者", "神射手", "搞笑藝人", 
        "冷豔舞姬", "騎士", "十字軍", "刺客", 
        "流氓", "神官", "武僧", "神工匠", "創造者"
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
// LINE 官方帳號 Token 設定
// ==========================================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN || 'gOAoMsNwlJaNlVqT8ONJXLDllnjKNoZjiKa6lZDtU4L7Ant7Aaf/y+PHxunIKfVRyOBvOspMp7Hhf0N/QCz+0rxJ5mBE2yDh9zoP9U1BWLb80whgwDD2Omf9ISj81y6yvuIjxZkR3Z+F0lackAQZWAdB04t89/1O/w1cDnyilFU=';

// n8n Webhook 轉發目標網址
const N8N_WEBHOOK_URL = 'https://2026-cc-n8n.duckdns.org/webhook/line-hook';

// ==========================================
// LINE Messaging API Webhook 接收端點
// ==========================================
app.post('/webhook', async (req, res) => {
  // ⚡ 收到請求立刻回覆 200 OK，LINE 後台點 Verify 就會立刻通過！
  res.status(200).send('OK');

  const events = req.body.events;
  if (!events || !Array.isArray(events) || events.length === 0) return;

  // ----------------------------------------------------
  // 關鍵同步：非同步轉發整包事件給 n8n
  // ----------------------------------------------------
  fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body)
  }).catch(err => {
    // 轉發失敗僅印 Log，不中斷 GuildMaster 正常運作
    console.warn('[LINE Webhook] 轉發至 n8n 異常:', err.message);
  });


 for (const ev of events) {

    // ----------------------------------------------------
    // 監聽群組指令：自動綁定 Group ID
    // ----------------------------------------------------
    if (ev.type === 'message' && ev.message.type === 'text') {
      const userText = ev.message.text.trim();
      const source = ev.source;

      // 檢查發送來源是否為 LINE 群組
      if (source && source.type === 'group') {
        const currentGroupId = source.groupId;

        // 指令：/大群ID 或 /綁定大群
        if (userText === '/大群ID' || userText === '/綁定大群') {
          try {
            await pool.query(`
              INSERT INTO system_configs (config_key, config_value)
              VALUES ('guild_group_id', $1)
              ON CONFLICT (config_key)
              DO UPDATE SET config_value = EXCLUDED.config_value
            `, [currentGroupId]);

            await replyLineMessage(ev.replyToken, [
              {
                type: 'text',
                text: `【公會大群】設定成功！\n\n📌 群組 ID：\n${currentGroupId}\n\n已自動寫入後台設定，排程推播與活動將發送至此群組。`
              }
            ]);
            console.log(`[LINE Bot] 成功綁定公會大群 ID: ${currentGroupId}`);
          } catch (err) {
            console.error('儲存公會大群 ID 失敗:', err);
          }
          continue;
        }

        // 指令：/幹部群ID 或 /綁定幹部群
        if (userText === '/幹部群ID' || userText === '/綁定幹部群') {
          try {
            await pool.query(`
              INSERT INTO system_configs (config_key, config_value)
              VALUES ('admin_group_id', $1)
              ON CONFLICT (config_key)
              DO UPDATE SET config_value = EXCLUDED.config_value
            `, [currentGroupId]);

            await replyLineMessage(ev.replyToken, [
              {
                type: 'text',
                text: `【幹部專用群】設定成功！\n\n📌 群組 ID：\n${currentGroupId}\n\n已自動寫入後台設定，會員審核與臨時請假通知將發送至此群組。`
              }
            ]);
            console.log(`[LINE Bot] 成功綁定幹部群 ID: ${currentGroupId}`);
          } catch (err) {
            console.error('儲存幹部群 ID 失敗:', err);
          }
          continue;
        }

        // 指令：/群ID 或 /id
        if (userText === '/群ID' || userText === '/id') {
          await replyLineMessage(ev.replyToken, [
            {
              type: 'text',
              text: `當前聊天室 Group ID 為：\n${currentGroupId}`
            }
          ]);
          continue;
        }
      }
    }

    // ----------------------------------------------------
    // 3. Bot 剛被拉進群組時自動發送歡迎引導
    // ----------------------------------------------------
    if (ev.type === 'join' && ev.source && ev.source.type === 'group') {
      await replyLineMessage(ev.replyToken, [
        {
          type: 'text',
          text: `👋 大家好！公會管理系統已就緒。\n\n若要將此群組綁定為通知目標，請在此輸入：\n👉「/大群ID」設為公會大群`
        }
      ]);
    }
  }
});

// ==========================================
// LINE Reply API 訊息回覆函式
// ==========================================
async function replyLineMessage(replyToken, messages) {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('[LINE Bot Reply 失敗]:', err);
    }
  } catch (err) {
    console.error('[LINE Bot Reply 網路異常]:', err);
  }
}

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

// ==========================================
// 2. 會員前台登記 / 更新資料 (新入會與舊會員修改)
// ==========================================
app.post('/api/members/bind', async (req, res) => {
  const { lineUserId, lineDisplayName, gameNickname, gameClass, allowSearch, tw, dcid } = req.body;
  
  if (!lineUserId || !gameNickname || !gameClass) {
    return res.status(400).json({ status: "error", message: "缺少必要欄位" });
  }

  try {
    const oldRes = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [lineUserId]);
    const oldMember = oldRes.rows[0];

    // 原本是「退會」或「全新會員」，一律視為新入會
    const isNewRegistration = !oldMember || (oldMember.guild_role === '退會');

    // 新入會一律強制重置為「現任」與「待審核」；已在會舊會員保持原狀
    const finalRole = isNewRegistration ? '現任' : (oldMember.guild_role || '現任');
    const finalAccountStatus = isNewRegistration ? '待審核' : (oldMember.account_status || '待審核');

    const finalTw = oldMember ? (oldMember.tw || tw || 'Y') : (tw || 'Y');
    const finalDcid = oldMember ? (oldMember.dcid || dcid || null) : (dcid || null);
    const finalJoinedDc = (finalTw === 'N' || finalDcid) ? 'Y' : (oldMember?.joined_dc || 'N');

    // 1. 寫入 / 更新會員主資料
    await pool.query(`
      INSERT INTO members (
        line_user_id, game_nickname, game_class, line_display_name, 
        allow_search, account_status, guild_role, tw, dcid, joined_dc, update_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET 
        game_nickname = EXCLUDED.game_nickname, 
        game_class = EXCLUDED.game_class, 
        line_display_name = EXCLUDED.line_display_name, 
        allow_search = EXCLUDED.allow_search, 
        account_status = $6,
        guild_role = $7,
        tw = COALESCE(members.tw, EXCLUDED.tw),
        dcid = COALESCE(members.dcid, EXCLUDED.dcid),
        joined_dc = $10,
        update_time = CURRENT_TIMESTAMP
    `, [
      lineUserId, 
      gameNickname, 
      gameClass, 
      lineDisplayName || "", 
      allowSearch || 'N', 
      finalAccountStatus, 
      finalRole, 
      finalTw, 
      finalDcid,
      finalJoinedDc
    ]);

    // 💡 關鍵補上：若有綁定 Discord (大陸或台灣)，按下送出時順便修改 DC 伺服器暱稱！
    if (finalDcid && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${finalDcid}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nick: gameNickname })
      }).then(async r => {
        if (r.ok) {
          console.log(`[Discord] 成功將成員 (${finalDcid}) 的伺服器暱稱改為: ${gameNickname}`);
        } else {
          const errTxt = await r.text();
          console.warn(`[Discord 改暱稱失敗] 狀態碼: ${r.status}, 回應: ${errTxt}`);
        }
      }).catch(err => console.error('[Discord API 異常]:', err.message));
    }

    // 2. 審核歷程紀錄與幹部 LINE 推播
    if (isNewRegistration) {
      await pool.query(
        'INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', 
        [lineUserId, '新會員註冊', '-', `${gameNickname} (${gameClass})`]
      );

      // 推播通知幹部群
      try {
        const configRes = await pool.query("SELECT config_value FROM system_configs WHERE config_key = 'admin_group_id'");
        const adminGroupId = configRes.rows.length > 0 ? configRes.rows[0].config_value : null;

        if (adminGroupId && LINE_ACCESS_TOKEN) {
          const currentTime = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
          const regionText = finalTw === 'N' ? '大陸(DC)' : '台灣(LINE)';

          const notifyMessage = 
            `🔔【新成員入會待審核】\n\n` +
            `• 遊戲暱稱：${gameNickname}\n` +
            `• 遊戲職業：${gameClass}\n` +
            `• 社群暱稱：${lineDisplayName || '無'}\n` +
            `• 註冊管道：${regionText}\n` +
            `• 申請時間：${currentTime}\n\n` +
            `👉 請盡快前往【幹部後台】進行確認喔～`;

          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              to: adminGroupId,
              messages: [{ type: 'text', text: notifyMessage }]
            })
          });

          console.log(`[LINE 推播] 成功向幹部群發送新成員【${gameNickname}】審核通知`);
        }
      } catch (pushErr) {
        console.error('[LINE 推播幹部群失敗]:', pushErr.message);
      }

    } else {
      if (oldMember.game_nickname !== gameNickname) {
        await pool.query(
          'INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', 
          [lineUserId, '遊戲暱稱', oldMember.game_nickname, gameNickname]
        );
      }
      if (oldMember.game_class !== gameClass) {
        await pool.query(
          'INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', 
          [lineUserId, '遊戲職業', oldMember.game_class, gameClass]
        );
      }
    }

    res.json({ status: "success", message: "會員資料已成功送出" });
  } catch (err) {
    console.error('[Database] 會員登記更新失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 3. 幹部後台會員清單 (依職業順序 -> 同職業依裝備評價由高到低排序)

app.get('/api/admin/members', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.* 
      FROM members m
      LEFT JOIN game_classes c ON m.game_class = c.class_name
      ORDER BY 
        COALESCE(c.sort_order, 999) ASC,
        COALESCE(m.gear_score, 0) DESC,
        m.update_time DESC
    `);

    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id,
      gameNickname: m.game_nickname,
      gameClass: m.game_class,
      gearScore: Number(m.gear_score) || 0, 
      lineDisplayName: m.line_display_name,
      allowSearch: m.allow_search || 'N',
      joinedLineGroup: m.joined_line_group || 'N',
      joinedDc: m.joined_dc || 'N',
      accountStatus: m.account_status,
      guildRole: m.guild_role,
      teamGroup: m.team_group || '',
      tw: m.tw || 'Y',
      dcid: m.dcid || '',
      updateTime: m.update_time
    }));

    res.json({ status: "success", members });
  } catch (err) {
    console.error('[Database] 讀取幹部會員名單失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 4. 幹部審核與狀態修改 (連動退會：自動踢出 DC 並徹底清空 DC 狀態)
// ==========================================
app.post('/api/admin/members/status', async (req, res) => {
  const { lineUserId, accountStatus, guildRole } = req.body;
  
  try {
    // A. 先查詢該成員的 dcid 與遊戲暱稱
    const userRes = await pool.query('SELECT dcid, game_nickname FROM members WHERE line_user_id = $1', [lineUserId]);
    const dcId = userRes.rows[0]?.dcid;
    const nickName = userRes.rows[0]?.game_nickname || lineUserId;

    // B. 若設為「退會」
    if (guildRole === '退會') {
      // 💡 關鍵修復：連同 dcid 重置為 NULL、joined_dc 與 joined_line_group 重置為 'N'
      await pool.query(`
        UPDATE members 
        SET account_status = $1, 
            guild_role = $2, 
            dcid = NULL, 
            joined_dc = 'N', 
            joined_line_group = 'N', 
            update_time = CURRENT_TIMESTAMP 
        WHERE line_user_id = $3
      `, [accountStatus, guildRole, lineUserId]);

      // 自動從 Discord 伺服器踢出
      if (dcId) {
        try {
          const kickRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
              'X-Audit-Log-Reason': encodeURIComponent(`幹部審核退會移出: ${nickName}`)
            }
          });

          if (kickRes.status === 204) {
            console.log(`[Discord] 🚪 退會成員 ${nickName} (${dcId}) 已成功移出伺服器，資料庫狀態已完全重置`);
          } else {
            const errTxt = await kickRes.text();
            console.warn(`[Discord 踢人未成功] 狀態碼: ${kickRes.status}, 回應: ${errTxt}`);
          }
        } catch (dcErr) {
          console.error('[Discord 踢人異常]:', dcErr.message);
        }
      }
    } else {
      // C. 一般現任或幹部狀態正常更新
      await pool.query(
        'UPDATE members SET account_status = $1, guild_role = $2, update_time = CURRENT_TIMESTAMP WHERE line_user_id = $3',
        [accountStatus, guildRole, lineUserId]
      );
    }

    res.json({ status: "success" });
  } catch (err) {
    console.error('[Database] 修改會員狀態失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 5. 幹部編輯 / 新增會員 (已加入 gear_score 儲存)
// ==========================================
app.post('/api/admin/members/save', async (req, res) => {
  const {
    lineUserId, gameNickname, gameClass, lineDisplayName,
    guildRole, teamGroup, accountStatus, joinedLineGroup,
    joinedDc, tw, dcid, gearScore
  } = req.body;

  const score = parseInt(gearScore, 10) || 0;

  try {
    const isRetire = (guildRole === '退會');
    const finalJoinedDc = isRetire ? 'N' : (joinedDc || 'N');
    const finalJoinedLine = isRetire ? 'N' : (joinedLineGroup || 'N');
    const finalDcid = isRetire ? null : (dcid ? String(dcid).trim() : null);

    await pool.query(`
      INSERT INTO members (
        line_user_id, game_nickname, game_class, line_display_name, 
        guild_role, team_group, account_status, joined_line_group, 
        joined_dc, tw, dcid, gear_score, update_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET 
        game_nickname = EXCLUDED.game_nickname, 
        game_class = EXCLUDED.game_class, 
        line_display_name = EXCLUDED.line_display_name, 
        guild_role = EXCLUDED.guild_role, 
        team_group = EXCLUDED.team_group, 
        account_status = EXCLUDED.account_status, 
        joined_line_group = $8,
        joined_dc = $9,
        tw = COALESCE(EXCLUDED.tw, members.tw, 'Y'),
        dcid = $11,
        gear_score = EXCLUDED.gear_score,
        update_time = CURRENT_TIMESTAMP
    `, [
      lineUserId, gameNickname, gameClass, lineDisplayName,
      guildRole, teamGroup, accountStatus,
      finalJoinedLine, finalJoinedDc,
      tw || 'Y', finalDcid, score
    ]);

    // 若手動改為退會且原本有 dcid，連動將其踢出 Discord
    if (isRetire && dcid) {
      try {
        const kickRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcid}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'X-Audit-Log-Reason': encodeURIComponent(`幹部手動編輯退會移出: ${gameNickname}`)
          }
        });
        if (kickRes.status === 204) {
          console.log(`[Discord] 🚪 編輯退會成員 ${gameNickname} (${dcid}) 已移出伺服器`);
        }
      } catch (dcErr) {
        console.error('[Discord 踢人連線異常]:', dcErr.message);
      }
    }

    res.json({ status: "success" });
  } catch (err) {
    console.error('[Database] 幹部儲存會員失敗:', err);
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

// 7. 刪除會員 (連動踢出 Discord 伺服器)
app.delete('/api/admin/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    // A. 先查詢該成員是否有綁定 dcid
    const memberRes = await pool.query('SELECT dcid, game_nickname FROM members WHERE line_user_id = $1', [lineUserId]);
    const dcId = memberRes.rows[0]?.dcid;
    const nickName = memberRes.rows[0]?.game_nickname || lineUserId;

    // B. 如果有綁定 Discord，呼叫 Discord API 踢出伺服器
    if (dcId) {
      try {
        const kickRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'X-Audit-Log-Reason': encodeURIComponent(`公會名冊刪除成員: ${nickName}`)
          }
        });

        if (kickRes.status === 204) {
          console.log(`[Discord] 已將刪除的成員 ${nickName} (${dcId}) 移出伺服器`);
        } else {
          const kickErr = await kickRes.text();
          console.warn(`[Discord 踢人未成功] 狀態碼: ${kickRes.status}, 回應: ${kickErr}`);
        }
      } catch (dcErr) {
        console.error('[Discord 踢人連線異常]:', dcErr.message);
      }
    }

    // C. 刪除資料庫資料與稽核紀錄
    await pool.query('DELETE FROM members WHERE line_user_id = $1', [lineUserId]);
    await pool.query('DELETE FROM member_audit_logs WHERE line_user_id = $1', [lineUserId]);

    res.json({ status: "success" });
  } catch (err) {
    console.error('[Database] 刪除會員失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 提供給 Google 試算表同步會員資料用的 API (依職業自訂順序 -> 依裝評由高到低排序)
// ==========================================
app.get('/api/sheet/members', async (req, res) => {
  const secretKey = req.query.key;
  if (secretKey !== 'gm-lv') {
    return res.status(403).json({ status: "error", message: "無權存取" });
  }

  try {
    // 關聯職業順序表，職業相同時依照 gear_score 降冪（高到低）排序
    const result = await pool.query(`
      SELECT m.* 
      FROM members m
      LEFT JOIN game_classes c ON m.game_class = c.class_name
      ORDER BY 
        COALESCE(c.sort_order, 999) ASC, 
        COALESCE(m.gear_score, 0) DESC, 
        m.update_time DESC
    `);
    
    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id || "",
      gameNickname: m.game_nickname || "",
      gameClass: m.game_class || "",
      gearScore: Number(m.gear_score) || 0, // 
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
    console.error('[Database] 同步會員至試算表失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});
// ==========================================
// Google 試算表更新成員裝備評價 API
// ==========================================
app.post('/api/sheet/gear-scores', async (req, res) => {
  const secretKey = req.query.key;
  if (secretKey !== 'gm-lv') {
    return res.status(403).json({ status: "error", message: "無權存取" });
  }

  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ status: "error", message: "資料格式錯誤" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 逐筆依遊戲暱稱更新裝備評價 (gear_score)
    for (const item of items) {
      if (item.gameNickname) {
        await client.query(
          `UPDATE members 
           SET gear_score = $1, update_time = NOW() 
           WHERE game_nickname = $2`,
          [item.gearScore, item.gameNickname]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ status: "success", message: `成功更新 ${items.length} 筆裝備評價！` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Database] 更新裝備評價失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    client.release();
  }
});


// ==========================================
// Discord OAuth2 授權端點（整合台灣加綁與大陸登入）
// ==========================================
const DISCORD_CLIENT_ID = '1561789656478130337';
const DISCORD_CLIENT_SECRET = 'YlFXNoWW9F5iGa6yk3Z0' + '75zOPp7-OVy7';
const DISCORD_BOT_TOKEN = 'MTU2MTc4OTY1NjQ3ODEzMDMzNw' + '.' + 'GSjvoT' + '.' + 'nTJB8MvPJ_zeg5g3dkDn2QfJP5ZA_i-ZFx2I3w';
const DISCORD_REDIRECT_URI = 'https://guildmaster-lv.duckdns.org/api/auth/discord/callback'; // 👈 修正拼字
const DISCORD_GUILD_ID = '1471191307736186931';

// 1. 發起 Discord 授權跳轉
app.get('/api/auth/discord', (req, res) => {
  const fromUid = req.query.uid || 'login_only';
  const state = encodeURIComponent(fromUid);
  const scope = encodeURIComponent('identify guilds.join'); // identify + guilds.join 即可
  // 👈 修正拼字：redirect_uri
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

    const targetLineUid = state ? decodeURIComponent(state) : 'login_only';

    // ----------------------------------------------------
    // 🛡️ 關鍵修正 1：最優先執行防呆阻擋！(在動任何 DC 暱稱之前)
    // ----------------------------------------------------
    if (!targetLineUid || targetLineUid === 'login_only') {
      // 檢查此 DC 帳號是否已經綁定在台灣成員名下
      const checkExistingTw = await pool.query(
        "SELECT line_user_id, game_nickname, tw FROM members WHERE dcid = $1 AND (tw = 'Y' OR line_user_id != $1)",
        [dcId]
      );

      if (checkExistingTw.rows.length > 0) {
        const twUser = checkExistingTw.rows[0];
        console.warn(`[Discord 防呆] 台灣成員【${twUser.game_nickname}】誤觸大陸通道，直接阻擋且不更動任何 DC 資料`);
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
                系統偵測到此 Discord 帳號已綁定於 <b>LINE 會員身分</b>。<br><br>
                為避免產生重複紀錄，<b>請直接使用 LINE 管理系統進行各項操作</b>，無須使用大陸專屬通道註冊。
              </p>
              <a href="https://lin.ee/pAPeNUT" class="inline-block w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-3 rounded-xl transition">
                返回 LINE 使用系統
              </a>
            </div>
          </body>
          </html>
        `);
      }
    }

    // ----------------------------------------------------
    // C. 查詢要設定的遊戲暱稱
    // ----------------------------------------------------
    let memberNick = dcName;
    if (targetLineUid && targetLineUid !== 'login_only') {
      const memRes = await pool.query('SELECT game_nickname FROM members WHERE line_user_id = $1', [targetLineUid]);
      if (memRes.rows.length > 0 && memRes.rows[0].game_nickname) {
        memberNick = memRes.rows[0].game_nickname;
      }
    }

    // ----------------------------------------------------
    // D. 自動拉進 Discord 伺服器並同步暱稱與身分組
    // ----------------------------------------------------
    try {
      const MEMBER_ROLE_ID = '1471192518036164651'; // 成員身分組 ID

      const joinPayload = {
        access_token: userAccessToken,
        roles: [MEMBER_ROLE_ID],
        nick: memberNick
      };

      const joinRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(joinPayload)
      });

      const resText = await joinRes.text();
      console.log(`[Discord 加群回應] 狀態碼: ${joinRes.status}, 回應: ${resText}`);

      if (joinRes.status === 201) {
        console.log(`[Discord] 🎉 成功將新成員 ${memberNick} (${dcId}) 拉進公會、賦予身分組並修改暱稱！`);
      } else if (joinRes.status === 204) {
        console.log(`[Discord] ℹ️ 成員 ${dcName} (${dcId}) 原先就已在伺服器內，補發身分組並同步暱稱...`);

        // 1. 補發身分組
        await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}/roles/${MEMBER_ROLE_ID}`, {
          method: 'PUT',
          headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });

        // 2. 補改伺服器暱稱為遊戲角色名稱 (只有在確定有查到遊戲暱稱時才改，避免改回原名)
        if (memberNick && memberNick !== dcName) {
          await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${dcId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nick: memberNick })
          });
        }
      }
    } catch (botErr) {
      console.error('[Discord 自動加群/改名異常]:', botErr.message);
    }

    // ----------------------------------------------------
    // E. 依據來源分流跳轉
    // ----------------------------------------------------
    if (targetLineUid && targetLineUid !== 'login_only') {
      // 台灣成員加綁 DC
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

      await pool.query(
        `UPDATE members 
         SET dcid = $1, joined_dc = 'Y', update_time = CURRENT_TIMESTAMP 
         WHERE line_user_id = $2`,
        [dcId, targetLineUid]
      );

      return res.send(`
        <!DOCTYPE html>
        <html lang="zh-Hant">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Discord 綁定成功</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-[#FFFDF7] min-h-screen flex items-center justify-center p-4 text-slate-800">
          <div class="max-w-xs w-full bg-white rounded-3xl p-6 border-2 border-emerald-200 shadow-xl text-center space-y-4">
            <div class="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl font-black">✓</div>
            <h2 class="text-base font-black text-slate-900">Discord 綁定成功！</h2>
            <p class="text-xs text-slate-500 leading-relaxed">
              已成功綁定您的 Discord 帳號，伺服器暱稱已更新為【${memberNick}】。<br><br>
              <b>請直接關閉此分頁，返回 LINE 即可！</b>
            </p>
            <a href="https://lin.ee/pAPeNUT" class="block w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-3 rounded-xl transition">
              返回 LINE
            </a>
          </div>
        </body>
        </html>
      `);

    } else {
      // 合法的大陸新成員/舊成員進入 cn-hub.html
      res.redirect(`/cn-hub.html?uid=${encodeURIComponent(dcId)}&name=${encodeURIComponent(dcName)}&avatar=${encodeURIComponent(dcAvatar)}`);
    }

  } catch (err) {
    console.error('[Discord OAuth2 回調失敗]:', err.message);
    res.status(500).send("Discord 帳號授權失敗，請返回重試。");
  }
});


// ==========================================
// 請假表單 API
// ==========================================

// ==========================================
// 1. 檢查特定日期與活動是否已有請假紀錄 (供前端防呆檢查)
// ==========================================
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

// ==========================================
// 2. 請假表單送出 API (含後端防重複 + 超時自動判定 + 幹部群 LINE 推播)
// ==========================================
app.post('/api/leaves', async (req, res) => {
  const { 
    leaveDate, leaveEvent, targetUid, 
    gameNickname, gameClass, leaveReason, 
    note, isUrgent, operatorUid, operatorName 
  } = req.body;

  if (!leaveDate || !leaveEvent || !targetUid || !gameNickname || !leaveReason) {
    return res.status(400).json({ status: "error", message: "缺少必要的請假欄位" });
  }

  try {
    // 💡 後端雙重防呆：確保同一人同一天同一活動不會重複寫入
    const duplicateCheck = await pool.query(
      'SELECT leave_id FROM leaves WHERE target_uid = $1 AND leave_date = $2 AND leave_event = $3',
      [targetUid, leaveDate, leaveEvent]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ status: "exists", message: "該成員此日期與活動已完成請假，請勿重複送出！" });
    }

    // 產生唯一請假 ID
    const leaveId = 'L' + Date.now() + Math.random().toString(36).substring(2, 7);
    const finalReason = note ? `${leaveReason} (備註: ${note})` : leaveReason;
    const nowTaipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

    // 💡 自動比對該活動規則的最晚截止時間
    let finalUrgent = isUrgent || 'N';
    const ruleRes = await pool.query('SELECT latest_time, enabled FROM leave_rules WHERE event = $1', [leaveEvent]);

    if (ruleRes.rows.length > 0 && ruleRes.rows[0].enabled === 1) {
      const latestTimeStr = ruleRes.rows[0].latest_time;
      if (latestTimeStr) {
        let deadline;
        if (latestTimeStr.includes(" ")) {
          deadline = new Date(latestTimeStr);
        } else {
          deadline = new Date(`${leaveDate}T${latestTimeStr}:00`);
        }
        if (nowTaipei > deadline) {
          finalUrgent = 'Y';
        }
      }
    }

    // 寫入請假紀錄
    await pool.query(`
      INSERT INTO leaves (
        leave_id, leave_date, leave_event, target_uid, 
        game_nickname, game_class, leave_reason, is_urgent, 
        operator_uid, operator_name, submit_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      leaveId, 
      leaveDate, 
      leaveEvent, 
      targetUid, 
      gameNickname, 
      gameClass || '', 
      finalReason, 
      finalUrgent, 
      operatorUid || targetUid, 
      operatorName || '本人',
      nowTaipei 
    ]);

    // ----------------------------------------------------
    // 🚨 判定臨時/超時請假：立即發送推播通知至幹部群
    // ----------------------------------------------------
    if (finalUrgent === 'Y') {
      try {
        const configRes = await pool.query("SELECT config_value FROM system_configs WHERE config_key = 'admin_group_id'");
        const adminGroupId = configRes.rows.length > 0 ? configRes.rows[0].config_value : null;

        // ✅ 直接使用您檔案上方宣告好的 LINE_ACCESS_TOKEN
        if (adminGroupId && LINE_ACCESS_TOKEN) {
          const timeStr = nowTaipei.toLocaleString("zh-TW", { 
            timeZone: "Asia/Taipei", 
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false 
          });

          const urgentMessage = 
            `🚨${gameNickname} (${gameClass || ''}) ${leaveDate} 臨時請假!\n` +
            `請假原因：${finalReason}\n` +
            `填單時間：${timeStr}`;

          const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              to: adminGroupId,
              messages: [{ type: 'text', text: urgentMessage }]
            })
          });

          if (pushRes.ok) {
            console.log(`[LINE 推播] 🚨 已將成員【${gameNickname}】的臨時請假即時推播至幹部群`);
          } else {
            const errData = await pushRes.json();
            console.error('[LINE 臨時請假推播 API 回應錯誤]:', errData);
          }
        } else {
          console.warn('[LINE 推播] 尚未設定幹部群 ID (admin_group_id) 或 Token，略過通知');
        }
      } catch (pushErr) {
        console.error('[LINE 臨時請假推播失敗]:', pushErr.message);
      }
    }

    res.json({ 
      status: "success", 
      message: "請假申請已成功送出並記錄", 
      leaveId,
      isUrgent: finalUrgent 
    });

  } catch (err) {
    console.error('[Database] 請假寫入失敗:', err);
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
      isUrgent: l.is_urgent === 'Y' ? '臨時' : ''
    }));

    res.json({ status: "success", leaves });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 活動列表 API
// ==========================================

// 輔助函式：安全解析 YYYY-MM-DD HH:mm 字串（支援台灣時區 +08:00）
function parseDateTime(str) {
  if (!str) return null;
  // 將 "2026-11-02 09:00" 轉為 "2026-11-02T09:00:00+08:00"
  let cleanStr = str.trim().replace(' ', 'T');
  if (cleanStr.length === 16) {
    cleanStr += ':00';
  }
  // 若字串沒有附帶時區，強制綁定台灣時區 +08:00
  if (!cleanStr.includes('+') && !cleanStr.endsWith('Z')) {
    cleanStr += '+08:00';
  }
  return new Date(cleanStr);
}

function getComputedStatus(evt) {
  if (evt.is_archived === 1 || evt.status === '已結束') {
    return '已結束';
  }

  const now = new Date();

  // 1. 活動進行時間
  if (evt.date) {
    const eventTimeStr = evt.time ? `${evt.date} ${evt.time}` : `${evt.date} 23:59:59`;
    const eventDate = parseDateTime(eventTimeStr);
    if (eventDate && now > eventDate) {
      return '已結束';
    }
  }

  const signupEnd = parseDateTime(evt.signup_end);
  const signupStart = parseDateTime(evt.signup_start);

  // 2. 判斷報名時間區間
  if (signupEnd && now > signupEnd) {
    return '已截止';
  } else if (signupStart && now < signupStart) {
    return '尚未開始';
  } else {
    return '報名中';
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
// 2. 進行報名 API (POST) - 完整卡控 + 台灣時區修正版
// ==========================================
app.post('/api/events/signup', async (req, res) => {
  const { eventId, lineUserId, gameNickname, gameClass, note } = req.body;
  
  try {
    // 1. 檢查活動是否存在
    const eventResult = await pool.query('SELECT * FROM events WHERE event_id = $1', [eventId]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "找不到此活動" });
    }

    const event = eventResult.rows[0];
    const now = new Date();

    // 2. 檢查活動是否已被封存或結束
    if (event.is_archived === 1 || event.status === '已結束') {
      return res.status(400).json({ status: "error", message: "該活動已結束或封存，無法進行報名" });
    }

    // 3. 檢查報名「開始時間」
    if (event.signup_start && now < new Date(event.signup_start)) {
      return res.status(400).json({ status: "error", message: "報名尚未開放，無法進行報名" });
    }

    // 4. 檢查報名「截止時間」
    if (event.signup_end && now > new Date(event.signup_end)) {
      return res.status(400).json({ status: "error", message: "報名已截止，無法進行報名" });
    }

    // 5. 檢查是否額滿 (已在名單內者修改備註不阻擋)
    if (event.max_limit && event.max_limit > 0) {
      const attendeesResult = await pool.query('SELECT line_user_id FROM event_attendees WHERE event_id = $1', [eventId]);
      const isAlreadyJoined = attendeesResult.rows.some(a => a.line_user_id === lineUserId);
      
      if (!isAlreadyJoined && attendeesResult.rows.length >= event.max_limit) {
        return res.status(400).json({ status: "error", message: "報名人數已滿，無法報名" });
      }
    }

    // 💡 6. 寫入或更新報名資料與備註 (強制鎖定台灣 Asia/Taipei UTC+8 時區)
    const formatter = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    const h = parts.find(p => p.type === 'hour').value;
    const min = parts.find(p => p.type === 'minute').value;
    const signupTime = `${y}-${m}-${d} ${h}:${min}`;
    
    await pool.query(`
      INSERT INTO event_attendees (event_id, line_user_id, game_nickname, game_class, signup_time, note)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id, line_user_id) DO UPDATE 
      SET signup_time = EXCLUDED.signup_time, note = EXCLUDED.note
    `, [eventId, lineUserId, gameNickname, gameClass, signupTime, note || '']);
    
    res.json({ status: "success" });
  } catch (err) {
    console.error('[活動報名失敗]:', err);
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


// ==========================================
// 推播排程 API (儲存、刪除與自動發送引擎)
// ==========================================

// 1. 取得所有推播排程列表 (GET)
app.get('/api/admin/broadcasts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        broadcast_id AS id,
        broadcast_id,
        item,
        freq,
        cycle,
        time,
        content,
        active
      FROM broadcast_schedules 
      ORDER BY broadcast_id ASC
    `);
    res.json({ status: "success", broadcasts: result.rows });
  } catch (err) {
    console.error('[API 錯誤] 讀取推播排程失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 2. 儲存或更新推播排程 (POST)
app.post('/api/admin/broadcasts/save', async (req, res) => {
  const { id, item, freq, cycle, time, content, active } = req.body;
  const broadcastId = id || ('BC_' + Date.now());
  const activeVal = (active === 1 || active === true) ? 1 : 0;

  try {
    await pool.query(`
      INSERT INTO broadcast_schedules (broadcast_id, item, freq, cycle, time, content, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (broadcast_id)
      DO UPDATE SET
        item = EXCLUDED.item,
        freq = EXCLUDED.freq,
        cycle = EXCLUDED.cycle,
        time = EXCLUDED.time,
        content = EXCLUDED.content,
        active = EXCLUDED.active
    `, [broadcastId, item, freq || 'Weekly (每週固定)', cycle || '', time || '20:00', content, activeVal]);

    res.json({ status: "success", message: "推播排程已成功儲存" });
  } catch (err) {
    console.error('[Database] 儲存推播排程失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 3. 刪除推播排程 (DELETE)
app.delete('/api/admin/broadcasts/:id', async (req, res) => {
  const broadcastId = req.params.id;
  try {
    await pool.query('DELETE FROM broadcast_schedules WHERE broadcast_id = $1', [broadcastId]);
    res.json({ status: "success", message: "排程已成功刪除" });
  } catch (err) {
    console.error('[Database] 刪除推播排程失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 4. 定時推播排程器（附診斷 Log 版）
// ==========================================
let isCheckingBroadcast = false;

async function checkAndSendBroadcasts() {
  if (isCheckingBroadcast) return;
  isCheckingBroadcast = true;

  try {
    // 取得精準台灣時間 (UTC+8)
    const nowTaipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const currentHours = String(nowTaipei.getHours()).padStart(2, '0');
    const currentMinutes = String(nowTaipei.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`; // "HH:mm"

    const dayMap = ['日', '一', '二', '三', '四', '五', '六'];
    const currentDay = dayMap[nowTaipei.getDay()];

    // 💡 印出心跳 Log，讓你知道它每分鐘都有正常運作
    console.log(`[推播排程檢查] 系統時間: ${currentTimeStr} (星期${currentDay})`);

    // 查詢「已啟用」的排程（使用 SUBSTRING 或 LIKE 避免資料庫存 20:00:00 導致比對失敗）
    const result = await pool.query(
      `SELECT * FROM broadcast_schedules 
       WHERE active = 1 
         AND (time = $1 OR time LIKE $2)`,
      [currentTimeStr, `${currentTimeStr}:%`]
    );

    if (result.rows.length === 0) {
      // 可以在開發時開啟這行確認沒有到期任務：
      // console.log(`[推播排程檢查] 此分鐘 (${currentTimeStr}) 無匹配的啟用排程`);
      return;
    }

    // 讀取公會大群 ID
    const configRes = await pool.query("SELECT config_value FROM system_configs WHERE config_key = 'guild_group_id'");
    const targetGroupId = configRes.rows.length > 0 ? configRes.rows[0].config_value : null;

    if (!targetGroupId) {
      console.warn('[推播排程] ⚠️ 找到了排程，但尚未設定目標 LINE 群組 ID (請在群組輸入 /大群ID 進行綁定)');
      return;
    }

    for (const item of result.rows) {
      let shouldSend = false;

      // 比對今天星期是否符合 (中文/英文/每天)
      const cycleStr = item.cycle || '';
      const freqStr = item.freq || '';

      if (
        cycleStr.includes(currentDay) || 
        cycleStr.toLowerCase().includes('everyday') ||
        freqStr.includes('Daily') || 
        freqStr.includes('每天')
      ) {
        shouldSend = true;
      }

      if (shouldSend) {
        console.log(`[推播排程] 🚀 觸發推播: 【${item.item}】 正在以 @All 發送至群組...`);

        const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            to: targetGroupId,
            messages: [
              {
                type: 'textV2',
                text: '{all}\n' + item.content,
                substitution: {
                  all: {
                    type: 'mention',
                    mentionee: {
                      type: 'all'
                    }
                  }
                }
              }
            ]
          })
        });

        if (lineRes.ok) {
          console.log(`[推播排程] 🎉 【${item.item}】 @All 推播發送成功！`);
        } else {
          const errData = await lineRes.json();
          console.error(`[推播排程] ❌ 【${item.item}】 LINE API 發送失敗:`, errData);
        }
      } else {
        console.log(`[推播排程] 排程【${item.item}】時間吻合，但週期 (設定: ${item.cycle}) 與今天 (星期${currentDay}) 不符，跳過。`);
      }
    }
  } catch (err) {
    console.error('[推播排程執行異常]:', err.message);
  } finally {
    isCheckingBroadcast = false;
  }
}

// 伺服器啟動時立即執行一次檢查，隨後每 60 秒跑一次
checkAndSendBroadcasts();
setInterval(checkAndSendBroadcasts, 60 * 1000);


app.listen(PORT, () => {
  console.log(`[Server] 伺服器已在連接埠 ${PORT} 上運行`);
});

// ==========================================
// 1. LIFF 開啟時核對：先查 UID，找不到再比對 LINE 暱稱 (完全比對+自動換 UID)
// ==========================================
app.post('/api/members/check-identity', async (req, res) => {
  const { userId, displayName } = req.body;
  const newUid = (userId || '').trim();
  const lineName = (displayName || '').trim();

  if (!newUid) {
    return res.status(400).json({ status: "error", message: "缺少必要參數" });
  }

  try {
    // A. 先查 LINE UID 是否已存在
    const uidRes = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [newUid]);
    if (uidRes.rows.length > 0) {
      const m = uidRes.rows[0];
      return res.json({
        status: "found",
        member: {
          gameNickname: m.game_nickname,
          gameClass: m.game_class,
          lineDisplayName: m.line_display_name || lineName,
          allowSearch: m.allow_search,
          accountStatus: m.account_status,
          guildRole: m.guild_role,
          dcid: m.dcid,
          joinedDc: m.joined_dc,
          gearScore: Number(m.gear_score) || 0
        }
      });
    }

    // B. UID 查無，再查 LINE 顯示暱稱 (嚴格比對，排除退會)
    if (lineName) {
      const nameRes = await pool.query(`
        SELECT * FROM members 
        WHERE (TRIM(line_display_name) ILIKE $1 OR line_display_name ILIKE $2)
          AND (guild_role IS NULL OR guild_role != '退會')
        LIMIT 2
      `, [lineName, `%${lineName}%`]);

      // 剛好完全命中 1 筆：悄悄將資料庫舊 UID 換成新 UID
      if (nameRes.rows.length === 1) {
        const target = nameRes.rows[0];
        const oldUid = target.line_user_id;

        await pool.query(`
          UPDATE members 
          SET line_user_id = $1, 
              line_display_name = $2,
              update_time = CURRENT_TIMESTAMP
          WHERE line_user_id = $3
        `, [newUid, lineName, oldUid]);

        await pool.query('UPDATE member_audit_logs SET line_user_id = $1 WHERE line_user_id = $2', [newUid, oldUid]);
        console.log(`[自動替換 UID] 暱稱【${lineName}】: 原 UID ${oldUid} -> 新 UID ${newUid}`);

        return res.json({
          status: "found",
          member: {
            gameNickname: target.game_nickname,
            gameClass: target.game_class,
            lineDisplayName: lineName,
            allowSearch: target.allow_search,
            accountStatus: target.account_status,
            guildRole: target.guild_role,
            dcid: target.dcid,
            joinedDc: target.joined_dc,
            gearScore: Number(target.gear_score) || 0
          }
        });
      }
    }

    // C. 兩者皆查無資料
    return res.json({ status: "not_found" });

  } catch (err) {
    console.error('[身分核對異常]:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 前台手動搜尋名冊（診斷加強版）
// ==========================================
app.get('/api/members/search-for-claim', async (req, res) => {
  const keyword = (req.query.q || '').trim();
  console.log(`[認領搜尋] 收到搜尋關鍵字: 【${keyword}】`);

  if (!keyword) {
    return res.json({ status: "success", members: [] });
  }

  try {
    // 1. 先用寬鬆條件搜尋（同時印出 guild_role）
    const searchRes = await pool.query(`
      SELECT game_nickname, game_class, line_display_name, guild_role, account_status
      FROM members 
      WHERE TRIM(game_nickname) ILIKE $1
      ORDER BY update_time DESC
      LIMIT 10
    `, [`%${keyword}%`]);

    console.log(`[認領搜尋] 關鍵字【${keyword}】在資料庫比對出 ${searchRes.rows.length} 筆資料`);
    if (searchRes.rows.length > 0) {
      console.log('[認領搜尋] 命中資料範例:', searchRes.rows[0]);
    }

    // 2. 如果連一筆都沒有，直接印出目前資料庫前 3 筆角色名稱做對照
    if (searchRes.rows.length === 0) {
      const sample = await pool.query('SELECT game_nickname, guild_role FROM members LIMIT 3');
      console.log('[認領搜尋] 目前資料庫現存的前 3 個角色範例:', sample.rows);
    }

    // 3. 過濾掉退會成員後回傳
    const activeMembers = searchRes.rows.filter(r => r.guild_role !== '退會');

    res.json({
      status: "success",
      members: activeMembers.map(r => ({
        gameNickname: r.game_nickname,
        gameClass: r.game_class,
        lineDisplayName: r.line_display_name
      }))
    });
  } catch (err) {
    console.error('[搜尋成員失敗]:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});
// ==========================================
// 3. 點選搜尋到的角色，執行身分認領與 UID 替換
// ==========================================
app.post('/api/members/claim-by-game-nick', async (req, res) => {
  const { newUid, lineDisplayName, gameNickname } = req.body;
  const gameNick = (gameNickname || '').trim();

  if (!newUid || !gameNick) {
    return res.status(400).json({ status: "error", message: "缺少必要參數" });
  }

  try {
    const memRes = await pool.query(`
      SELECT * FROM members 
      WHERE TRIM(game_nickname) ILIKE $1 
        AND (guild_role IS NULL OR guild_role != '退會')
      LIMIT 1
    `, [gameNick]);

    if (memRes.rows.length === 0) {
      return res.json({ status: "not_found", message: "查無此遊戲角色！" });
    }

    const target = memRes.rows[0];
    const oldUid = target.line_user_id;

    // 將資料庫該會員 UID 替換為當前新 UID，並繼承所有關聯紀錄
    await pool.query(`
      UPDATE members 
      SET line_user_id = $1, 
          line_display_name = $2,
          update_time = CURRENT_TIMESTAMP
      WHERE line_user_id = $3
    `, [newUid, lineDisplayName, oldUid]);

    await pool.query('UPDATE member_audit_logs SET line_user_id = $1 WHERE line_user_id = $2', [newUid, oldUid]);
    await pool.query('UPDATE leaves SET target_uid = $1 WHERE target_uid = $2', [newUid, oldUid]);
    await pool.query('UPDATE event_attendees SET line_user_id = $1 WHERE line_user_id = $2', [newUid, oldUid]);

    console.log(`[手動認領置換成功] 角色【${gameNick}】原 UID ${oldUid} -> 新 UID ${newUid}`);

    res.json({
      status: "success",
      member: {
        gameNickname: target.game_nickname,
        gameClass: target.game_class,
        lineDisplayName: lineDisplayName,
        allowSearch: target.allow_search,
        accountStatus: target.account_status,
        guildRole: target.guild_role,
        dcid: target.dcid,
        joinedDc: target.joined_dc,
        gearScore: Number(target.gear_score) || 0
      }
    });
  } catch (err) {
    console.error('[手動認領失敗]:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});


// 主副戰名單系統管理員登入 API
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "lv123"; // 您自訂的管理密碼

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        return res.json({ status: "success", message: "身分驗證通過" });
    }

    return res.status(401).json({ status: "error", message: "帳號或密碼錯誤！" });
});
