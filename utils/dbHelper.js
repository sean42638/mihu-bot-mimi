const db = require('../database');

/**
 * 查詢單筆資料 (Promise 版 db.get)
 * @param {string} sql SQL 語句
 * @param {Array} params 帶入參數
 * @returns {Promise<Object|null>}
 */
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

/**
 * 查詢多筆資料 (Promise 版 db.all)
 * @param {string} sql SQL 語句
 * @param {Array} params 帶入參數
 * @returns {Promise<Array>}
 */
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * 執行新增/修改/刪除 (Promise 版 db.run)
 * @param {string} sql SQL 語句
 * @param {Array} params 帶入參數
 * @returns {Promise<{ lastID: number, changes: number }>}
 */
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

module.exports = {
    dbGet,
    dbAll,
    dbRun
};