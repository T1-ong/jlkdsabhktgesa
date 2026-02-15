const {
    version: ve,
    env_file,
    config_file,
    log,
    hasEnv,
    delay,
    hasFileOrDir,
    clearLotteryInfo, printIpInfo
} = require('./lib/utils');
const { HttpsProxyAgent } = require('https-proxy-agent');
const request = require('https');
const metainfo = [
    '  _           _   _                   _____           _       _   ',
    ' | |         | | | |                 / ____|         (_)     | |  ',
    ' | |     ___ | |_| |_ ___ _ __ _   _| (___   ___ _ __ _ _ __ | |_ ',
    ' | |    / _ \\| __| __/ _ \\ \'__| | | |\\___ \\ / __| \'__| | \'_ \\| __|',
    ' | |___| (_) | |_| ||  __/ |  | |_| |____) | (__| |  | | |_) | |_ ',
    ' |______\\___/ \\__|\\__\\___|_|   \\__, |_____/ \\___|_|  |_| .__/ \\__|',
    '                                __/ |                  | |        ',
    '                               |___/                   |_|        ',
    '                                                                  ',
    `    This: v${ve}     Nodejs: ${process.version}     Written By shanmite`,
];
/**多账号存储 */
let multiple_account = [];
/**循环等待时间 */
let loop_wait = 0;
/**账号状态标记 1正常 -1失效 */
// eslint-disable-next-line no-unused-vars
let ck_flag = 0;

/**
 * @returns {Promise<string>} 错误信息
 */
async function main() {
    const { COOKIE, NUMBER, CLEAR, ENABLE_MULTIPLE_ACCOUNT, MULTIPLE_ACCOUNT_PARM } = process.env;
    if (ENABLE_MULTIPLE_ACCOUNT) {
        let muti_acco = multiple_account.length
            ? multiple_account
            : JSON.parse(MULTIPLE_ACCOUNT_PARM);

        process.env.ENABLE_MULTIPLE_ACCOUNT = '';
        let localhost = request.globalAgent;
        
        // 如果是pinglun模式，第一个账号启动前添加90分钟内随机延迟
        if (hasEnv('pinglun') && muti_acco.length > 0) {
            const firstAccountDelay = Math.floor(Math.random() * 90 * 60 * 1000); // 90分钟内随机延迟
            log.info('多账号延迟', `pinglun模式，第一个账号延迟${Math.floor(firstAccountDelay / 1000 / 60)}分${Math.floor((firstAccountDelay / 1000) % 60)}秒后启动`);
            await delay(firstAccountDelay);
        }

        for (const acco of muti_acco) {
            process.env.COOKIE = acco.COOKIE;
            process.env.NUMBER = acco.NUMBER;
            process.env.CLEAR = acco.CLEAR;
            process.env.NOTE = acco.NOTE;
            process.env.ACCOUNT_UA = acco.ACCOUNT_UA;
            if (acco.PROXY_HOST) {
                printIpInfo(true);
                //http://ip:port
                //http://user:pwd@ip:port'
                const proxyUrl = acco.PROXY_USER
                    ? 'http://' + acco.PROXY_USER + ':' + acco.PROXY_PASS + '@' + acco.PROXY_HOST + ':' + acco.PROXY_PORT
                    : 'http://' + acco.PROXY_HOST + ':' + acco.PROXY_PORT;
                request.globalAgent = new HttpsProxyAgent(proxyUrl);
                printIpInfo(false);
            }else {
                //未设置还原
                request.globalAgent = localhost;
            }
            const err_msg = await main();
            if (err_msg) {
                return err_msg;
            } else {
                if (ck_flag === 1) {
                    // 如果是pinglun模式，使用90分钟内随机延迟，否则使用配置的延迟
                    if (hasEnv('pinglun')) {
                        const randomDelay = Math.floor(Math.random() * 90 * 60 * 1000); // 90分钟内随机延迟
                        log.info('多账号延迟', `pinglun模式，账号间延迟${Math.floor(randomDelay / 1000 / 60)}分${Math.floor((randomDelay / 1000) % 60)}秒`);
                        await delay(randomDelay);
                    } else {
                        await delay(acco.WAIT);
                    }
                } else {
                    await delay(3 * 1000);
                }
            }
            request.globalAgent = localhost;
        }
        /**多账号状态还原 */
        process.env.ENABLE_MULTIPLE_ACCOUNT = ENABLE_MULTIPLE_ACCOUNT;
    } else if (COOKIE) {
        const global_var = require('./lib/data/global_var');
        await global_var.init(COOKIE, NUMBER);

        /**引入基础功能 */
        const { start, isMe, clear, account, checkCookie, login } = require('./lib/index');

        log.info('main', '当前为第' + NUMBER + '个账号');
        log._cache.length = 0;

        const mode = process.env.lottery_mode;
        const help_msg = '用法: lottery [OPTIONS]\n\nOPTIONS:\n\tstart  启动抽奖\n\tcheck  中奖检查\n\tacount 查看帐号信息\n\tclear  清理动态和关注\n\tlogin 扫码登录更新CK\n\tupdate 检查更新\n\thelp   帮助信息';
        if (await checkCookie(NUMBER)) {
            const {
                lottery_loop_wait,
                check_loop_wait,
                clear_loop_wait,
                save_lottery_info_to_file
            } = require('./lib/data/config');
            ck_flag = 1;
            switch (mode) {
                case 'start':
                    log.info('抽奖', '开始运行');
                    loop_wait = lottery_loop_wait;
                    if (save_lottery_info_to_file) {
                        await clearLotteryInfo();
                    }
                    await start(NUMBER);
                    break;
                case 'check':
                    log.info('中奖检测', '检查是否中奖');
                    loop_wait = check_loop_wait;
                    await isMe(NUMBER);
                    break;
                case 'clear':
                    if (CLEAR) {
                        log.info('清理动态', '开始运行');
                        loop_wait = clear_loop_wait;
                        await clear();
                    }
                    break;
                case 'login':
                    log.info('登录状态', '正常，跳过扫码');
                    break;
                case 'help':
                    return help_msg;
                case 'account':
                    log.info('检查帐号信息', '开始运行');
                    await account();
                    break;
                case undefined:
                    return '未提供以下参数\n\t[OPTIONS]\n\n' + help_msg;
                default:
                    return `提供了错误的[OPTIONS] -> ${mode}\n\n` + help_msg;
            }
        } else {
            log.error('Cookie已失效', '切换账号时不要点击退出账号而应直接删除Cookie退出');
            ck_flag = -1;
            if (mode === 'login') {
                log.info('登陆', '开始扫码');
                await login(NUMBER);
                await delay(1000);
            }
        }
    } else {
        return '请查看README文件, 在env.js指定位置填入cookie';
    }
}

/**
 * 初始化环境
 * @returns {boolean} 出错true
 */
function initEnv() {
    if (hasFileOrDir(env_file)) {
        const
            env = require('./lib/data/env'),
            multiple_account_parm = env.get_multiple_account();

        if (multiple_account_parm) {
            multiple_account = multiple_account_parm;
        }

        env.init();
        log.init();
        log.info('环境变量初始化', '成功加载env.js文件');
    } else if (hasEnv('COOKIE') || hasEnv('MULTIPLE_ACCOUNT_PARM')) {
        log.init();
        log.info('环境变量初始化', '成功从环境变量中读取COOKIE设置');
    } else {
        log.init();
        log.error('环境变量初始化', '未在当前目录下找到env.js文件或者在环境变量中设置所需参数');
        return true;
    }

    return false;
}

/**
 * 初始化设置
 * @returns {boolean} 出错true
 */
function initConfig() {
    if (hasFileOrDir(config_file)) {
        const config = require('./lib/data/config');
        config.init();
        log.info('配置文件初始化', '成功加载my_config.js文件');
    } else {
        log.error('配置文件初始化', '未在当前目录下找到my_config.js文件');
        return true;
    }

    return false;
}

(async function () {
    log.rainbow(metainfo);

    if (initEnv() || initConfig()) return;

    // 根据时间自动更新关键词
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, 'my_config.js');
    
    const now = new Date();
    const hour = now.getHours();
    
    let keywords = [];
    let articleCreateTime = null;
    let updateKeywords = false;
    
    // 读取配置文件获取原始的article_create_time值
    let originalArticleCreateTime = null;
    const content = fs.readFileSync(configPath, 'utf8');
    const articleTimeMatch = content.match(/article_create_time:\s*(\d+),/);
    if (articleTimeMatch) {
        originalArticleCreateTime = parseInt(articleTimeMatch[1]);
    }
    
    if (hour < 12) {
        // 中午12点前：使用"抽奖合集史上最好"，只检查昨天一天的专栏
        keywords = ['抽奖合集史上最好'];
        articleCreateTime = 1;
        log.info('关键词更新', '已设置中午12点前关键词：抽奖合集史上最好');
        log.info('专栏时间', '已设置专栏检查天数：1天（仅昨天）');
        updateKeywords = true;
    } else {
        // 中午12点后：使用默认关键词，恢复配置文件的article_create_time
        keywords = ['临期速看', '精选大奖版'];
        articleCreateTime = originalArticleCreateTime;
        log.info('关键词更新', '已设置中午12点后关键词：临期速看, 精选大奖版');
        log.info('专栏时间', `已恢复配置文件的专栏检查天数：${originalArticleCreateTime}天`);
        updateKeywords = true;
    }
    
    if (updateKeywords) {
        // 重新读取配置文件（因为可能在前面已经读取过）
        let content = fs.readFileSync(configPath, 'utf8');
        
        // 替换关键词
        const keywordRegex = /Articles: \[(?:\s*'[^']*',?\s*)*\]/g;
        const keywordStr = `Articles: [
            '${keywords.join("',\n            '")}'
        ]`;
        
        content = content.replace(keywordRegex, keywordStr);
        
        // 根据时间设置article_create_time
        if (articleCreateTime !== null) {
            const articleTimeRegex = /article_create_time:\s*\d+,/;
            content = content.replace(articleTimeRegex, `article_create_time: ${articleCreateTime},`);
        }
        
        // 写入配置文件
        fs.writeFileSync(configPath, content, 'utf8');
        log.info('关键词更新', '配置文件已更新');
    }

    /**OPTIONS */
    process.env.lottery_mode = process.argv[2];

    log.info('检查更新', '开始');

    if (process.env.lottery_mode === 'update') {
        await require('./lib/update').update(true);
        return;
    } else {
        await require('./lib/update').update(false);
    }

    const err_msg = await main();
    if (err_msg) {
        log.error('错误', err_msg);
        log.warn('结束运行', '5秒后自动退出');
        await delay(5 * 1000);
    } else {
        while (loop_wait) {
            log.info('程序休眠', `${loop_wait / 1000}秒后再次启动`);
            await delay(loop_wait);
            if (initEnv() || initConfig()) return;
            await main();
        }
        log.info('结束运行', '未在my_config.js中设置休眠时间');
    }

    process.exit(0);
})();
