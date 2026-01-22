const { log, hasEnv, shuffle, getRandomOne, getAiContent, delay, try_for_each, retryfn, appendLotteryInfoFile } = require('../utils');
const { send } = require('../net/http');
const bili = require('../net/bili');
const { sendNotify, sendQmsgOnly } = require('../helper/notify');
const fs = require('fs');
const path = require('path');

const event_bus = require('../helper/event_bus');
const { randomDynamic } = require('../helper/randomDynamic');
const { Searcher } = require('./searcher');
const global_var = require('../data/global_var');
const config = require('../data/config');
const d_storage = require('../helper/d_storage');

/**
 * 监视器
 */
class Monitor extends Searcher {
    /**
     * @constructor
     * @param {[string, number | string]} lottery_param
     */
    constructor(lottery_param) {
        super();
        this.lottery_param = lottery_param;
        this.tagid = config.partition_id; /* tagid初始化 */
        this.attentionList = ''; /* 转为字符串的所有关注的up主uid */
        this.LotteryInfoMap = new Map([
            ['UIDs', this.getLotteryInfoByUID.bind(this)],
            ['TAGs', this.getLotteryInfoByTag.bind(this)],
            ['Articles', this.getLotteryInfoByArticle.bind(this)],
            ['APIs', this.getLotteryInfoByAPI.bind(this)],
            ['TxT', this.getLotteryInfoByTxT.bind(this)]
        ]);
    }
    /**
     * 初始化
     */
    async init() {
        if (config.model === '00') {
            event_bus.emit('Turn_off_the_Monitor', '已关闭所有转发行为');
            return;
        }
        if (!this.tagid
            && config.is_not_create_partition !== true) {
            this.tagid = await bili.checkMyPartition(); /* 检查关注分区 */
            if (!this.tagid) {
                event_bus.emit('Turn_off_the_Monitor', '分区获取失败');
                return;
            }
        }
        /** 关注列表初始化 */
        this.attentionList = await bili.getAttentionList(global_var.get('myUID'));
        const status = await this.startLottery();
        // 如果设置了pinglun环境变量，处理完后直接关闭监视器，切换到下一个账号
        if (hasEnv('pinglun')) {
            event_bus.emit('Turn_off_the_Monitor', '已处理完pinglun指定动态，切换到下一个账号');
        } else {
            switch (status) {
                case 0:
                    event_bus.emit('Turn_on_the_Monitor');
                    break;
                case 1001:
                    event_bus.emit('Turn_off_the_Monitor', '评论失败');
                    break;
                case 1010:
                    event_bus.emit('Turn_off_the_Monitor', '已掉号');
                    break;
                case 1004:
                    event_bus.emit('Turn_off_the_Monitor', '需要输入验证码');
                    break;
                case 2001:
                    event_bus.emit('Turn_off_the_Monitor', '关注出错');
                    break;
                case 2004:
                case 4005:
                    log.warn(`账号异常${status}`, `UID(${global_var.get('myUID')})异常号只会对部分UP出现异常`);
                    if (!config.is_exception) {
                        // 处理通知内容，将dyid和uid转换为手动转发和手动关注的链接格式
                        let logContent = log._cache.filter(it => /dyid:\s+\d+,\s+uid:\s+\d+/.test(it)).map(line => {
                            // 提取dyid和uid信息
                            const dyidMatch = line.match(/dyid:\s+(\d+)/);
                            const uidMatch = line.match(/uid:\s+(\d+)/);
                            if (dyidMatch && uidMatch) {
                                const dyid = dyidMatch[1];
                                const uid = uidMatch[1];
                                const dyidLink = `https://www.bilibili.com/opus/${dyid}`;
                                const uidLink = `https://space.bilibili.com/${uid}`;
                                return `手动转发 ( ${dyidLink} )\n手动关注 ( ${uidLink} )`;
                            }
                            return line;
                        }).join('\n');
                        
                        await sendQmsgOnly(
                            `[动态抽奖]账号异常${status}通知`,
                            `UID: ${global_var.get('myUID')} ( https://space.bilibili.com/${global_var.get('myUID')} )\n迅速更新cookie并按要求操作\n${logContent}`
                        );
                    }
                    config.is_exception = true;
                    event_bus.emit('Turn_on_the_Monitor');
                    break;
                case 2005:
                    log.warn('关注已达上限', `UID(${global_var.get('myUID')})关注已达上限,已临时进入只转已关注模式`);
                    if (!config.is_outof_maxfollow) {
                        await sendNotify(
                            '[动态抽奖]关注已达上限',
                            `UID: ${global_var.get('myUID')}\n关注已达上限,已临时进入只转已关注模式\n可在设置中令is_outof_maxfollow为true关闭此推送\n${log._cache.filter(it => /Error|\s抽奖信息\]/.test(it)).join('\n')}`
                        );
                    }
                    config.is_outof_maxfollow = true;
                    config.only_followed = true;
                    event_bus.emit('Turn_on_the_Monitor');
                    break;
                case 5001:
                    event_bus.emit('Turn_off_the_Monitor', '转发失败');
                    break;
                default:
                    event_bus.emit('Turn_off_the_Monitor', `??? 未知错误: ${status}`);
                    break;
            }
        }
    }
    /**
     * 启动
     * @returns {Promise<number>}
     */
    async startLottery() {
        const allLottery = await this.filterLotteryInfo()
            , len = allLottery.length
            , { create_dy, create_dy_mode, wait, filter_wait } = config;

        log.info('筛选动态', `筛选完毕(${len})`);

        if (len) {
            let
                status = 0,
                is_exception = 0,
                is_outof_maxfollow = 0,
                relayed_nums = 0,
                total_nums = 0;
            for (const [index, lottery] of shuffle(allLottery).entries()) {
                total_nums += 1;
                let is_shutdown = false;
                if (
                    is_outof_maxfollow
                    && lottery.uid.length
                    && (new RegExp(lottery.uid.join('|'))).test(this.attentionList)
                ) {
                    log.info('过滤', `已关注(${lottery.uid.join(',')})`);
                    continue;
                }

                if (lottery.isOfficialLottery) {
                    let { ts } = await bili.getLotteryNotice(lottery.dyid);
                    const ts_10 = Date.now() / 1000;
                    if (ts === -1) {
                        log.warn('过滤', '无法判断开奖时间');
                        await delay(filter_wait);
                        continue;
                    }
                    if (ts === -9999) {
                        log.info('过滤', '已撤销抽奖');
                        d_storage.updateDyid(lottery.dyid);
                        await delay(filter_wait);
                        continue;
                    }
                    if (ts < ts_10) {
                        log.info('过滤', '已过开奖时间');
                        d_storage.updateDyid(lottery.dyid);
                        await delay(filter_wait);
                        continue;
                    }
                    if (ts > ts_10 + config.maxday * 86400) {
                        log.info('过滤', '超过指定开奖时间');
                        d_storage.updateDyid(lottery.dyid);
                        await delay(filter_wait);
                        continue;
                    }
                } else if (lottery.uid[0]) {
                    const { minfollower } = config;
                    if (minfollower > 0) {
                        const followerNum = await bili.getUserInfo(lottery.uid[0]);
                        if (followerNum === -1) {
                            log.warn('过滤', `粉丝数(${followerNum})获取失败`);
                            await delay(filter_wait);
                            continue;
                        }
                        if (followerNum < minfollower) {
                            log.info('过滤', `粉丝数(${followerNum})小于指定数量`);
                            d_storage.updateDyid(lottery.dyid);
                            await delay(filter_wait);
                            continue;
                        }
                    } else {
                        log.info('过滤', '不过滤粉丝数');
                    }
                }

                if (create_dy
                    && create_dy_mode instanceof Array
                    && index > 0
                    && index % getRandomOne(create_dy_mode[0]) === 0
                ) {
                    const number = getRandomOne(create_dy_mode[1]) || 0;
                    randomDynamic(number);
                }

                status = await this.go(lottery);
                switch (status) {
                    case 0:
                        relayed_nums += 1;
                        break;
                    case 1002:
                    case 1003:
                    case 1005:
                    case 1006:
                    case 1007:
                    case 1008:
                    case 1009:
                    case 1011:
                    case 2002:
                    case 2003:
                    case 3001:
                    case 4001:
                    case 4002:
                    case 4003:
                    case 4004:
                    case 5002:
                    case 5003:
                    case 5004:
                    case 5005:
                        status = 0;
                        break;
                    case 2004:
                        is_exception = 2004;
                        break;
                    case 4005:
                        is_exception = 4005;
                        break;
                    case 2005:
                        is_outof_maxfollow = 2005;
                        break;
                    case 1001:
                    case 1010:
                    case 1004:
                    case 2001:
                    case 5001:
                        is_shutdown = true;
                        break;
                    default:
                        break;
                }

                if (is_shutdown) break;

                d_storage.updateDyid(lottery.dyid);

                await delay(wait * (Math.random() + 0.5));
            }
            log.info('抽奖', `本轮共处理${total_nums}条,成功参与${relayed_nums}条`);
            return is_exception
                || is_outof_maxfollow
                || status;
        } else {
            log.info('抽奖', '无未转发抽奖');
            return 0;
        }
    }

    /**
     * 抽奖配置
     * @typedef {object} LotteryOptions
     * @property {number[]} uid 用户标识
     * @property {string} dyid 动态标识
     * @property {boolean} isOfficialLottery 是否官方抽奖
     * @property {string} relay_chat 转发词
     * @property {string} ctrl 定位@
     * @property {string} [rid] 评论标识
     * @property {number} chat_type 评论类型
     * @property {string} [chat] 评论词
     */
    /**
     * @returns {Promise<LotteryOptions[]>}
     */
    /**
     * 获取视频的真实aid和信息
     * @param {string} videoId - 视频ID，支持BV或av格式
     * @returns {Promise<{aid: string, bvid: string, title: string, author: string, authorId: string}>} 视频的aid和信息
     */
    async getVideoInfo(videoId) {
        try {
            const { send } = require('../net/http');
            
            // 构建API请求URL
            let apiUrl = '';
            if (videoId.startsWith('BV')) {
                // 使用B站API获取BV号对应的视频信息
                apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
            } else if (videoId.startsWith('av')) {
                // 对于av格式，直接提取数字部分
                const aid = videoId.replace(/^av/i, '');
                apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
            } else {
                // 对于其他格式，直接使用
                apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${videoId}`;
            }
            
            // 发送API请求
            const response = await new Promise((resolve, reject) => {
                send({
                    url: apiUrl,
                    method: 'GET',
                    config: {
                        redirect: true
                    },
                    success: ({ body }) => resolve(body),
                    failure: err => reject(err)
                });
            });
            
            // 解析响应
            const { strToJson } = require('../utils');
            const data = strToJson(response);
            
            if (data.code === 0 && data.data) {
                const aid = data.data.aid.toString();
                const bvid = data.data.bvid || videoId;
                const title = data.data.title || '视频';
                const author = data.data.owner?.name || '未知作者';
                const authorId = data.data.owner?.mid?.toString() || '0';
                log.info('获取视频信息', `成功通过API获取视频(${videoId})的信息: ${title} (av${aid}, BV${bvid}) by ${author}(${authorId})`);
                return { aid, bvid, title, author, authorId };
            } else {
                log.error('获取视频信息', `API返回错误: ${data.message || '未知错误'}`);
                return { aid: videoId, bvid: videoId, title: '视频', author: '未知作者', authorId: '0' };
            }
        } catch (error) {
            log.error('获取视频信息', `获取视频信息时出错: ${error.message}`);
            return { aid: videoId, bvid: videoId, title: '视频', author: '未知作者', authorId: '0' };
        }
    }
    
    /**
     * 处理pinglun环境变量指定的动态
     * @returns {Promise<LotteryOptions[]>}
     */
    async handlePingLunDynamic() {
        const { parseDynamicCard } = require('./searcher');
        const pinglunEnv = process.env.pinglun;
        
        if (!pinglunEnv) return [];
        
        // 解析pinglun环境变量，提取动态ID和视频ID
        const dyidSet = new Set();
        const videoAidSet = new Set();
        const allPairs = pinglunEnv.split(/[\n,;]+/);
        
        allPairs.forEach(pair => {
            const trimmedPair = pair.trim();
            if (trimmedPair) {
                const [dyidPart] = trimmedPair.split('#').map(item => item?.trim());
                if (dyidPart) {
                    // 检查是否是视频ID格式 (av或BV开头)
                    if (dyidPart.startsWith('av') || dyidPart.startsWith('BV')) {
                        // 对于视频ID，保持完整格式
                        videoAidSet.add(dyidPart);
                    } else {
                        // 支持动态ID和完整链接两种格式
                        let dyidNumber = dyidPart;
                        if (dyidPart.includes('bilibili.com')) {
                            // 从URL中提取数字ID
                            const urlMatch = dyidPart.match(/\d+/g);
                            if (urlMatch && urlMatch.length > 0) {
                                dyidNumber = urlMatch[urlMatch.length - 1]; // 获取最后一个数字作为动态ID
                            }
                        }
                        if (/^\d+$/.test(dyidNumber)) {
                            // 检查是否是视频链接
                            if (dyidPart.includes('/video/')) {
                                // 从视频链接中提取视频ID
                                const videoMatch = dyidPart.match(/(?:\/video\/(av|BV)(\d+))/);
                                if (videoMatch && videoMatch[1] && videoMatch[2]) {
                                    videoAidSet.add(`${videoMatch[1]}${videoMatch[2]}`);
                                } else {
                                    videoAidSet.add(dyidNumber);
                                }
                            } else {
                                dyidSet.add(dyidNumber);
                            }
                        }
                    }
                }
            }
        });
        
        const dyids = Array.from(dyidSet);
        const videoAids = Array.from(videoAidSet);
        let allInfos = [];
        
        log.info('筛选动态', `开始处理pinglun指定的动态(${dyids.length}个)和视频(${videoAids.length}个)`);
        
        // 处理动态
        for (const dyid of dyids) {
            try {
                const card = await bili.getOneDynamicByDyid(dyid);
                if (card) {
                    // 解析动态卡片数据
                    const parsed_card = parseDynamicCard(card);
                    
                    // 转换为与其他搜索函数一致的数据格式
                    const formatted_data = {
                        lottery_info_type: 'pinglun',
                        create_time: parsed_card.create_time,
                        is_liked: parsed_card.is_liked,
                        uids: [parsed_card.uid, parsed_card.origin_uid],
                        uname: parsed_card.uname,
                        ctrl: parsed_card.ctrl,
                        dyid: parsed_card.dyid,
                        reserve_id: parsed_card.reserve_id,
                        reserve_lottery_text: parsed_card.reserve_lottery_text,
                        is_charge_lottery: parsed_card.is_charge_lottery,
                        rid: parsed_card.rid_str,
                        chat_type: parsed_card.chat_type,
                        des: parsed_card.description,
                        type: parsed_card.type,
                        hasOfficialLottery: parsed_card.hasOfficialLottery
                    };
                    
                    allInfos.push(formatted_data);
                    log.info('获取动态', `成功获取pinglun指定动态(${dyid})的信息`);
                } else {
                    log.warn('获取动态', `无法获取pinglun指定动态(${dyid})的信息`);
                }
            } catch (e) {
                log.error('获取动态', `获取pinglun指定动态(${dyid})信息时出错: ${e}`);
            }
        }
        
        // 处理视频
        for (const aid of videoAids) {
            try {
                // 获取视频的真实aid和信息
                const videoInfo = await this.getVideoInfo(aid);
                
                // 为视频创建特殊的格式数据
                const videoInfoObj = {
                    lottery_info_type: 'video',
                    create_time: Math.floor(Date.now() / 1000),
                    is_liked: false,
                    uids: [parseInt(videoInfo.authorId) || 0, 0], // 保存视频作者ID
                    uname: videoInfo.author,
                    ctrl: [],
                    dyid: aid, // 使用完整格式作为dyid
                    reserve_id: '',
                    reserve_lottery_text: '',
                    is_charge_lottery: false,
                    rid: videoInfo.aid, // 使用真实aid作为rid
                    chat_type: 1, // 视频评论的chat_type为1
                    des: `视频评论 (${aid}) - ${videoInfo.title}`,
                    type: 8, // 视频类型
                    hasOfficialLottery: false,
                    isVideo: true, // 标记为视频类型
                    videoTitle: videoInfo.title, // 保存视频标题
                    authorId: videoInfo.authorId, // 保存作者ID
                    bvid: videoInfo.bvid // 保存BV号
                };
                
                allInfos.push(videoInfoObj);
                log.info('获取视频', `成功创建pinglun指定视频(${aid})的评论信息，标题: ${videoInfo.title}，真实aid: ${videoInfo.aid}，BV号: ${videoInfo.bvid}，作者: ${videoInfo.author}(${videoInfo.authorId})，uids: ${JSON.stringify(videoInfoObj.uids)}`);
            } catch (e) {
                log.error('获取视频', `处理pinglun指定视频(${aid})信息时出错: ${e}`);
            }
        }
        
        log.info('筛选动态', `成功获取${allInfos.length}个pinglun指定内容的信息`);
        return allInfos;
    }
    
    async filterLotteryInfo() {
        const { lottery_param, LotteryInfoMap, attentionList } = this;
        
        let protoLotteryInfo = [];
        
        // 检查是否设置了pinglun环境变量，如果设置了，直接处理指定的动态
        if (hasEnv('pinglun') && process.env.pinglun) {
            log.info('筛选动态', '检测到pinglun环境变量，直接处理指定动态');
            protoLotteryInfo = await this.handlePingLunDynamic();
        } else {
            // 否则，使用默认的搜索方式获取动态信息
            protoLotteryInfo = await LotteryInfoMap.get(lottery_param[0])(lottery_param[1]);
        }
        
        log.info('筛选动态', `开始筛选(${protoLotteryInfo.length})`);

        /** 所有抽奖信息 */
        let alllotteryinfo = [];
        const
            { check_if_duplicated, save_lottery_info_to_file,
                set_lottery_info_url, disable_reserve_lottery,
                is_not_relay_reserve_lottery,
                reserve_lottery_wait, sneaktower, key_words,
                model, chatmodel, chat: chats, relay: relays,
                block_dynamic_type, max_create_time, is_imitator,
                only_followed, at_users, blockword, blacklist, ai_comments_parm,
                answer_keywords, skip_answer_lottery } = config,
            now_ts = Date.now() / 1000;

        /**
         * @type {Map<String, Boolean>}
         */
        let dyids_map = new Map();

        /**去重 */
        protoLotteryInfo = protoLotteryInfo.filter(({ dyid }) => {
            if (dyids_map.has(dyid)) {
                return false;
            }
            dyids_map.set(dyid, false);
            return true;
        });

        log.info('筛选动态', `去重后(${protoLotteryInfo.length})`);

        /**并发查询dyid - 当设置了pinglun环境变量时，跳过查询，直接处理指定动态 */
        if (check_if_duplicated >= 1 && !hasEnv('pinglun')) {
            await Promise.all(
                [...dyids_map.keys()]
                    .map(it => d_storage
                        .searchDyid(it)
                        .then(hasIt => dyids_map.set(it, hasIt))
                    )
            );
            log.info('筛选动态', '并发查询本地dyid完毕');
        }

        if (lottery_param[0] !== 'APIs' && save_lottery_info_to_file && protoLotteryInfo.length) {
            log.info('保存抽奖信息', '保存开始');
            await appendLotteryInfoFile(lottery_param[1].toString(), protoLotteryInfo);
        }

        if (lottery_param[0] !== 'APIs' && set_lottery_info_url && protoLotteryInfo.length) {
            log.info('上传抽奖信息', '上传开始');
            await new Promise((resolve) => {
                send({
                    url: set_lottery_info_url,
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    contents: protoLotteryInfo,
                    success: ({ body }) => {
                        log.info('发送获取到的动态数据', body);
                        resolve();
                    },
                    failure: err => {
                        log.error('发送获取到的动态数据', err);
                        resolve();
                    }
                });
            });
        }

        // 在循环开始前解析pinglun环境变量
        const parsePingLunEnvForFilter = () => {
            const envMap = {};
            if (hasEnv('pinglun')) {
                const pinglunEnv = process.env.pinglun;
                if (pinglunEnv) {
                    // 支持换行、逗号、分号等多种分隔符
                    const allPairs = pinglunEnv.split(/[\n,;]+/);
                    
                    allPairs.forEach(pair => {
                        const trimmedPair = pair.trim();
                        if (trimmedPair) {
                            const [dyidPart] = trimmedPair.split('#').map(item => item?.trim());
                            if (dyidPart) {
                                // 直接添加原始值到映射
                                envMap[dyidPart] = true;
                                
                                // 处理视频ID格式 (av或BV开头)
                                if (dyidPart.startsWith('av') || dyidPart.startsWith('BV')) {
                                    // 提取视频ID部分（去掉av或BV前缀）
                                    const aidNumber = dyidPart.replace(/^(av|BV)/i, '');
                                    if (aidNumber) {
                                        envMap[aidNumber] = true;
                                        envMap[dyidPart] = true; // 确保完整格式也在映射中
                                        envMap[`https://www.bilibili.com/video/${dyidPart}`] = true;
                                    }
                                } else if (dyidPart.includes('bilibili.com')) {
                                    // 处理链接格式
                                    envMap[dyidPart] = true;
                                    // 从URL中提取数字ID
                                    const urlMatch = dyidPart.match(/\d+/g);
                                    if (urlMatch && urlMatch.length > 0) {
                                        const dyidNumber = urlMatch[urlMatch.length - 1];
                                        envMap[dyidNumber] = true;
                                        // 为每个动态ID生成并添加所有可能的URL格式
                                        envMap[`https://www.bilibili.com/opus/${dyidNumber}`] = true;
                                        envMap[`https://t.bilibili.com/${dyidNumber}`] = true;
                                        envMap[`https://bilibili.com/t/${dyidNumber}`] = true;
                                    }
                                    // 检查是否是视频链接
                                    if (dyidPart.includes('/video/')) {
                                        const videoMatch = dyidPart.match(/(?:\/video\/(av|BV)(\d+))/);
                                        if (videoMatch && videoMatch[1] && videoMatch[2]) {
                                            const fullAid = `${videoMatch[1]}${videoMatch[2]}`;
                                            const aidNumber = videoMatch[2];
                                            envMap[aidNumber] = true;
                                            envMap[fullAid] = true;
                                            envMap[`https://www.bilibili.com/video/${fullAid}`] = true;
                                        }
                                    }
                                } else if (/^\d+$/.test(dyidPart)) {
                                    // 处理纯数字ID
                                    envMap[dyidPart] = true;
                                    envMap[`https://www.bilibili.com/opus/${dyidPart}`] = true;
                                    envMap[`https://t.bilibili.com/${dyidPart}`] = true;
                                    envMap[`https://bilibili.com/t/${dyidPart}`] = true;
                                }
                            }
                        }
                    });
                }
            }
            return envMap;
        };

        // 在循环开始前解析pinglun环境变量
        const pinglunFilterMap = parsePingLunEnvForFilter();
        const hasPingLunConfig = Object.keys(pinglunFilterMap).length > 0;

        /* 检查动态是否满足要求 */
        await try_for_each(protoLotteryInfo, async function (lottery_info) {
            const {
                lottery_info_type, is_liked,
                uids, uname, dyid, reserve_id,
                reserve_lottery_text,
                is_charge_lottery,
                create_time, chat_type,
                ctrl, rid, des, type,
                hasOfficialLottery,
                authorId,
                videoTitle
            } = lottery_info;

            log.debug('正在筛选的动态信息', lottery_info);

            // 如果pinglun环境变量存在，检查当前内容是否在指定列表中
            if (hasPingLunConfig) {
                // 对于视频类型，需要特殊处理匹配逻辑
                if (lottery_info_type === 'video') {
                    // 检查原始视频ID格式和真实aid
                    const isInMap = pinglunFilterMap[dyid] || // 检查原始视频ID（如BV1JKqGBtEiH）
                                   pinglunFilterMap[rid] || // 检查真实aid（如115734235644316）
                                   pinglunFilterMap[`https://www.bilibili.com/video/${dyid}`] || // 检查视频链接
                                   pinglunFilterMap[`https://www.bilibili.com/video/av${rid}`]; // 检查av格式链接
                    
                    if (!isInMap) {
                        log.info('筛选动态', `非pinglun指定视频，跳过评论(rid: ${rid}, dyid: ${dyid})`);
                        return false;
                    }
                } else {
                    // 对于动态类型，检查dyid和相关链接
                    const dynamicUrl = `https://www.bilibili.com/opus/${dyid}`;
                    const tDynamicUrl = `https://t.bilibili.com/${dyid}`;
                    const tShortDynamicUrl = `https://bilibili.com/t/${dyid}`;
                    if (!pinglunFilterMap[dyid] && 
                        !pinglunFilterMap[dynamicUrl] && 
                        !pinglunFilterMap[tDynamicUrl] && 
                        !pinglunFilterMap[tShortDynamicUrl]) {
                        log.info('筛选动态', `非pinglun指定动态，跳过评论(https://t.bilibili.com/${dyid})`);
                        return false;
                    }
                }
            }

            if (des === '') {
                // 对于视频类型，描述为空是正常的
                if (lottery_info_type === 'video') {
                    log.info('筛选动态', `视频评论，描述为空(rid: ${rid})`);
                } else {
                    log.info('筛选动态', `获取动态内容为空(https://t.bilibili.com/${dyid})风控`);
                    return false;
                }
            }

            if (lottery_info_type.startsWith('sneak') && sneaktower) {
                log.info('筛选动态', `偷塔模式不检查是否已转发(https://t.bilibili.com/${dyid})`);
            } else {
                /* 遇到转发过就退出 */
                if (
                    ((!check_if_duplicated || check_if_duplicated >= 2) && is_liked)
                    || ((check_if_duplicated >= 1) && dyids_map.get(dyid))
                ) {
                    // 对于视频类型，不需要检查是否已转发
                    if (lottery_info_type === 'video') {
                        log.info('筛选动态', `视频评论，跳过转发检查(rid: ${rid})`);
                    } else {
                        log.info('筛选动态', `已转发(https://t.bilibili.com/${dyid})`);
                        return false;
                    }
                }
            }

            /* 超过指定时间退出 */
            if (create_time && now_ts - create_time > max_create_time * 86400) {
                // 对于视频类型，不需要检查创建时间
                if (lottery_info_type === 'video') {
                    log.info('筛选动态', `视频评论，跳过时间检查(rid: ${rid})`);
                } else {
                    log.info('筛选动态', `过时动态(https://t.bilibili.com/${dyid})`);
                    return false;
                }
            }

            if (is_charge_lottery) {
                log.info('筛选动态', `充电抽奖(https://t.bilibili.com/${dyid})`);
                return false;
            }

            const
                [m_uid, ori_uid] = uids,
                mIsFollowed = !m_uid || (new RegExp(m_uid)).test(attentionList),
                oriIsFollowed = !ori_uid || (new RegExp(ori_uid)).test(attentionList),
                /**判断是转发源动态还是现动态 实际发奖人*/
                [real_uid, realIsFollowed] = lottery_info_type === 'uid'
                    ? [ori_uid, oriIsFollowed]
                    : [m_uid, mIsFollowed],
                description = des.split(/\/\/@.*?:/)[0],
                needAt = /(?:@|艾特)[^@|(艾特)]*?好友/.test(description),
                needTopic = [...new Set(description.match(/(?<=[带加]上?(?:话题|tag).*)#.+?#|(?<=[带加])上?#.+?#(?=话题|tag)/ig) || [])].join(' '),
                isRelayDynamic = type === 1,
                has_key_words = key_words.every(it => new RegExp(it).test(description)),
                isBlock = blockword.length && new RegExp(blockword.join('|')).test(description + reserve_lottery_text),
                // 检查是否需要答题
                isAnswerLottery = answer_keywords.length && new RegExp(answer_keywords.join('|')).test(description + reserve_lottery_text),
                isLottery =
                    (is_imitator && lottery_info_type === 'uid' && model !== '00')
                    || (hasOfficialLottery && model[0] === '1')
                    || (!hasOfficialLottery && model[1] === '1' && (has_key_words || hasPingLunConfig)),
                isSendChat =
                    (hasOfficialLottery && chatmodel[0] === '1')
                    || (!hasOfficialLottery && chatmodel[1] === '1'),
                keys = [dyid, m_uid, ori_uid];

            log.debug('筛选动态', { real_uid, mIsFollowed, oriIsFollowed, realIsFollowed, needAt, needTopic, type, isRelayDynamic, key_words, has_key_words, blockword, isBlock, isLottery, isSendChat });

            if (
                blacklist.split(',').some(id => keys.some(key => {
                    if (key + '' === id) {
                        log.info('筛选动态', `黑名单匹配(${id})(https://t.bilibili.com/${dyid})`);
                        return true;
                    } else {
                        return false;
                    }
                }))
            ) {
                return false;
            }

            if (block_dynamic_type.includes(type)) {
                // 如果是pinglun模式，跳过动态类型屏蔽检查
                if (!hasPingLunConfig) {
                    log.warn('筛选动态', `屏蔽动态类型 ${type}`);
                    return false;
                }
            }

            /**屏蔽词 */
            if (isBlock) {
                log.info('筛选动态', `包含屏蔽词(https://t.bilibili.com/${dyid})`);
                return false;
            }

            /**答题动态检查 */
            if (isAnswerLottery && skip_answer_lottery && !hasPingLunConfig) {
                const skipUrl = `https://t.bilibili.com/${dyid}`;
                
                // 检查是否已记录过
                const datiFilePath = path.join(__dirname, '../data/dati.txt');
                let lastDate = '';
                let recordedUrls = [];
                
                try {
                    if (fs.existsSync(datiFilePath)) {
                        const content = fs.readFileSync(datiFilePath, 'utf8');
                        const lines = content.split('\n').filter(line => line.trim());
                        
                        // 找到最后一行日期
                        for (let i = lines.length - 1; i >= 0; i--) {
                            const line = lines[i].trim();
                            if (line && !line.startsWith('http')) {
                                lastDate = line;
                                break;
                            }
                        }
                        
                        // 提取所有URL（跳过日期行）
                        recordedUrls = lines.filter(line => line.trim() && line.startsWith('http'));
                    }
                } catch (e) {
                    log.warn('读取记录文件', `读取data/dati.txt失败: ${e.message}`);
                }
                
                // 如果URL已记录，跳过推送
                if (recordedUrls.includes(skipUrl)) {
                    log.info('筛选动态', `需要答题的动态(${skipUrl})，已跳过（已记录）`);
                    return false;
                }
                
                log.info('筛选动态', `需要答题的动态(${skipUrl})，已跳过`);
                
                // 只有账号1才推送答题跳过的动态
                if (process.env.NUMBER === '1') {
                    await sendQmsgOnly(
                        `跳过答题动态`,
                        `动态URL: ${skipUrl}`
                    );
                    
                    // 记录到data/dati.txt
                    const now = new Date();
                    const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
                    
                    try {
                        // 检查是否需要写日期
                        if (lastDate !== dateStr) {
                            // 日期变化，空一行并写新日期
                            fs.appendFileSync(datiFilePath, '\n' + dateStr + '\n', 'utf8');
                            log.info('记录跳过动态', `已记录日期: ${dateStr}`);
                        }
                        
                        // 追加URL
                        fs.appendFileSync(datiFilePath, skipUrl + '\n', 'utf8');
                        log.info('记录跳过动态', `已记录URL: ${skipUrl}`);
                    } catch (e) {
                        log.error('记录跳过动态', `记录到data/dati.txt失败: ${e.message}`);
                    }
                }
                return false;
            }

            if (reserve_id) {
                if (disable_reserve_lottery) {
                    log.info('已关闭预约抽奖功能');
                } else {
                    log.info('预约抽奖', '开始');
                    log.info('预约抽奖', `奖品: ${reserve_lottery_text}`);
                    if (hasEnv('NOT_GO_LOTTERY')) {
                        log.info('NOT_GO_LOTTERY', 'ON');
                    } else {
                        await delay(reserve_lottery_wait);
                        await bili.reserve_lottery(reserve_id);
                    }
                }
                if (is_not_relay_reserve_lottery === true) {
                    log.info('预约抽奖', '已关闭预约抽奖转关功能');
                    return false;
                }
            }

            if (!hasOfficialLottery && model[1] === '1' && !has_key_words && !hasPingLunConfig && description) {
                log.warn('筛选动态', `无关键词动态的描述: ${description}\n\n考虑是否修改设置key_words:\n${key_words.join('\n且满足: ')}`);
            }

            /**若勾选只转已关注 */
            if (only_followed
                && (!mIsFollowed || !oriIsFollowed)
            ) {
                log.info('筛选动态', `只转已关注(https://t.bilibili.com/${dyid})`);
                return false;
            }

            if (isLottery) {
                let onelotteryinfo = {};

                onelotteryinfo.isOfficialLottery = hasOfficialLottery;
                onelotteryinfo.isVideo = lottery_info_type === 'video'; // 标记是否为视频类型
                onelotteryinfo.authorId = authorId; // 保存视频作者ID（用于视频转发）

                /**初始化待关注列表 */
                onelotteryinfo.uid = [];

                if (!realIsFollowed) {
                    onelotteryinfo.uid.push(real_uid);
                }

                onelotteryinfo.dyid = dyid;

                let
                    /**转发评语 */
                    RandomStr = (getRandomOne(relays) || '!!!')
                        .replace(/\$\{uname\}/g, uname),
                    /**控制字段 */
                    new_ctrl = [];

                /* 是否需要带话题 */
                if (needTopic) {
                    RandomStr += needTopic;
                }

                /* 是否需要@ */
                if (needAt) {
                    at_users.forEach(it => {
                        new_ctrl.push({
                            data: String(it[1]),
                            location: RandomStr.length,
                            length: it[0].length + 1,
                            type: 1
                        });
                        RandomStr += '@' + it[0];
                    });
                }

                /* 是否是转发的动态 */
                if (isRelayDynamic) {
                    /* 转发内容长度+'//'+'@'+用户名+':'+源内容 */
                    const addlength = RandomStr.length + 2 + uname.length + 1 + 1;
                    onelotteryinfo.relay_chat = RandomStr + `//@${uname}:` + des;
                    new_ctrl.push({
                        data: String(real_uid),
                        location: RandomStr.length + 2,
                        length: uname.length + 1,
                        type: 1
                    });
                    ctrl.map(item => {
                        item.location += addlength;
                        return item;
                    }).forEach(it => new_ctrl.push(it));
                    if (!oriIsFollowed) {
                        onelotteryinfo.uid.push(ori_uid);
                    }
                } else {
                    onelotteryinfo.relay_chat = RandomStr;
                }

                onelotteryinfo.ctrl = JSON.stringify(new_ctrl);

                /* 根据动态的类型决定评论的类型 */
                if (lottery_info_type === 'video') {
                    // 视频评论的chat_type固定为1
                    onelotteryinfo.chat_type = 1;
                } else {
                    onelotteryinfo.chat_type = chat_type;
                }

                /* 是否评论 */
                if (isSendChat) {
                    onelotteryinfo.rid = rid;
                    
                    // 解析环境变量中的特定评论配置
                    const parsePingLunEnv = () => {
                        const envMap = {};
                        if (hasEnv('pinglun')) {
                            const pinglunEnv = process.env.pinglun;
                            if (pinglunEnv) {
                                // 支持换行、逗号、分号等多种分隔符
                                const allPairs = pinglunEnv.split(/[\n,;]+/);
                                
                                allPairs.forEach(pair => {
                                    const trimmedPair = pair.trim();
                                    if (trimmedPair) {
                                        const [dyidPart, content] = trimmedPair.split('#').map(item => item?.trim());
                                        if (dyidPart && content) {
                                            // 解析评论内容和图片链接
                                            const textMatch = content.match(/^(.*?)(?:\s+https?:\/\/i\d+\.hdslb\.com\/bfs\/.*?\.(png|jpg|jpeg|gif))+$/i);
                                            const text = textMatch ? textMatch[1] : content;
                                            // 提取所有图片链接
                                            const imageLinks = content.match(/https?:\/\/i\d+\.hdslb\.com\/bfs\/.*?\.(png|jpg|jpeg|gif)/gi) || [];
                                            
                                            // 构建评论数据结构
                                            const chatData = {
                                                text: text.trim(),
                                                images: imageLinks
                                            };
                                            
                                            // 支持动态ID和完整链接两种格式
                                            envMap[dyidPart] = chatData;
                                            // 从完整链接中提取动态ID（支持多种URL格式）
                                            // 支持: bilibili.com/opus/123, bilibili.com/t/123, t.bilibili.com/123
                                            let dyidNumber = dyidPart;
                                            if (dyidPart.includes('bilibili.com')) {
                                                // 从URL中提取数字ID
                                                const urlMatch = dyidPart.match(/\d+/g);
                                                if (urlMatch && urlMatch.length > 0) {
                                                    dyidNumber = urlMatch[urlMatch.length - 1]; // 获取最后一个数字作为动态ID
                                                }
                                            }
                                            if (/^\d+$/.test(dyidNumber)) {
                                                envMap[dyidNumber] = chatData;
                                            }
                                        }
                                    }
                                });
                            }
                        }
                        return envMap;
                    };
                    
                    // 检查是否有特定动态的评论映射
                    const dynamicUrl = `https://www.bilibili.com/opus/${dyid}`;
                    const envMap = parsePingLunEnv();
                    
                    // 优先级：环境变量配置 > AI生成评论 > 随机固定评论
                    let specificChat = envMap[dyid] || envMap[dynamicUrl];
                    
                    if (specificChat) {
                        // 使用特定评论内容
                        let chatText;
                        let chatPictures = [];
                        
                        if (typeof specificChat === 'object' && specificChat.text) {
                            chatText = specificChat.text;
                            chatPictures = specificChat.images || [];
                        } else {
                            chatText = specificChat;
                        }
                        
                        // 对于视频类型，使用视频链接
                        if (lottery_info_type === 'video') {
                            log.info('使用特定评论内容', `(video rid: ${rid}) - ${chatText}${chatPictures.length > 0 ? ` (含${chatPictures.length}张图片)` : ''}`);
                        } else {
                            log.info('使用特定评论内容', `(https://t.bilibili.com/${dyid}) - ${chatText}${chatPictures.length > 0 ? ` (含${chatPictures.length}张图片)` : ''}`);
                        }
                        onelotteryinfo.chat = chatText;
                        onelotteryinfo.pictures = chatPictures;
                    } else if (hasEnv('ENABLE_AI_COMMENTS')) {
                        try {
                            // 对于视频类型，使用视频标题作为AI评论的上下文
                            let aiContext = lottery_info.des;
                            if (lottery_info_type === 'video' && videoTitle) {
                                aiContext = `视频标题: ${videoTitle}`;
                                log.info('开始获取Ai评论', `(video rid: ${rid}, 标题: ${videoTitle})`);
                            } else {
                                log.info('开始获取Ai评论', `(https://t.bilibili.com/${dyid})`);
                            }
                            onelotteryinfo.chat = await getAiContent(
                                config.ai_comments_parm.url,
                                config.ai_comments_parm.body,
                                config.ai_comments_parm.prompt,
                                aiContext) || '1';
                            
                            // 清理AI返回的评论，只保留第一行（去除"或者："等分隔符）
                            if (onelotteryinfo.chat) {
                                onelotteryinfo.chat = onelotteryinfo.chat.split(/或者[:：\n\r\n]/)[0].trim();
                            }
                            
                            // 如果有话题标签，添加到AI评论末尾
                            if (needTopic) {
                                onelotteryinfo.chat += ' ' + needTopic;
                            }
                            log.info('获取到Ai评论内容', `${onelotteryinfo.chat}`);
                        } catch (e) {
                            log.error('获取AI评论失败，使用随机评论', e);
                            let randomChat = (getRandomOne(config.chats) || '2').replace(/\$\{uname\}/g, uname);
                            // 如果有话题标签，添加到随机评论末尾
                            if (needTopic) {
                                randomChat = randomChat.trim() + ' ' + needTopic;
                            }
                            onelotteryinfo.chat = randomChat;
                        }
                    } else {
                        let randomChat = (getRandomOne(config.chats) || '3').replace(/\$\{uname\}/g, uname);
                        // 如果有话题标签，添加到随机评论末尾
                        if (needTopic) {
                            randomChat = randomChat.trim() + ' ' + needTopic;
                        }
                        onelotteryinfo.chat = randomChat;
                    }
                }

                alllotteryinfo.push(onelotteryinfo);
            } else {
                log.info('筛选动态', `非抽奖动态(https://t.bilibili.com/${dyid})`);
            }
        });

        return alllotteryinfo;
    }
    /**
     * 关注转发评论
     * @param {LotteryOptions} option
     * @returns {Promise<number>}
     * - 成功 0
     * - 评论 未知错误 1001
     * - 评论 原动态已删除 1002
     * - 评论 评论区已关闭 1003
     * - 评论 需要输入验证码 1004
     * - 评论 已被对方拉入黑名单 1005
     * - 评论 黑名单用户无法互动 1006
     * - 评论 UP主已关闭评论区 1007
     * - 评论 内容包含敏感信息 1008
     * - 评论 重复评论 1009
     * - 评论 帐号未登录 1010
     * - 评论 关注UP主7天以上的人可发评论 1011
     * - 关注 未知错误 2001
     * - 关注 您已被对方拉入黑名单 2002
     * - 关注 黑名单用户无法关注 2003
     * - 关注 账号异常 2004
     * - 关注 关注已达上限 2005
     * - 分区 移动失败 3001
     * - 点赞 未知错误 4001
     * - 点赞 点赞异常 4002
     * - 点赞 点赞频繁 4003
     * - 点赞 已赞过 4004
     * - 点赞 账号异常，点赞失败 4005
     * - 转发 未知错误 5001
     * - 转发 该动态不能转发分享 5002
     * - 转发 请求数据发生错误，请刷新或稍后重试 5003
     * - 转发 操作太频繁了，请稍后重试 5004
     * - 转发 源动态禁止转发 5005
     */
    async go(option) {
        log.debug('正在转发的动态信息', option);
        if (hasEnv('NOT_GO_LOTTERY')) {
            log.info('NOT_GO_LOTTERY', 'ON');
            return 0;
        }

        let
            status = 0,
            { uid, dyid, chat_type, rid, relay_chat, ctrl, chat, pictures, isVideo, authorId } = option,
            { check_if_duplicated, is_copy_chat, copy_blockword, is_repost_then_chat, is_not_create_partition } = config;

        /* 评论 */
        if (rid && chat_type) {
            if (is_copy_chat) {
                const copy_chat = getRandomOne(
                    (await bili.getChat(rid, chat_type))
                        .filter(it => !(new RegExp(copy_blockword.join('|')).test(it[1])))
                ) || [';;;;;;;;;', chat || '!!!'];
                chat = copy_chat[1]
                    .replace(
                        new RegExp(copy_chat[0], 'g'),
                        global_var.get('myUNAME') || '');
            } else {
                if (is_repost_then_chat) {
                    chat = chat + relay_chat;
                }
            }

            // 格式化图片参数为B站API需要的格式
            const formattedPictures = (pictures || []).map(imgUrl => ({
                img_src: imgUrl,
                img_width: 0, // 默认值，B站会自动处理
                img_height: 0, // 默认值，B站会自动处理
                img_size: 0, // 默认值，B站会自动处理
                ai_gen_pic: 0 // 不是AI生成的图片
            }));
            
            status = await retryfn(
                6,
                [4],
                () => bili.sendChatWithOcr(
                    rid,
                    chat,
                    chat_type,
                    formattedPictures
                )
            );

            if (status === 8 ||
                status === 9) {
                // 当原评论失败时使用备用评论，不包含图片
                status = await bili.sendChatWithOcr(
                    rid,
                    '[doge][doge][doge][doge][doge]',
                    chat_type,
                    []
                );
            }

            if (status) {
                log.warn('抽奖信息', `dyid: ${dyid}, rid: ${rid}, chat_type: ${chat_type}`);
                return 1000 + status;
            }
        }

        /* 关注 */
        if (uid.length) {
            await try_for_each(uid, async (u) => {
                status = await bili.autoAttention(u);
                if (status === 6) {
                    status = 0;
                    return false;
                }
                if (status) {
                    log.warn('抽奖信息', `dyid: ${dyid}, uid: ${u}`);
                    return true;
                } else {
                    if (is_not_create_partition !== true) {
                        if (await bili.movePartition(u, this.tagid)) {
                            log.warn('抽奖信息', `dyid: ${dyid}, uid: ${u} tagid: ${this.tagid}`);
                            /* 3000系错误 */
                            status = 1001;
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            });
            if (status) return 2000 + status;
        }

        /* 点赞 */
        // 对于视频类型，跳过点赞（因为视频点赞API不同）
        if (!option.isVideo && (!check_if_duplicated || check_if_duplicated === 3)) {
            status = await retryfn(
                5,
                [3],
                () => bili.autolike(dyid)
            );

            if (status) {
                log.warn('抽奖信息', `dyid: ${dyid}`);
                return 4000 + status;
            }
        }

        /* 转发 */
        if (dyid) {
            if (option.isVideo) {
                // 对于视频类型，使用视频分享API
                log.info('转发视频', `开始转发视频(${dyid})`);
                // 使用视频作者的ID作为uid参数，这是B站API要求的
                const authorId = option.authorId || (option.uids && option.uids[0]) || 0;
                log.info('转发视频', `使用作者ID: ${authorId}，视频ID: ${rid}`);
                
                // 使用新的视频分享方法
                const shareStatus = await bili.shareVideo(authorId, rid);
                if (!shareStatus) {
                    log.info('转发视频', `成功转发视频(${dyid})`);
                } else {
                    log.error('转发视频', `转发视频失败(${dyid})`);
                    // 视频转发失败不影响整体任务
                }
            } else {
                // 对于动态类型，使用动态转发API
                status = await retryfn(
                    5,
                    [3, 4],
                    () => bili.autoRelay(
                        global_var.get('myUID'),
                        dyid,
                        relay_chat,
                        ctrl)
                );

                if (status) {
                    log.warn('抽奖信息', `dyid: ${dyid}`);
                    return 5000 + status;
                }
            }
        }

        return status;
    }
}


module.exports = { Monitor };
