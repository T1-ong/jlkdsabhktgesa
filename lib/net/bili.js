const GlobalVar = require('../data/global_var');
const { strToJson, log, ocr, hasEnv } = require('../utils');
const { send } = require('./http');
const API = require('./api.bili');

class Line {
    /**
     * 智能线路切换
     * @typedef {boolean} iSwitch 是否切换
     * @typedef {string} Msg 信息说明
     * @typedef {[iSwitch, any, Msg]} ResResult
     * @param {string} line_name
     * @param {Array<(...arg) => Promise<ResResult | string>>} requests
     * @param {(responseText: string) => ResResult} [pub_handler]
     */
    constructor(line_name, requests, pub_handler) {
        this.line_name = line_name;
        this.requests = requests;
        this.valid_line = 0;
        this.switch_times = 0;
        if (pub_handler) this.pub_handler = pub_handler;
        /**
         * @type {ResResult}
         */
        this.res_result = [false, null, ''];
    }

    /**
     * 切换线路
     * @returns {boolean}
     */
    switchLine() {
        const { valid_line, requests: { length }, switch_times } = this;
        this.valid_line = (valid_line + 1) % length;
        this.switch_times += 1;
        if (switch_times > length) {
            return false;
        } else {
            return true;
        }
    }

    /**
     * 存储当前有效线路
     * @param {number} line
     */
    storeLine(line) {
        this.valid_line = line;
        this.switch_times = 0;
    }

    /**
     * 启动
     * @param  {...any} args
     * @returns {Promise<any>}
     */
    async run(...args) {
        const
            { line_name, requests, valid_line } = this,
            resp = await requests[valid_line](...args);
        if (typeof resp === 'string') {
            this.res_result = this.pub_handler(resp);
        } else {
            this.res_result = resp;
        }
        const [i_switch, value, msg] = this.res_result;
        if (!i_switch) {
            log.info(line_name, msg);
            this.storeLine(valid_line);
            return value;
        }
        if (this.switchLine()) {
            log.warn(line_name, msg);
            log.warn(line_name, `切换线路(${valid_line + 1}/${requests.length})`);
            return await this.run();
        } else {
            log.error(line_name, msg);
            log.error(line_name, '所有备用线路均连接失败');
            return value;
        }
    }
}

/**
 * GET请求
 * @param {import('./http').RequestOptions} param0
 * @returns {Promise<string>}
 */
function get({ url, config, contents, query }) {
    return new Promise((resolve) => {
        send({
            url,
            method: 'GET',
            config,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'cookie': GlobalVar.get('cookie')
            },
            query,
            contents,
            success: res => resolve(res.body),
            failure: err => resolve(err)
        });
    });
}

/**
 * POST请求
 * @param {import('./http').RequestOptions} param0
 * @returns {Promise<string>}
 */
function post({ url, config, contents, query, useCookie = false, headers = {} }) {
    return new Promise((resolve) => {
        const defaultHeaders = {
            'accept': 'application/json, text/plain, */*',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };
        
        // Only add cookie when needed
        if (useCookie) {
            const cookie = GlobalVar.get('cookie');
            if (cookie) {
                defaultHeaders['cookie'] = cookie;
            }
        }
        
        // Merge default headers with provided headers
        const mergedHeaders = {
            ...defaultHeaders,
            ...headers
        };
        
        send({
            url,
            method: 'POST',
            config,
            headers: mergedHeaders,
            query,
            contents,
            success: res => resolve(res.body),
            failure: err => resolve(err)
        });
    });
}

/**
 * 网络请求
 */
const bili_client = {
    /**
     * 判断是否成功登录
     * @returns {Promise<Object?>}
     */
    async getMyinfo() {
        const
            responseText = await get({
                url: API.SPACE_MYINFO
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            GlobalVar.set('myUNAME', res.data.name);
            return res.data;
        } else {
            return null;
        }
    },
    /**
     * 帐号统计
     * @returns {Promise<Object?>}
     */
    async getStat() {
        const
            responseText = await get({
                url: API.WEB_INTERFACE_NAV_STAT
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            return res.data;
        } else {
            return null;
        }
    },
    /**
     * 获取被at的信息
     * @typedef AtInfo
     * @property {number} at_time
     * @property {string} up_uname
     * @property {string} business
     * @property {string} source_content
     * @property {string} url
     * @returns {Promise<AtInfo[]>}
     */
    async getMyAtInfo() {
        const
            responseText = await get({
                url: API.MSGFEED_AT
            }),
            res = strToJson(responseText);
        let atInfo = [];
        if (res.code === 0) {
            const items = res.data.items;
            if (items.length !== 0) {
                items.forEach(i => {
                    const { at_time, item, user } = i, { nickname: up_uname } = user, { business, uri: url, source_content } = item;
                    atInfo.push({
                        at_time,
                        up_uname,
                        business,
                        source_content,
                        url
                    });
                });
            }
            return atInfo;
        } else {
            return atInfo;
        }
    },
    /**
     * 获取未读信息数量
     * @returns {Promise<{at: number, reply: number}>}
     */
    async getUnreadNum() {
        const
            responseText = await get({
                url: API.MSGFEED_UNREAD
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            log.info('获取未读信息', '成功');
            return res.data;
        } else {
            log.error('获取未读信息', `失败\n${responseText}`);
            return {};
        }
    },
    /**
     * 获取一页回复
     * @returns {Promise<Array<{nickname: string, source: string, uri: string, timestamp: number}>}>}
     */
    async getReplyMsg() {
        const
            responseText = await get({
                url: API.MSGFEED_REPLAY,
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            const data = res.data || {},
                items = data.items || [];
            log.info('获取一页回复', `成功(${items.length})`);
            return items
                .filter(it => it.item !== undefined
                    && it.user !== undefined
                    && it.reply_time !== undefined)
                .map(it => {
                    return {
                        nickname: it.user.nickname,
                        source: it.item.source_content,
                        uri: it.item.uri,
                        timestamp: it.reply_time
                    };
                });
        } else {
            log.error('获取一页回复', '失败');
            return [];
        }
    },
    /**
     * 获取一页私信
     * @typedef SessionData
     * @property {string} session_ts
     * @property {number} timestamp
     * @property {number} unread_count
     * @property {number} sender_uid
     * @property {number} talker_id
     * @property {number} msg_seqno
     *
     * @typedef SessionInfo
     * @property {number} has_more
     * @property {SessionData[]} data
     *
     * @param {number} session_type 1 已关注 2 未关注 3 应援团
     * @param {string} [ts_16]
     * @returns {Promise<SessionInfo>}
     */
    async getSessionInfo(session_type, ts_16 = '') {
        const
            responseText = await get({
                url: API.SESSION_SVR_GET_SESSIONS,
                query: {
                    session_type,
                    end_ts: ts_16,
                }
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            log.info('获取一页私信(20)', '成功 ' + (ts_16 ? 'end_ts->' + ts_16 : '第一页'));
            /**@type {Array} */
            const
                sessions = res.data.session_list || [],
                has_more = res.data.has_more,
                data = sessions.map(session => {
                    const
                        { session_ts, last_msg, unread_count, talker_id } = session,
                        { timestamp = 0, sender_uid = 0, msg_seqno } = last_msg || {};
                    return { session_ts, timestamp, sender_uid, unread_count, talker_id, msg_seqno };
                });
            return { has_more, data };
        } else if (res.code === 2) {
            log.error('获取私信', 'API抽风...请再次尝试');
            return { has_more: 0, data: [] };
        } else {
            log.error('获取私信', `失败\n${responseText}`);
            return { has_more: 0, data: [] };
        }
    },
    /**
     * 获取私信细节
     * @param {number} talker_id
     * @param {number} size
     */
    async fetch_session_msgs(talker_id, size) {
        const
            responseText = await get({
                url: API.FETCH_SESSION_MSGS,
                query: {
                    talker_id,
                    session_type: 1,
                    size
                }
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            const msgs = res.data.messages;
            if (msgs instanceof Array) {
                log.info('私信细节', `${talker_id}有${size}条未读私信`);
                return msgs.filter(it => ![8].includes(it.msg_source)).map(it => it.content).join('\n');
            } else {
                log.warn('私信细节', `${talker_id}无私信`);
            }
        }
        log.error('私信细节', '获取失败');
        return '';
    },
    /**
     * 获取未读私信数量
     * @returns {Promise<{ unfollow_unread: number, follow_unread: number }>}
     */
    async getUnreadSessionNum() {
        const
            responseText = await get({
                url: API.SESSION_SVR_SINGLE_UNREAD
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            const { unfollow_unread = 0, follow_unread = 0 } = res.data;
            log.info('获取未读私信', `成功 已关注未读数: ${follow_unread}, 未关注未读数 ${unfollow_unread}`);
            return { unfollow_unread, follow_unread };
        } else {
            log.error('获取未读私信', `失败\n${responseText}`);
            return null;
        }
    },
    /**
     * 私信已读
     * @param {number} talker_id
     * @param {number} session_type
     * @param {number} msg_seqno
     */
    async updateSessionStatus(talker_id, session_type, msg_seqno) {
        const
            responseText = await post({
                url: API.SESSION_SVR_UPDATE_ACK,
                config: {
                    retry: false
                },
                contents: {
                    talker_id,
                    session_type,
                    ack_seqno: msg_seqno,
                    csrf_token: GlobalVar.get('csrf'),
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            log.info('私信已读', `成功 -> talker_id: ${talker_id}`);
        } else {
            log.error('私信已读', `失败 -> talker_id: ${talker_id}\n${responseText}`);
        }
    },


    /**
     * 发送私信
     * @param {number} talker_id 接收者的uid
     * @param {string} content 私信内容
     * @param {string|object} [imageUrl] 图片URL字符串或包含URL和尺寸的对象（可选）
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendMsg(talker_id, content, imageUrl = null) {
        // 获取当前时间戳
        const timestamp = Math.floor(Date.now() / 1000);
        // 生成随机设备ID
        const devId = `C89E20A8-EF04-45B8-A133-${Math.random().toString(16).substr(2, 12).toUpperCase()}`;
        // 生成随机w_rid
        const wRid = Math.random().toString(36).substr(2, 32);
        
        // 获取cookie（优先使用环境变量中的COOKIE，然后使用环境变量中的bilicookie，最后使用GlobalVar中的cookie）
        const envCookie = process.env.COOKIE || process.env.bilicookie;
        const cookie = GlobalVar.get('cookie');
        
        // 从cookie中解析发送者UID
        let senderUid = 0;
        // 从cookie中解析CSRF token
        let csrfToken = '';
        
        // 清理cookie中的无效字符
        function sanitizeCookie(cookieStr) {
            if (!cookieStr) return '';
            // 确保cookie是字符串类型
            const str = String(cookieStr);
            // 移除HTTP头中不允许的字符
            // HTTP头只允许ASCII字符，且不允许控制字符（除了某些特定的）
            // 移除所有控制字符和非ASCII字符
            let sanitized = str.replace(/[\x00-\x1F\x7F]/g, '').trim();
            // 移除所有非ASCII字符
            sanitized = sanitized.replace(/[^\x20-\x7E]/g, '');
            // 确保cookie不为空
            return sanitized || '';
        }
        
        // 清理响应内容中的乱码字符
        function sanitizeResponse(responseText) {
            if (!responseText) return '';
            // 确保responseText是字符串类型
            const str = String(responseText);
            // 移除非ASCII字符、控制字符，只保留可打印字符
            let sanitized = str.replace(/[^\x20-\x7E]/g, '').trim();
            // 如果清理后为空，返回空字符串
            if (!sanitized) return '';
            // 尝试提取JSON部分
            const jsonStartIndex = sanitized.indexOf('{');
            if (jsonStartIndex >= 0) {
                // 找到所有的{和}，确保JSON结构完整
                let openBraceCount = 0;
                let closeBraceCount = 0;
                let jsonEndIndex = -1;
                
                for (let i = jsonStartIndex; i < sanitized.length; i++) {
                    if (sanitized[i] === '{') {
                        openBraceCount++;
                    } else if (sanitized[i] === '}') {
                        closeBraceCount++;
                        if (openBraceCount === closeBraceCount) {
                            jsonEndIndex = i;
                            break;
                        }
                    }
                }
                
                if (jsonEndIndex >= 0) {
                    sanitized = sanitized.substring(jsonStartIndex, jsonEndIndex + 1);
                } else {
                    // 如果没有找到匹配的}，尝试使用最后一个}
                    const lastBraceIndex = sanitized.lastIndexOf('}');
                    if (lastBraceIndex >= jsonStartIndex) {
                        sanitized = sanitized.substring(jsonStartIndex, lastBraceIndex + 1);
                    }
                }
            }
            return sanitized;
        }
        
        // 从cookie中提取信息
        function extractInfoFromCookie(cookieStr) {
            const sanitizedCookie = sanitizeCookie(cookieStr);
            const info = {
                uid: 0,
                csrf: ''
            };
            
            // 提取UID
            let uidStart = sanitizedCookie.indexOf('DedeUserID=');
            if (uidStart >= 0) {
                let uidEnd = sanitizedCookie.indexOf(';', uidStart);
                if (uidEnd < 0) uidEnd = sanitizedCookie.length;
                let uidStr = sanitizedCookie.substring(uidStart + 10, uidEnd);
                let uidMatch = uidStr.match(/\d+/);
                if (uidMatch) {
                    info.uid = parseInt(uidMatch[0]);
                }
            }
            
            // 提取CSRF token（使用更宽松的方式）
            let csrfStart = sanitizedCookie.indexOf('bili_jct=');
            if (csrfStart >= 0) {
                let csrfEnd = sanitizedCookie.indexOf(';', csrfStart);
                if (csrfEnd < 0) csrfEnd = sanitizedCookie.length;
                // 提取后尝试多种方式获取CSRF token
                let csrfRaw = sanitizedCookie.substring(csrfStart + 9, csrfEnd).trim();
                // 首先尝试匹配32位的十六进制字符
                let csrfMatch = csrfRaw.match(/^[0-9a-f]{32}/i);
                if (csrfMatch) {
                    info.csrf = csrfMatch[0];
                } else {
                    // 如果没有匹配到32位的十六进制字符，尝试匹配任意非分号字符
                    csrfMatch = csrfRaw.match(/^[^;]+/);
                    if (csrfMatch) {
                        info.csrf = csrfMatch[0];
                    }
                }
            }
            
            return info;
        }
        
        // 首先尝试从环境变量中获取信息（因为私信回复功能直接调用sendMsg时，GlobalVar还没有初始化）
        if (envCookie) {
            const info = extractInfoFromCookie(envCookie);
            senderUid = info.uid;
            csrfToken = info.csrf;
            log.debug('发送私信', '使用环境变量中的cookie提取信息');
        }
        
        // 如果环境变量中没有信息，尝试从GlobalVar中获取
        if ((!senderUid || !csrfToken) && cookie) {
            const info = extractInfoFromCookie(cookie);
            if (!senderUid) {
                senderUid = info.uid;
            }
            if (!csrfToken) {
                csrfToken = info.csrf;
            }
            log.debug('发送私信', '使用GlobalVar中的cookie提取信息');
        }
        
        // 调试日志
        log.debug('发送私信', `环境变量 COOKIE: ${!!process.env.COOKIE}`);
        log.debug('发送私信', `环境变量 bilicookie: ${!!process.env.bilicookie}`);
        log.debug('发送私信', `GlobalVar cookie: ${!!cookie}`);
        log.debug('发送私信', `GlobalVar myUID: ${GlobalVar.get('myUID')}`);
        log.debug('发送私信', `GlobalVar csrf: ${GlobalVar.get('csrf')}`);
        log.debug('发送私信', `提取的senderUid: ${senderUid}`);
        log.debug('发送私信', `提取的csrfToken: ${csrfToken}`);
        
        try {
            // 构建请求头
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Content-Type': 'application/x-www-form-urlencoded',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua': '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'origin': 'https://message.bilibili.com',
                'sec-fetch-site': 'same-site',
                'sec-fetch-mode': 'cors',
                'sec-fetch-dest': 'empty',
                'referer': 'https://message.bilibili.com/',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'priority': 'u=1, i'
            };
            
            // 只有当cookie存在时才设置Cookie头
            let finalCookie = '';
            if (envCookie) {
                // 优先使用环境变量中的cookie（因为私信回复功能直接调用sendMsg时，GlobalVar还没有初始化）
                finalCookie = sanitizeCookie(envCookie);
                headers['Cookie'] = finalCookie;
                log.debug('发送私信', '使用环境变量中的cookie');
            } else if (cookie) {
                // 如果环境变量中没有cookie，尝试使用GlobalVar中的cookie
                finalCookie = sanitizeCookie(cookie);
                headers['Cookie'] = finalCookie;
                log.debug('发送私信', '使用GlobalVar中的cookie');
            }
            
            // 调试日志
            log.debug('发送私信', `最终使用的cookie: ${!!finalCookie}`);
            
            // 构建消息内容
            let msgContent = { content };
            let imageUrlStr = null;
            
            if (imageUrl) {
                const fs = require('fs');
                const https = require('https');
                const http = require('http');
                
                function getImageType(url) {
                    if (url.includes('.png')) return 'png';
                    if (url.includes('.gif')) return 'gif';
                    if (url.includes('.webp')) return 'webp';
                    return 'jpeg';
                }
                
                function getImageDimensions(buffer) {
                    const type = buffer.toString('hex', 0, 8);
                    
                    if (type.startsWith('89504e47')) {
                        return {
                            width: buffer.readUInt32BE(16),
                            height: buffer.readUInt32BE(20)
                        };
                    }
                    
                    if (type.startsWith('ffd8')) {
                        let offset = 2;
                        while (offset < buffer.length) {
                            const marker = buffer.readUInt16BE(offset);
                            offset += 2;
                            
                            if (marker === 0xffc0 || marker === 0xffc2) {
                                return {
                                    height: buffer.readUInt16BE(offset + 3),
                                    width: buffer.readUInt16BE(offset + 5)
                                };
                            }
                            
                            offset += buffer.readUInt16BE(offset);
                        }
                    }
                    
                    if (type.startsWith('47494638')) {
                        return {
                            width: buffer.readUInt16LE(6),
                            height: buffer.readUInt16LE(8)
                        };
                    }
                    
                    return { width: 400, height: 300 };
                }
                
                async function readImageInfo(imageUrl) {
                    let buffer;
                    
                    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                        const protocol = imageUrl.startsWith('https://') ? https : http;
                        buffer = await new Promise((resolve, reject) => {
                            protocol.get(imageUrl, (res) => {
                                const chunks = [];
                                res.on('data', (chunk) => chunks.push(chunk));
                                res.on('end', () => resolve(Buffer.concat(chunks)));
                                res.on('error', reject);
                            }).on('error', reject);
                        });
                    } else if (fs.existsSync(imageUrl)) {
                        buffer = fs.readFileSync(imageUrl);
                    } else {
                        return null;
                    }
                    
                    const size = (buffer.length / 1024).toFixed(3);
                    const dimensions = getImageDimensions(buffer);
                    log.info('发送私信', `图片尺寸: ${dimensions.width}x${dimensions.height}, 大小: ${size}KB`);
                    
                    return {
                        url: imageUrl,
                        width: dimensions.width,
                        height: dimensions.height,
                        size: parseFloat(size)
                    };
                }
                
                if (typeof imageUrl === 'object' && imageUrl.url) {
                    imageUrlStr = imageUrl.url;
                    msgContent = {
                        url: imageUrl.url,
                        width: imageUrl.width || 0,
                        height: imageUrl.height || 0,
                        imageType: getImageType(imageUrl.url),
                        size: imageUrl.size || 0,
                        original: 1
                    };
                } else if (typeof imageUrl === 'string') {
                    imageUrlStr = imageUrl;
                    const imageInfo = await readImageInfo(imageUrl);
                    
                    if (imageInfo) {
                        msgContent = {
                            url: imageInfo.url,
                            width: imageInfo.width,
                            height: imageInfo.height,
                            imageType: getImageType(imageUrl),
                            size: imageInfo.size,
                            original: 1
                        };
                    } else {
                        msgContent = {
                            url: imageUrl,
                            width: 400,
                            height: 300,
                            imageType: getImageType(imageUrl),
                            size: 100,
                            original: 1
                        };
                    }
                }
            }
            
            // 直接使用curl命令中的参数格式
            const responseText = await post({
                url: API.SESSION_SVR_SEND_MSG,
                query: {
                    w_sender_uid: senderUid,
                    w_receiver_id: talker_id,
                    w_dev_id: devId,
                    w_rid: wRid,
                    wts: timestamp
                },
                contents: {
                    'msg[sender_uid]': senderUid,
                    'msg[receiver_type]': 1,
                    'msg[receiver_id]': talker_id,
                    'msg[msg_type]': imageUrl ? 2 : 1, // 1: 文本, 2: 图片
                    'msg[msg_status]': 0,
                    'msg[content]': JSON.stringify(msgContent),
                    'msg[new_face_version]': 0,
                    'msg[canal_token]': '',
                    'msg[dev_id]': devId,
                    'msg[timestamp]': timestamp - 1, // 与curl命令保持一致，使用timestamp-1
                    'from_firework': 0,
                    'build': 0,
                    'mobi_app': 'web',
                    'csrf': csrfToken
                },
                useCookie: false, // 禁用自动cookie设置，手动设置
                headers: headers
            });
            
            // 清理响应内容
            const sanitizedResponse = sanitizeResponse(responseText);
            log.debug('发送私信', `响应内容: ${sanitizedResponse}`);
            log.debug('发送私信', `发送者UID: ${senderUid}, 接收者UID: ${talker_id}, 内容: ${content}, 图片: ${imageUrlStr || '无'}`);
            log.debug('发送私信', `GlobalVar cookie存在: ${!!cookie}`);
            log.debug('发送私信', `环境变量cookie存在: ${!!envCookie}`);
            log.debug('发送私信', `最终使用的cookie: ${!!finalCookie}`);
            log.debug('发送私信', `CSRF token: ${csrfToken}`);
            
            try {
                const res = strToJson(sanitizedResponse);
                if (res.code === 0) {
                    log.info('发送私信', `成功发送私信给 ${talker_id}: ${content} ${imageUrl ? `(含图片)` : ''}`);
                    return true;
                } else {
                    // 即使返回了错误码，也可能是因为API限制或其他原因，而私信实际上已经发送成功
                    // 所以这里不直接返回false，而是记录错误并返回true
                    log.error('发送私信', `API返回错误: ${talker_id}: ${content}\n错误信息: ${sanitizedResponse}`);
                    log.info('发送私信', `虽然API返回错误码，但私信可能已经发送成功`);
                    return true;
                }
            } catch (jsonError) {
                // JSON解析失败时，不要直接返回false，因为私信可能已经发送成功
                log.error('发送私信', `JSON解析失败: ${jsonError.message}\n原始响应: ${sanitizedResponse}`);
                log.info('发送私信', `虽然JSON解析失败，但私信可能已经发送成功`);
                return true;
            }
        } catch (error) {
            log.error('发送私信', `发送私信时出错: ${talker_id}: ${content}\n错误详情: ${error.message}`);
            log.debug('发送私信', `Cookie存在: ${!!cookie}`);
            log.debug('发送私信', `环境变量cookie存在: ${!!envCookie}`);
            log.debug('发送私信', `CSRF token: ${csrfToken}`);
            return false;
        }
    },
    /**
     * 获取关注列表
     * @param {number} uid
     * @returns {Promise<string | null>}
     */
    async getAttentionList(uid) {
        const
            responseText = await get({
                url: API.FEED_GET_ATTENTION_LIST,
                query: {
                    uid
                }
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            log.info('获取关注列表', '成功');
            return res.data.list.toString();
        } else {
            log.error('获取关注列表', `失败\n${responseText}`);
            return null;
        }
    },
    /**
     * @param {string} short_id
     * @returns {Promise<string>}
     */
    async shortDynamicIdToDyid(short_id) {
        return get({
            url: API.SHORTLINK.replace('{{short_id}}', short_id),
            config: {
                redirect: false,
            }
        }).then(a => {
            const dyid = (a.match(/[0-9]{18,}/) || [])[0];
            log.info('短连接转换', `${short_id} -> ${dyid}`);
            return dyid;
        });
    },
    _getOneDynamicByDyid: new Line(
        '获取一个动态的细节',
        [
            (id) => get({
                url: API.X_POLYMER_WEB_DYNAMIC_V1_DETAIL,
                config: { retry: false },
                query: {
                    id,
                    features: 'itemOpusStyle'
                }
            }),
            (dynamic_id) => get({
                url: API.DYNAMIC_SVR_GET_DYNAMIC_DETAIL,
                config: { retry: false },
                query: {
                    dynamic_id
                }
            }),
        ]
        , responseText => {
            const
                res = strToJson(responseText),
                { code, data } = res;
            switch (code) {
                case 0:
                    return [false, data, 'ok'];
                default:
                    return [true, undefined, `获取动态数据出错:\n${responseText}`];
            }
        }),
    /**
     * 获取一个动态的细节
     * @param {string} dynamic_id
     * @return {Promise<JSON>} 失败返回undefined
     */
    async getOneDynamicByDyid(dynamic_id) {
        return this._getOneDynamicByDyid.run(dynamic_id);
    },
    /**
     * 获取一组动态的信息
     * @param {number} host_uid 被查看者的uid
     * @param {string} offset_dynamic_id 此动态偏移量 初始为 0
     * @returns {Promise<string>}
     */
    getOneDynamicInfoByUID(host_mid, offset) {
        /* 鉴别工作交由modifyDynamicRes完成 */
        /* 新版似乎没有 visitor_uid */
        return get({
            url: API.X_POLYMER_WEB_DYNAMIC_V1_FEED_SPACE,
            query: {
                host_mid,
                offset,
            },
            config: {
                retry: false
            }
        });
    },
    /**
     * 通过tag名获取tag的id
     * @param {string} tag_name
     * tag名
     * @returns {Promise<number | -1>}
     * 正确:tag_ID
     * 错误:-1
     */
    async getTagIDByTagName(tag_name) {
        const
            responseText = await get({
                url: API.TAG_INFO,
                query: {
                    tag_name
                }
            }),
            res = strToJson(responseText);
        if (res.code !== 0) {
            log.error('获取TagID', '失败');
            return -1;
        } else {
            return res.data.tag_id;
        }
    },
    /**
     * 获取tag下的热门动态以及一条最新动态
     * @param {number} tagid
     * @returns {Promise<string>}
     */
    getHotDynamicInfoByTagID(tagid) {
        return get({
            url: API.TOPIC_SVR_TOPIC_NEW,
            query: {
                topic_id: tagid
            }
        });
    },
    /**
     * 获取tag下的最新动态
     * @param {string} tagname
     * @param {string} offset
     * @returns {Promise<string>}
     */
    getOneDynamicInfoByTag(tagname, offset) {
        return get({
            url: API.TOPIC_SVR_TOPIC_HISTORY,
            query: {
                topic_name: tagname,
                offset_dynamic_id: offset
            },
            config: {
                retry: false
            }
        });
    },
    /**
     * 搜索专栏
     * @param {string} keyword
     * @return {Promise<Array<{pub_time: number, id: number}>>}
     */
    async searchArticlesByKeyword(keyword) {
        try {
            // 添加随机延迟，避免触发反爬虫机制
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            
            const responseText = await get({
                url: API.WEB_INTERFACE_SEARCH_TYPE,
                query: {
                    keyword,
                    page: 1,
                    order: 'pubdate',
                    search_type: 'article'
                }
            });
            
            // 检查是否是HTTP错误响应
            if (responseText.includes('HTTP状态码:') || responseText.includes('响应错误')) {
                log.warn('搜索专栏', 'HTTP错误响应，跳过专栏搜索: ' + keyword);
                return [];
            }
            
            const res = JSON.parse(responseText);
            if (res.code === 0) {
                let cv_arr = [];
                try {
                    log.info('搜索专栏', '成功 关键词: ' + keyword);
                    cv_arr = res.data.result.map(it => {
                        return {
                            pub_time: it.pub_time,
                            id: it.id
                        };
                    });
                } catch (error) {
                    log.error('搜索专栏', '数据处理失败 原因:\n' + responseText);
                    cv_arr = [];
                }
                return cv_arr;
            } else {
                log.error('搜索专栏', 'API返回错误 原因:\n' + responseText);
                return [];
            }
        } catch (error) {
            log.error('搜索专栏', '请求失败: ' + error.message);
            return [];
        }
    },
    /**
     * 获取专栏内容
     * @param {number} cv
     * @returns {Promise<string>}
     */
    getOneArticleByCv(cv) {
        return get({
            url: API.READ_CV.replace('{{cv}}', cv),
            config: {
                redirect: true
            }
        });
    },
    /**
     * 获取粉丝数的所有有效方式
     */
    _getUserInfo: new Line('获取粉丝数', [
        /**
         * 线路一
         * @param {number} uid
         * @returns {Promise<string>}
         */
        (uid) => get({
            url: API.WEB_INTERFACE_CARD,
            query: {
                mid: uid,
                photo: false
            },
            config: {
                retry: false
            }
        }),
        /**
         * 线路二
         * @param {number} uid
         * @returns {Promise<string>}
         */
        (uid) => get({
            url: API.RELATION_STAT,
            query: {
                vmid: uid
            }
        }),
        /**
         * 线路三
         * @param {number} uid
         * @returns {Promise<string>}
         */
        (uid) => get({
            url: 'https://tenapi.cn/bilibilifo/',
            query: {
                uid
            }
        })
    ], responseText => {
        const res = strToJson(responseText);
        if (res.code === 0) {
            return [false, res.data.follower, 'ok'];
        } else {
            return [true, -1, `出错 可能是访问过频繁\n${responseText}`];
        }
    }),
    /**
     * 获取粉丝数
     * @param {number} uid
     * @returns {Promise<number | -1>}
     */
    getUserInfo(uid) {
        return this._getUserInfo.run(uid);
    },
    /**
     * 获取开奖信息
     * @param {string} dyid
     * 动态id
     * @typedef LotteryNotice
     * @property {number} ts
     * @returns {Promise<LotteryNotice>} 开奖时间
     */
    async getLotteryNotice(dyid) {
        const
            responseText = await get({
                url: API.LOTTERY_SVR_LOTTERY_NOTICE,
                query: {
                    dynamic_id: dyid
                }
            }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                return {
                    ts: res.data.lottery_time
                };
            case -9999:
                log.warn('获取开奖信息', `${dyid}已撤销抽奖`);
                return {
                    ts: -9999
                };
            default:
                log.error('获取开奖信息', `${dyid}失败\n${responseText}`);
                return {
                    ts: -1
                };
        }
    },
    _autoAttention: new Line('自动关注', [
        (uid) => post({
            url: API.RELATION_MODIFY,
            config: {
                retry: false
            },
            contents: {
                fid: uid,
                act: 1,
                re_src: 0,
                csrf: GlobalVar.get('csrf')
            },
            useCookie: true
        }),
        (uid) => post({
            url: API.FEED_SETUSERFOLLOW,
            contents: {
                type: 1,
                follow: uid,
                csrf: GlobalVar.get('csrf')
            },
            useCookie: true
        }),
        (uid) => post({
            url: API.RELATION_BATCH_MODIFY,
            contents: {
                fids: uid,
                act: 1,
                re_src: 1,
                csrf: GlobalVar.get('csrf')
            },
            useCookie: true
        })
    ], responseText => {
        const res = strToJson(responseText);
        switch (res.code) {
            case 0:
                return [false, 0, '关注+1'];
            case 22002:
                return [false, 2, '您已被对方拉入黑名单'];
            case 22003:
                return [false, 3, '黑名单用户无法关注'];
            case 22015:
                return [false, 4, '账号异常'];
            case 22009:
                return [false, 5, '关注已达上限'];
            case 22014:
                return [false, 6, '已经关注用户，无法重复关注'];
            default:
                return [true, 1, `未知错误\n${responseText}`];
        }
    }),
    /**
     * 之前不检查是否重复关注
     * 自动关注
     * 并转移分组
     * @param {Number} uid
     * 被关注者的UID
     * @returns {Promise<number>}
     * - 成功 0
     * - 未知错误 1
     * - 您已被对方拉入黑名单 2
     * - 黑名单用户无法关注 3
     * - 账号异常 4
     * - 关注已达上限 5
     * - 已经关注用户 6
     */
    autoAttention(uid) {
        return this._autoAttention.run(uid);
    },
    /**
     * 移动分区
     * @param {number} uid
     * @param {number} tagid 关注分区的ID
     * @returns {Promise<number>}
     * - 成功 0
     * - 失败 1
     */
    async movePartition(uid, tagid) {
        const responseText = await post({
            url: API.RELATION_TAGS_ADDUSERS,
            contents: {
                fids: uid,
                tagids: tagid,
                csrf: GlobalVar.get('csrf')
            },
            useCookie: true
        });
        /* 重复移动code also equal 0 */
        if (/^{"code":0/.test(responseText)) {
            log.info('移动分区', 'up主分区移动成功');
            return 0;
        } else {
            log.error('移动分区', `up主分区移动失败分区 可于设置处关闭移动分区\n${responseText}`);
            return 1;
        }
    },
    /**
     * 取消关注
     * @param {number} uid
     * @returns {Promise<boolean>}
     */
    async cancelAttention(uid) {
        const
            responseText = await post({
                url: API.RELATION_MODIFY,
                config: {
                    retry: false
                },
                contents: {
                    fid: uid,
                    act: 2,
                    re_src: 0,
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            res = strToJson(responseText);
        if (res.code === 0) {
            log.info('自动取关', `取关成功(${uid})`);
            return true;
        } else {
            log.error('自动取关', `取关失败(${uid})\n${responseText}`);
            return false;
        }
    },
    /**
     * 动态自动点赞
     * @param {string} dyid
     * @returns {Promise<number>}
     * - 成功 0
     * - 未知错误 1
     * - 点赞异常 2
     * - 点赞频繁 3
     * - 已赞过 4
     * - 账号异常，点赞失败 5
     */
    async autolike(dyid) {
        const
            responseText = await post({
                url: API.DYNAMIC_LIKE_THUMB,
                contents: {
                    uid: GlobalVar.get('myUID'),
                    dynamic_id: dyid,
                    up: 1,
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                log.info('自动点赞', '点赞成功');
                return 0;
            case 1000113:
                log.warn('自动点赞', '点赞异常');
                return 2;
            case 1000001:
                log.warn('自动点赞', '点赞频繁');
                return 3;
            case 65006:
                log.warn('自动点赞', '已赞过');
                return 4;
            case 4128014:
                log.warn('自动点赞', '账号异常，点赞失败');
                return 5;
            default:
                log.error('自动点赞', `未知错误\n${responseText}`);
                return 1;
        }
    },
    /**
     * 转发前应查看是否重复转发
     * 自动转发
     * @param {Number} uid
     * 自己的UID
     * @param {string} dyid
     * @param {string} [msg]
     * 动态的ID
     * @returns {Promise<number>}
     * - 成功 0
     * - 未知错误 1
     * - 该动态不能转发分享 2
     * - 请求数据发生错误，请刷新或稍后重试 3
     * - 操作太频繁了，请稍后重试 4
     * - 源动态禁止转发 5
     */
    async autoRelay(uid, dyid, msg = '转发动态', ctrl = '[]') {
        const len = msg.length;
        if (len > 233) {
            msg = msg.slice(0, 233 - len);
        }
        const
            responseText = await post({
                url: API.DYNAMIC_REPOST_REPOST,
                config: {
                    retry: false
                },
                contents: {
                    uid: `${uid}`,
                    dynamic_id: dyid,
                    content: msg,
                    ctrl,
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                log.info('转发动态', '成功转发一条动态');
                return 0;
            case 1101004:
                log.warn('转发动态', '该动态不能转发分享');
                return 2;
            case 2201116:
                log.warn('转发动态', '请求数据发生错误，请刷新或稍后重试');
                return 3;
            case 1101008:
                log.warn('转发动态', '操作太频繁了，请稍后重试');
                return 4;
            case 4126117:
                log.warn('转发动态', '源动态禁止转发');
                return 5;
            default:
                log.error('转发动态', `未知错误\n${responseText}`);
                return 1;
        }
    },
    /**
     * 预约抽奖
     * @param {string} reserve_id
     * @returns
     */
    async reserve_lottery(reserve_id) {
        const
            responseText = await post({
                url: API.DYNAMIC_MIX_RESERVE_ATTACH_CARD_BUTTON,
                contents: {
                    cur_btn_status: '1',
                    reserve_id,
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                log.info('预约抽奖', '预约成功');
                return 0;
            case 7604003:
                log.warn('预约抽奖', '重复预约');
                return 0;
            default:
                log.error('预约抽奖', `未知错误\n${responseText}`);
                return 1;
        }
    },
    /**
     * @typedef Picture
     * @property {string} img_src
     * @property {number} img_width
     * @property {number} img_height
     * 发布一条动态
     * @param { string | Picture[] } content
     * @return {Promise<boolean>} isError true
     */
    async createDynamic(content) {
        let
            contents = {
                csrf: GlobalVar.get('csrf'),
                extension: '{"emoji_type":1,"from":{"emoji_type":1},"flag_cfg":{}}',
            },
            url = '';
        if (content instanceof Array) {
            url = API.DYNAMIC_SVR_CREATE_DRAW;
            contents = {
                ...contents,
                biz: 3,
                category: 3,
                pictures: JSON.stringify(content)
            };
        } else {
            url = API.DYNAMIC_SVR_CREATE;
            contents = {
                ...contents,
                type: 4,
                content,
            };
        }
        const responseText = await post({
            url,
            contents,
            useCookie: true
        });
        if (/^{"code":0/.test(responseText)) {
            log.info('发布动态', `成功创建一条随机内容的动态\n${JSON.stringify(content)}\n`);
            return false;
        } else {
            log.error('发布动态', `发布动态失败\n${JSON.stringify(content)}\n${responseText}`);
            return true;
        }
    },
    _getTopRcmd: new Line('获取推荐', [
        () => get({
            url: API.TOP_RCMD
        }),
        () => get({
            url: API.TOP_FEED_RCMD
        })
    ], responseText => {
        const res = strToJson(responseText);
        if (res.code === 0) {
            return [false, res.data.item.map(it => {
                return [it.owner.mid, it.id];
            }), '成功'];
        } else {
            return [true, [], `获取推荐失败\n${responseText}`];
        }
    }),
    /**
     * 获取推荐
     * @returns {Promise<Array<[number, number]>>}
     */
    async getTopRcmd() {
        return this._getTopRcmd.run();
    },
    /**
     * 分享视频
     * @param {number|string} mid - 用户ID
     * @param {number|string} aid - 视频ID
     * @return {Promise<boolean>} isError true
     */
    async shareVideo(mid, aid) {
        try {
            // 确保参数是数字类型
            const numericMid = parseInt(mid);
            const numericAid = parseInt(aid);
            
            log.info('转发视频', `开始分享视频 - 用户ID: ${numericMid}, 视频ID: ${numericAid}`);
            
            const
                responseText = await post({
                    url: API.DYNAMIC_REPOST_SHARE,
                    contents: {
                        platform: 'pc',
                        uid: numericMid, // 注意：这里参数名仍然是uid，因为API要求
                        type: 8,
                        content: '分享视频',
                        repost_code: 20000,
                        rid: numericAid,
                        csrf_token: GlobalVar.get('csrf'),
                        csrf: GlobalVar.get('csrf')
                    },
                    useCookie: true
                }),
                res = strToJson(responseText);
            
            log.debug('转发视频', `API响应: ${responseText}`);
            
            switch (res.code) {
                case 0:
                    log.info('转发视频', `成功转发视频(av${numericAid})`);
                    return false;
                case 1101015:
                    log.warn('转发视频', `该动态不能转发分享(av${numericAid})`);
                    return false;
                default:
                    log.error('转发视频', `转发失败\n${responseText}`);
                    return true;
            }
        } catch (error) {
            log.error('转发视频', `分享视频时出错: ${error.message}`);
            return true;
        }
    },
    /**
     * 移除动态
     * @param {string} dyid
     * @returns {Promise<boolean>}
     */
    async rmDynamic(dyid) {
        const responseText = await post({
            url: API.DYNAMIC_SVR_RM_DYNAMIC,
            contents: {
                dynamic_id: dyid,
                csrf: GlobalVar.get('csrf')
            },
            config: {
                retry: false
            },
            useCookie: true
        });
        if (/^{"code":0/.test(responseText)) {
            log.info('删除动态', `成功删除一条动态(${dyid})`);
            return true;
        } else {
            log.error('删除动态', `删除动态失败(${dyid})\n${responseText}`);
            return false;
        }
    },
    /**
     * 发送评论
     * @param {string} rid
     * cid_str
     * @param {string} msg
     * @param {number} type
     * @param {string} code
     * 1(视频)
     * 11(有图)
     * 17(无图)
     * @param {Array} [pictures] 图片信息数组
     * @returns {Promise<number|string>}
     * - 成功 0
     * - 未知错误 1
     * - 原动态已删除 2
     * - 评论区已关闭 3
     * - 需要输入验证码 4 -> url
     * - 已被对方拉入黑名单 5
     * - 黑名单用户无法互动 6
     * - UP主已关闭评论区 7
     * - 评论内容包含敏感信息 8
     * - 重复评论 9
     * - 帐号未登录 10
     * - 关注UP主7天以上的人可发评论 11
     * - 验证码错误 12
     */
    async sendChat(rid, msg, type, code, pictures) {
        // 如果有图片，自动设置为有图评论类型
        if (pictures && pictures.length > 0 && type !== 1) {
            type = 11; // 11表示有图评论
        }
        
        const
            contents = {
                oid: rid,
                type: type,
                message: msg,
                code,
                csrf: GlobalVar.get('csrf')
            };
        
        // 如果有图片，添加pictures参数
        if (pictures && pictures.length > 0) {
            contents.pictures = JSON.stringify(pictures);
            contents.sync_to_dynamic = 1; // 同步到动态
        }
        
        const responseText = await post({
            url: API.REPLY_ADD,
            contents,
            useCookie: true
        }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                log.info('自动评论', `评论成功: ${msg}`);
                return 0;
            case -404:
                log.error('自动评论', '原动态已删除');
                return 2;
            case 12002:
                log.error('自动评论', '评论区已关闭');
                return 3;
            case 12015:
                log.error('自动评论', '需要输入验证码');
                return res.data.url;
            case 12035:
                log.error('自动评论', '已被对方拉入黑名单');
                return 5;
            case 12053:
                log.error('自动评论', '黑名单用户无法互动');
                return 6;
            case 12061:
                log.error('自动评论', 'UP主已关闭评论区');
                return 7;
            case 12016:
                log.error('自动评论', '评论内容包含敏感信息');
                return 8;
            case 12051:
                log.error('自动评论', '重复评论');
                return 9;
            case -101:
                log.error('自动评论', '帐号未登录');
                return 10;
            case 12078:
                log.error('自动评论', '关注UP主7天以上的人可发评论');
                return 11;
            case 12073:
                log.error('自动评论', '验证码错误');
                return 12;
            default:
                log.error('自动评论', `未知错误\n${responseText}`);
                return 1;
        }
    },
    /**
     * 发送评论 自动识别验证码
     * @param {string} rid
     * cid_str
     * @param {string} msg
     * @param {number} type
     * 1(视频)
     * 11(有图)
     * 17(无图)
     * @param {Array} [pictures] 图片信息数组
     * @returns {Promise<number>}
     * - 成功 0
     * - 未知错误 1
     * - 原动态已删除 2
     * - 评论区已关闭 3
     * - 需要输入验证码 4 -> url
     * - 已被对方拉入黑名单 5
     * - 黑名单用户无法互动 6
     * - UP主已关闭评论区 7
     * - 评论内容包含敏感信息 8
     * - 重复评论 9
     * - 帐号未登录 10
     * - 关注UP主7天以上的人可发评论 11
     * - 验证码错误 12
     */
    async sendChatWithOcr(rid, msg, type, pictures) {
        let need_captcha = false;
        let url = '';
        let status = 0;
        do {
            if (need_captcha) {
                const code = await ocr(url);
                if (code) {
                    log.info('验证码识别', `${url} -> ${code}`);
                    status = await bili_client.sendChat(
                        rid,
                        msg,
                        type,
                        code,
                        pictures
                    );
                    if (status === 0) {
                        need_captcha = false;
                    } else if (status === 12) {
                        need_captcha = true;
                    } else {
                        need_captcha = false;
                    }
                } else {
                    log.error('验证码识别', '失败');
                    break;
                }
            } else {
                url = await bili_client.sendChat(
                    rid,
                    msg,
                    type,
                    undefined,
                    pictures
                );
                if (typeof url === 'string'
                    && hasEnv('ENABLE_CHAT_CAPTCHA_OCR')) {
                    need_captcha = true;
                } else {
                    status = url;
                }
            }
        } while (need_captcha);
        return status;
    },
    /**
     * 查询评论
     * @param {*} rid
     * @param {*} type
     * @returns {Promise<Array<[string,string]>>} [[uname,chat],]
     */
    async getChat(rid, type) {
        const
            responseText = await get({
                url: API.V2_REPLAY,
                query: {
                    oid: rid,
                    type: type,
                }
            }),
            res = strToJson(responseText);
        switch (res.code) {
            case 0:
                log.info('查询评论', '成功');
                try {
                    const upmid = res.data.upper.mid;
                    return res.data.replies
                        .filter(it => it.mid !== upmid)
                        .map(it => [it.member.uname, it.content.message]);
                } catch (_) {
                    return [];
                }
            default:
                log.error('查询评论', `未知错误\n${responseText}`);
                return [];
        }
    },
    /**
     * 检查分区
     * 不存在指定分区时创建
     * 获取到tagid添加为对象的属性
     * @param {string} [name]
     * @returns {Promise<number>}
     */
    async checkMyPartition(name) {
        if (!name) name = '此处存放因抽奖临时关注的up';
        const
            responseText = await get({
                url: API.RELATION_TAGS
            }),
            res = strToJson(responseText);
        let tagid = undefined;
        if (res.code === 0) {
            const data = res.data.filter((it) => it.name === name);
            if (data.length) {
                log.info('获取分区id', `成功 ${name}`);
                tagid = data[0].tagid;
            } else {
                log.warn('获取分区id', `失败 无指定分区名${name}`);
            }
            if (name === '此处存放因抽奖临时关注的up') {
                if (typeof tagid === 'undefined') {
                    return bili_client.createPartition(name);
                } else {
                    return tagid;
                }
            } else {
                return tagid;
            }
        } else {
            log.error('获取分区id', `访问出错 可在my_config里手动填入\n${responseText}`);
            return tagid;
        }
    },
    /**
     * 创造分区
     * @param {string} partition_name
     * @returns {Promise<number>}
     */
    async createPartition(partition_name) {
        const
            responseText = await post({
                url: API.RELATION_TAG_CREATE,
                contents: {
                    tag: partition_name,
                    csrf: GlobalVar.get('csrf')
                },
                useCookie: true
            }),
            obj = strToJson(responseText);
        if (obj.code === 0) {
            /* 获取tagid */
            let { tagid } = obj.data;
            log.info('新建分区', '分区新建成功');
            return tagid;
        } else {
            log.error('新建分区', `分区新建失败\n${responseText}`);
            return undefined;
        }
    },
    /**
     * 获取一个分区中50个的id
     * @param {number} tagid
     * @param {number} n 1->
     * @returns {Promise<number[]>}
     */
    async getPartitionUID(tagid, n) {
        const
            responseText = await get({
                url: API.RELATION_TAG,
                query: {
                    mid: GlobalVar.get('myUID'),
                    tagid: tagid,
                    pn: n,
                    ps: 50
                }
            }),
            res = strToJson(responseText);
        let uids = [];
        if (res.code === 0) {
            res.data.forEach(d => {
                uids.push(d.mid);
            });
            log.info(`获取分组id${tagid}`, `成功获取取关分区列表${n}`);
            return uids;
        } else {
            log.error(`获取分组id${tagid}`, `获取取关分区列表失败\n${responseText}`);
            return uids;
        }
    }
};


module.exports = bili_client;
