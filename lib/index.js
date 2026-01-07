const { login } = require('./login');
const { isMe } = require('./check');
const { clear } = require('./clear');
const { start } = require('./lottery');
const { account } = require('./account');
const global_var = require('./data/global_var');
const bili = require('./net/bili');
const { log } = require('./utils');
const { sendNotify, sendQmsgOnly } = require('./helper/notify');

const fs = require('fs').promises;
const path = require('path');

// 存储最后通知时间的文件路径
const lastNotifyFile = path.join(__dirname, 'data', 'lastNotifyTime.json');

/**
 * 从文件读取最后通知时间
 */
async function loadLastNotifyTime() {
    try {
        // 检查文件是否存在
        await fs.access(lastNotifyFile);
        // 读取文件内容
        const data = await fs.readFile(lastNotifyFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // 如果文件不存在或读取失败，返回空对象
        log.warn('通知时间存储', '首次运行或存储文件损坏，将使用新的存储');
        return {};
    }
}

/**
 * 将最后通知时间保存到文件
 * @param {object} data 要保存的最后通知时间对象
 */
async function saveLastNotifyTime(data) {
    try {
        // 确保数据目录存在
        await fs.mkdir(path.dirname(lastNotifyFile), { recursive: true });
        // 写入文件
        await fs.writeFile(lastNotifyFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        log.error('通知时间存储', `保存失败: ${error.message}`);
    }
}

// 存储每个账号的最后通知时间戳
let lastNotifyTime = {}; // 格式: {账号编号: 最后通知时间戳}

// 初始化时加载数据
(async () => {
    lastNotifyTime = await loadLastNotifyTime();
})();

/**
 * 检查cookie是否有效
 * @param {string} num
 */
async function checkCookie(num) {
    const My_UID = global_var.get('myUID');
    try {
        if (await bili.getMyinfo()) {
            // Cookie有效时，清除该账号的最后通知时间
            if (lastNotifyTime[num]) {
                delete lastNotifyTime[num];
                await saveLastNotifyTime(lastNotifyTime);
            }
            log.info('Cookie有效性检测', `成功登录 UID:${My_UID}`);
            return true;
        } else {
            return handleInvalidCookie(num, My_UID);
        }
    } catch (error) {
        log.error('Cookie有效性检测', `验证出错: ${error.message}`);
        return handleInvalidCookie(num, My_UID);
    }
}

/**
 * 处理无效Cookie，控制通知频率
 * @param {string} num 账号编号
 * @param {string} uid 用户ID
 * @returns {boolean} 始终返回false，表示Cookie无效
 */
async function handleInvalidCookie(num, uid) {
    const now = Date.now();
    const oneHour = 21600 * 1000; // 1小时的毫秒数（修正了原代码中的计算错误）
    
    // 检查是否需要发送通知（首次失效或已超过1小时）
    if (!lastNotifyTime[num] || now - lastNotifyTime[num] >= oneHour) {
        lastNotifyTime[num] = now; // 更新最后通知时间
        await saveLastNotifyTime(lastNotifyTime); // 保存到文件
        log.error('Cookie有效性检测', `登录失败 COOKIE${num} 已失效 UID:${uid}`);
        sendQmsgOnly('请迅速更新cookie', `COOKIE${num} 已失效 UID:${uid}`);
    } else {
        // 不发送通知，仅记录日志
        const remainingMinutes = Math.ceil((oneHour - (now - lastNotifyTime[num])) / 60000);
        log.warn('Cookie有效性检测', `登录失败 COOKIE${num} 已失效（已通知，${remainingMinutes}分钟后再次提醒） UID:${uid}`);
    }
    
    return false;
}


module.exports = { login, start, isMe, clear, checkCookie, account };
