const { log, delay, infiniteNumber, judge } = require('./utils');
const { sendNotify } = require('./helper/notify');
const config = require('./data/config');
const global_var = require('./data/global_var');
const bili = require('./net/bili');
const { send } = require('./net/http');
const fs = require('fs');
const path = require('path');
// 动态加载env.js，确保在不同环境下都能正确找到文件
const { env_file } = require('./utils');
let env;
try {
    // 尝试直接加载根目录的env.js
    env = require('../../env');
} catch (error) {
    // 如果失败，使用utils中定义的绝对路径加载
    delete require.cache[env_file];
    env = require(env_file);
}

/**
 * 将中奖信息写入文件
 * @param {string} desp 中奖信息内容
 * @param {number} num 账号编号
 */
async function writePrizeToFile(desp, num) {
    const prizeFile = path.join(__dirname, 'data', '中奖.txt');
    const timestamp = new Date().toLocaleString();
    const separator = '\n\n'; // 空两行作为分隔符
    
    try {
        // 获取账号备注信息
    let accountNote = '';
    
    // 优先从当前进程环境变量获取备注（与通知系统保持一致）
    if (process.env.NOTE) {
        accountNote = process.env.NOTE;
    } 
    // 如果环境变量没有，再尝试从配置中获取
    else {
        // 优先从多账号配置中查找
        const account = env.multiple_account_parm?.find(acc => acc.NUMBER === num);
        if (account?.NOTE) {
            accountNote = account.NOTE;
        } 
        // 否则使用单账号配置
        else {
            accountNote = env.account_parm?.NOTE || '';
        }
    }
    
    // 从备注中提取纯备注内容，去掉qq=xxx等其他信息
    if (accountNote) {
        accountNote = accountNote.split(/[，,]/)[0].trim();
    }
        
        // 检查文件是否存在
        let existingContent = '';
        if (fs.existsSync(prizeFile)) {
            existingContent = fs.readFileSync(prizeFile, 'utf8');
        }
        
        // 构建新的中奖记录
        const noteInfo = accountNote ? `(${accountNote})` : '';
        const newRecord = `[${timestamp}] 账号${num}${noteInfo}中奖信息:\n${desp.replace(/##/g, '###').replace(/\n\n/g, '\n')}`;
        
        // 如果文件已有内容，先添加分隔符
        const contentToWrite = existingContent 
            ? existingContent + separator + newRecord
            : newRecord;
        
        // 确保data目录存在
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // 写入文件
        fs.writeFileSync(prizeFile, contentToWrite, 'utf8');
        log.info('中奖记录', `已写入文件: ${prizeFile}`);
    } catch (error) {
        log.error('写入中奖文件失败', error.message);
    }
}

/**
 * 是否中奖
 * @param {number} num
 */
async function isMe(num) {
    let desp = '';
    const
        { notice_key_words, update_session_wait, get_session_wait, check_session_pages } = config,
        { at: unread_at_num, reply: unread_reply_num } = await bili.getUnreadNum(),
        unread_session_num = await bili.getUnreadSessionNum(),
        { follow_unread, unfollow_unread } = unread_session_num || { unfollow_unread: 0, follow_unread: 0 };
    if (unread_at_num) {
        log.info('中奖检测', '<-- 正在检查at');
        const MyAtInfo = await bili.getMyAtInfo();
        MyAtInfo
            .slice(0, unread_at_num)
            .forEach(({ at_time, up_uname, business, source_content, url }) => {
                desp += '## 👉去查看艾特\n\n';
                desp += `发生时间: ${new Date(at_time * 1000).toLocaleString()}\n\n`;
                desp += `用户: ${up_uname}\n\n`;
                desp += `在${business}中@了[你]( https://space.bilibili.com/${global_var.get('myUID')} )\n\n`;
                desp += `原内容为: ${source_content}\n\n`;
                desp += `[直达链接]( ${url} )\n\n`;
                desp += '🎉中奖辣中奖辣中奖辣🎉\n';
                desp += ' 👉👉收到回个1👈👈';
            });
        log.info('中奖检测', '--> OK');
    }
    if (unread_reply_num) {
        log.info('中奖检测', '<-- 正在检查回复');
        const replys = await bili.getReplyMsg();
        replys
            .slice(0, unread_reply_num)
            .forEach(({ nickname, uri, source, timestamp }) => {
                if (judge(source, notice_key_words)) {
                    desp += '## 👉去查看回复\n\n';
                    desp += `发生时间: ${new Date(timestamp * 1000).toLocaleString()}\n\n`;
                    desp += `用户: ${nickname}\n\n`;
                    desp += `回复[你]( https://space.bilibili.com/${global_var.get('myUID')} )说:\n${source}\n\n`;
                    desp += `[直达链接]( ${uri} )\n\n`;
                    desp += '🎉中奖辣中奖辣中奖辣🎉\n';
                    desp += ' 👉👉收到回个1👈👈';
                }
            });
        log.info('中奖检测', '--> OK');
    }
    if (follow_unread + unfollow_unread > 0) {
        const check = async (type) => {
            let session_t = '';
            let MySession = await bili.getSessionInfo(type);
            log.info('准备检查私信', check_session_pages + '页');
            for (const index of infiniteNumber()) {
                for (const Session of MySession.data) {
                    const { sender_uid, session_ts, timestamp, unread_count, talker_id, msg_seqno } = Session;
                    session_t = session_ts;
                    if (unread_count) {
                        const content = await bili.fetch_session_msgs(talker_id, unread_count);
                        if (judge(content, notice_key_words)) {
                            desp += '## 👉去查看私信\n\n';
                            desp += `发生时间: ${new Date(timestamp * 1000).toLocaleString()}\n\n`;
                            desp += `用户: ${sender_uid}\n\n`;
                            desp += `私信[你]( https://space.bilibili.com/${global_var.get('myUID')} )说:\n${content}\n\n`;
                            desp += `[直达链接]( https://message.bilibili.com/#/whisper/mid${sender_uid} )\n\n`;
                            desp += '🎉中奖辣中奖辣中奖辣🎉\n';
                            desp += ' 👉👉收到回个1👈👈';
                        }
                        await bili.updateSessionStatus(talker_id, type, msg_seqno);
                        await delay(update_session_wait);
                    }
                }
                if (MySession.has_more && index < check_session_pages) {
                    await delay(get_session_wait);
                    MySession = await bili.getSessionInfo(type, session_t);
                } else {
                    break;
                }
            }
        };
        if (follow_unread) {
            log.info('中奖检测', '<-- 正在检查已关注者的私信');
        }
        if (unfollow_unread) {
            log.info('中奖检测', '<-- 正在检查未关注者的私信');
        }
        await check('1');
        log.info('中奖检测', '--> OK');
    }
    if (desp) {
        log.notice('可能中奖了', desp);
        await sendNotify(`帐号${num}可能中奖了`, desp);
        // 将中奖信息写入文件
        await writePrizeToFile(desp, num);
    } else {
        log.notice('中奖检测', '暂未中奖');
    }
    return;
}


module.exports = { isMe };
