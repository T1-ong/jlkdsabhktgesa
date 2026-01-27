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
const { sendNotify } = require('./lib/helper/notify');
const env = require('./lib/data/env');
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

        let failedAccounts = [];

        for (const acco of muti_acco) {
            process.env.COOKIE = acco.COOKIE;
            process.env.NUMBER = acco.NUMBER;
            process.env.CLEAR = acco.CLEAR;
            process.env.NOTE = acco.NOTE;
            process.env.ACCOUNT_UA = acco.ACCOUNT_UA;
            process.env.ARTICLE_FAILED = 'false';
            
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
            
            if (process.env.ARTICLE_FAILED === 'true') {
                failedAccounts.push(acco);
                log.info('main', `账号${acco.NUMBER}读取专栏失败，将在第一轮运行完后重新运行`);
                
                // 第一次读取专栏失败时发送通知
                const accountName = acco.NOTE || `账号${acco.NUMBER}`;
                log.info('main', `准备发送第一次失败通知`);
                try {
                    await sendNotify(
                        `${accountName}读取不到专栏`,
                        `给你15分钟时间，立即更新cookie`
                    );
                    log.info('main', `第一次失败通知发送完成`);
                } catch (error) {
                    log.error('main', `第一次失败通知发送失败: ${error.message}`);
                }
            }
            
            if (err_msg) {
                return err_msg;
            } else {
                if (ck_flag === 1) {
                    await delay(acco.WAIT);
                } else {
                    await delay(3 * 1000);
                }
            }
            request.globalAgent = localhost;
        }

        if (failedAccounts.length > 0) {
            log.info('main', `第一轮运行完成，开始重新运行失败的账号(${failedAccounts.length}个)`);
            log.info('main', `等待15分钟后重新运行失败账号...`);
            await delay(15 * 60 * 1000);
            
            for (const acco of failedAccounts) {
                // 重新从env.js中获取最新的账号信息
                const latestAccounts = env.get_multiple_account();
                const latestAccount = latestAccounts.find(acc => acc.NUMBER === acco.NUMBER);
                
                if (latestAccount) {
                    // 使用最新的账号信息
                    process.env.COOKIE = latestAccount.COOKIE;
                    process.env.NUMBER = latestAccount.NUMBER;
                    process.env.CLEAR = latestAccount.CLEAR;
                    process.env.NOTE = latestAccount.NOTE;
                    process.env.ACCOUNT_UA = latestAccount.ACCOUNT_UA;
                    log.info('main', `已更新账号${acco.NUMBER}的cookie信息`);
                } else {
                    // 如果找不到最新信息，使用原来的
                    process.env.COOKIE = acco.COOKIE;
                    process.env.NUMBER = acco.NUMBER;
                    process.env.CLEAR = acco.CLEAR;
                    process.env.NOTE = acco.NOTE;
                    process.env.ACCOUNT_UA = acco.ACCOUNT_UA;
                    log.warn('main', `未找到账号${acco.NUMBER}的最新信息，使用原cookie`);
                }
                
                process.env.ARTICLE_FAILED = 'false';
                
                if (acco.PROXY_HOST) {
                    printIpInfo(true);
                    const proxyUrl = acco.PROXY_USER
                        ? 'http://' + acco.PROXY_USER + ':' + acco.PROXY_PASS + '@' + acco.PROXY_HOST + ':' + acco.PROXY_PORT
                        : 'http://' + acco.PROXY_HOST + ':' + acco.PROXY_PORT;
                    request.globalAgent = new HttpsProxyAgent(proxyUrl);
                    printIpInfo(false);
                }else {
                    request.globalAgent = localhost;
                }
                
                log.info('main', `重新运行账号${acco.NUMBER}`);
                log.info('main', `重新运行前ARTICLE_FAILED状态: ${process.env.ARTICLE_FAILED}`);
                const err_msg = await main();
                log.info('main', `重新运行后ARTICLE_FAILED状态: ${process.env.ARTICLE_FAILED}`);
                
                log.info('main', `检查ARTICLE_FAILED状态: ${process.env.ARTICLE_FAILED}`);
                if (process.env.ARTICLE_FAILED === 'true') {
                    log.info('main', `进入通知发送逻辑`);
                    const accountName = acco.NOTE || `账号${acco.NUMBER}`;
                    log.warn('main', `${accountName}重新运行后仍然读取专栏失败`);
                    
                    log.info('main', `准备发送第二次失败通知`);
                    try {
                        await sendNotify(
                            `${accountName}读取不到专栏`,
                            `第二次运行了，为什么还不更新cookie？少抽一天哈`
                        );
                        log.info('main', `第二次失败通知发送完成`);
                    } catch (error) {
                        log.error('main', `第二次失败通知发送失败: ${error.message}`);
                        log.error('main', `错误堆栈: ${error.stack}`);
                    }
                } else {
                    log.info('main', `账号${acco.NUMBER}重新运行成功，无需发送通知`);
                }
                
                if (err_msg) {
                    return err_msg;
                } else {
                    if (ck_flag === 1) {
                        await delay(acco.WAIT);
                    } else {
                        await delay(3 * 1000);
                    }
                }
                request.globalAgent = localhost;
            }
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
