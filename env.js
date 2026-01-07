// 从环境变量获取多账号配置
const bilicookieEnv = process.env.bilicookie || '';
const bilinoteEnv = process.env.bilinote || '';
const accountRangeEnv = process.env.BILICOKIE_RANGE || '';

// 解析备注环境变量为映射对象
function parseBiliNote(envValue) {
  if (!envValue) return {};
  
  // 辅助函数：从键值对中提取note和qq信息
  const extractNoteContent = (content) => {
    const keyValuePairs = content.split(/[，,]/).filter(pair => pair.trim() !== '');
    let noteContent = '';
    
    keyValuePairs.forEach(pair => {
      const trimmedPair = pair.trim();
      if (trimmedPair.startsWith('note=')) {
        noteContent += trimmedPair.replace(/^note=/i, '');
      } else if (trimmedPair.startsWith('qq=')) {
        noteContent += `，${trimmedPair}`;
      }
    });
    
    return noteContent.trim();
  };
  
  // 使用换行符分割不同备注项
  const noteItems = envValue.split(/\r?\n/).filter(line => line.trim() !== '');
  
  // 构建账号序号/ID到备注的映射
  const noteMap = {};
  
  noteItems.forEach(item => {
    const trimmedItem = item.trim();
    
    // 先提取账号序号（开头的数字，支持中文或英文逗号分隔）
    const indexMatch = trimmedItem.match(/^(\d+)[，,]/);
    if (indexMatch) {
      const accountIndex = indexMatch[1];
      // 去除账号序号前缀
      const contentWithoutIndex = trimmedItem.substring(indexMatch[0].length);
      // 提取note和qq信息
      const noteContent = extractNoteContent(contentWithoutIndex);
      
      if (noteContent) {
        noteMap[accountIndex] = noteContent;
        
        // 同时也提取DedeUserID，以便支持通过DedeUserID关联
        const dedeUserIdMatch = trimmedItem.match(/DedeUserID=([^，,]*)[，,]?/i);
        if (dedeUserIdMatch) {
          const dedeUserId = dedeUserIdMatch[1].trim();
          noteMap[dedeUserId] = noteContent;
        }
      }
    } else {
      // 处理没有序号前缀的情况
      const noteContent = extractNoteContent(trimmedItem);
      if (noteContent) {
        // 默认使用账号1
        noteMap['1'] = noteContent;
      }
    }
  });
  
  return noteMap;
}

// 解析cookie环境变量为账号数组
function parseBiliCookie(envValue, noteMap) {
  if (!envValue) return [];
  
  // 使用换行符分割不同账号
  const cookieItems = envValue.split(/\r?\n/).filter(line => line.trim() !== '');
  
  return cookieItems.map((cookieStr, index) => {
    let COOKIE = cookieStr.trim();
    let accountIndex = null;
    
    // 检查cookie字符串是否以序号开头
    const indexMatch = COOKIE.match(/^(\d+)[，,](.*)$/);
    if (indexMatch) {
      accountIndex = indexMatch[1];
      COOKIE = indexMatch[2].trim(); // 提取真正的cookie部分
    }
    
    // 从DedeUserID=xxx中提取用户ID
    const dedeUserIdMatch = COOKIE.match(/DedeUserID=([^;]+)/);
    const dedeUserId = dedeUserIdMatch ? dedeUserIdMatch[1] : null;
    
    // 尝试通过多种方式获取备注，优先级：cookie序号 > 数组索引+1 > DedeUserID
    const NOTE = noteMap[accountIndex] || noteMap[(index + 1).toString()] || noteMap[dedeUserId] || '';
    
    // 使用从cookie中提取的序号，如果没有则使用数组索引+1
    const accountNumber = accountIndex ? parseInt(accountIndex, 10) : index + 1;
    
    return {
      COOKIE,
      NOTE,
      NUMBER: accountNumber,
      CLEAR: true,
      WAIT: 10 * 1000,
      ACCOUNT_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
      PROXY_HOST: '',
      PROXY_PORT: '',
      PROXY_USER: '',
      PROXY_PASS: ''
    };
  });
}

// 解析复杂账号范围配置（支持多个范围和单独账号）
function parseAccountRange(envValue, totalAccounts) {
  if (!envValue) return null; // 返回null表示不过滤，使用所有账号
  
  const rangeStr = envValue.trim();
  if (rangeStr === 'all') return null; // 特殊值"all"表示使用所有账号
  
  // 分割多个范围（使用逗号或空格分隔）
  const rangeItems = rangeStr.split(/[,，\s]+/).filter(item => item.trim() !== '');
  
  // 收集所有有效范围
  const validRanges = [];
  
  for (const item of rangeItems) {
    // 处理类似"3-6"的范围格式
    const rangeMatch = item.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      
      // 确保范围有效
      if (start > 0 && end >= start && end <= totalAccounts) {
        validRanges.push({ start, end });
      } else {
        console.warn(`无效的范围配置: ${item}，已忽略`);
      }
      continue;
    }
    
    // 处理单独账号格式（如"5"）
    const singleMatch = item.match(/^(\d+)$/);
    if (singleMatch) {
      const num = parseInt(singleMatch[1], 10);
      
      // 确保账号有效
      if (num > 0 && num <= totalAccounts) {
        validRanges.push({ start: num, end: num });
      } else {
        console.warn(`无效的账号配置: ${item}，已忽略`);
      }
      continue;
    }
    
    console.warn(`无法解析的范围配置: ${item}，已忽略`);
  }
  
  // 如果没有有效范围，返回null表示使用所有账号
  if (validRanges.length === 0) {
    console.warn(`没有有效的账号范围配置，将使用所有账号`);
    return null;
  }
  
  return validRanges;
}

// 检查账号是否在允许的范围内
function isAccountInRange(account, validRanges) {
  for (const range of validRanges) {
    if (account.NUMBER >= range.start && account.NUMBER <= range.end) {
      return true;
    }
  }
  return false;
}

// 解析后的备注映射
const noteMap = parseBiliNote(bilinoteEnv);

// 解析后的多账号配置
const allAccounts = parseBiliCookie(bilicookieEnv, noteMap);

// 应用账号范围过滤
const accountRange = parseAccountRange(accountRangeEnv, allAccounts.length);
const parsedAccounts = accountRange 
  ? allAccounts.filter(account => isAccountInRange(account, accountRange))
  : allAccounts;


module.exports = Object.freeze({
    /**
     * ## 账号相关
     * - `COOKIE` 是必填项
     * - `NOTE` 帐号备注
     * - `NUMBER` 表示是第几个账号
     * - `CLEAR` 是否启用清理功能
     * - `ACCOUNT_UA` 账号UA, 可在浏览器控制台输入 navigator.userAgent 查看
     * 
     * ## 高级功能
     * - `ENABLE_CHAT_CAPTCHA_OCR` 开启评论验证码识别 使用方法见README
     * - `CHAT_CAPTCHA_OCR_URL` 验证码识别接口 POST `url`->`code`
     * - `ENABLE_AI_COMMENTS` 是否启用AI评论
     * 
     * ## 调试相关
     * - `LOTTERY_LOG_LEVEL` 输出日志等级 Error<Warn<Notice<Info<Debug 0<1<2<3<4
     * - `NOT_GO_LOTTERY` 关闭抽奖行为
     *
     * ## 多账号
     * - `ENABLE_MULTIPLE_ACCOUNT` 是否启用多账号
     * - `MULTIPLE_ACCOUNT_PARM` 多账号参数(JSON格式) <不推荐使用
     * 1. 将 ENABLE_MULTIPLE_ACCOUNT 的值改为true
     * 2. 将账号信息依次填写于 multiple_account_parm 中, 参考例子类推
     * - `WAIT` 表示下一个账号运行等待时间(毫秒)
     *
     * **按顺序依次执行, 防止访问频繁封禁IP**
     */
    account_parm: {
        COOKIE: parsedAccounts[0]?.COOKIE || '',
        NOTE: parsedAccounts[0]?.NOTE || '',
        NUMBER: parsedAccounts[0]?.NUMBER || 1,
        CLEAR: true,
        ACCOUNT_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',

        ENABLE_CHAT_CAPTCHA_OCR: true,
        CHAT_CAPTCHA_OCR_URL: 'http://81.69.229.199:9898/ocr/url/text',
        ENABLE_AI_COMMENTS: true,

        ENABLE_MULTIPLE_ACCOUNT: parsedAccounts.length > 0,
        MULTIPLE_ACCOUNT_PARM: '',

        LOTTERY_LOG_LEVEL: 3,
        NOT_GO_LOTTERY: ''
    },

    /**
     * 多账号配置(从环境变量解析)
     */
    multiple_account_parm: parsedAccounts,

    /**
     * 推送相关参数
     */
    push_parm: {
        SCKEY: '',
        SENDKEY: '',
        QQ_SKEY: '',
        QQ_MODE: '',
        BARK_PUSH: 'https://api.day.app/vVFCVv5WwVNbJ5FwirJA3M',
        BARK_SOUND: '',
        PUSHDEER_URL: '',
        PUSHDEER_PUSHKEY: '',
        TG_BOT_TOKEN: '',
        TG_USER_ID: '',
        TG_PROXY_HOST: '',
        TG_PROXY_PORT: '',
        DD_BOT_TOKEN: '',
        DD_BOT_SECRET: '',
        QYWX_AM: '',
        QYWX_KEY: '',
        IGOT_PUSH_KEY: '',
        PUSH_PLUS_TOKEN: '',
        PUSH_PLUS_USER: '',
        QMSG_KEY: 'dfc190f967aeb7316ad146b6f2256668',
        QMSG_QQ: '926600288',
        SMTP_HOST: '',
        SMTP_PORT: '',
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_TO_USER: '',
        GOTIFY_URL: '',
        GOTIFY_APPKEY: ''
    },

    /**
     * AI Authentication(OpenAI 兼容的 API 格式)
     * Chat completions
     * 此处填写Key, 在my_config中的ai_comments_parm中填写API地址等信息
     */
    ai_parm: {
        //apikey
        AI_API_KEY: 'sk-uelygppmguihuxxvsrosqjwnsprtcrtccgntkzmzuvaugjgf',
    }
});
