const { env_file } = require('../utils');

const env = {
    /**
     * 原始环境
     * @returns {Object}
     */
    raw_env() {
        delete require.cache[env_file];
        return require(env_file);
    },
    init() {
        const raw_env = this.raw_env();
        this.setEnv({
            ...raw_env['account_parm'],
            ...raw_env['push_parm'],
            ...raw_env['ai_parm']
        });
        
        // 确保通知相关的环境变量正确设置
        if (raw_env['push_parm']) {
            if (raw_env['push_parm'].BARK_PUSH) {
                process.env.BARK_PUSH = raw_env['push_parm'].BARK_PUSH;
            }
            if (raw_env['push_parm'].QMSG_KEY) {
                process.env.QMSG_KEY = raw_env['push_parm'].QMSG_KEY;
            }
        }
    },
    /**
     * @returns {Object[]}
     */
    get_multiple_account() {
        return this.raw_env()['multiple_account_parm'];
    },
    setEnv(o) {
        process.env = {
            ...process.env,
            ...o
        };
    }
};


module.exports = env;
