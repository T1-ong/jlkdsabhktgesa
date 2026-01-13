const { log, readDyidFile, writeDyidFile } = require('../utils');

// 记录脚本启动时间的小时数
const START_HOUR = new Date().getHours();

const d_storage = {
    /**
     * 搜索dyid
     * @param {string} dyid
     * @returns {Promise<boolean>}
     */
    searchDyid: async (dyid) => {
        let buffer = '';
        let found = false;

        const stream = readDyidFile(Number(process.env.NUMBER));

        for await (const chunk of stream) {
            buffer += chunk;

            while ((buffer.indexOf(dyid)) !== -1) {
                found = true;
                stream.destroy();
                return found;
            }

            const lastCommaIdx = buffer.lastIndexOf(',');
            if (lastCommaIdx !== -1) {
                buffer = buffer.slice(lastCommaIdx);
            }
        }

        if (!found && buffer.length > 0) {
            if (buffer.includes(dyid)) {
                found = true;
            }
        }

        stream.destroy();
        return found;
    },
    /**
     * 更新dyid
     * @param {string} dyid
     */
    updateDyid: (dyid) => {
        // 根据脚本启动时间决定是否写入dyid
        // 如果脚本在12点前启动，即使运行到12点后也不写入dyid
        if (START_HOUR < 12) {
            log.info('更新dyid', `脚本在12点前启动，不写入dyid: ${dyid}`);
            return Promise.resolve();
        }
        
        log.info('更新dyid', `写入${dyid}`);
        return new Promise((resolve) => {
            const ws = writeDyidFile(Number(process.env.NUMBER));
            ws.write(dyid + ',', () => {
                ws.destroy();
                resolve();
            });
            ws.on('error', err => {
                log.error('更新dyid', err);
                resolve();
            });
        });
    }
};


module.exports = d_storage;
