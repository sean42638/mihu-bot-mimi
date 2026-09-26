const db = require('./database');
const { calculateCommissionByCategory } = require('./utils/commissionHelper');
const { syncTalentsJsonFromDb, syncOrdersJsonFromDb } = require('./utils/dataSync');

async function resetAllCommissions() {
    console.log('🔄 開始執行全站員工分潤紀錄重置...');

    // 1. 將所有員工 (talents) 的個人特例抽傭欄位清空為 NULL (全面回歸工作室預設)
    await new Promise((resolve, reject) => {
        db.run('UPDATE talents SET commission_rate = NULL', function(err) {
            if (err) {
                console.error('❌ 重置 talents 資料表失敗:', err.message);
                return reject(err);
            }
            console.log(`✅ 已成功重置 ${this.changes} 筆員工的個人分潤為「依工作室預設」。`);
            resolve();
        });
    });

    // 同步 talents.json 檔案
    syncTalentsJsonFromDb();

    // 2. 重新校正歷史訂單 (orders) 的 platform_commission 與 talent_earning
    console.log('🔄 開始校正歷史訂單之平台抽成與陪陪實得金額...');
    
    const orders = await new Promise((resolve) => {
        db.all('SELECT id, category, total_amount FROM orders', (err, rows) => resolve(rows || []));
    });

    let updatedCount = 0;
    for (const order of orders) {
        const category = order.category || '陪玩單';
        const totalAmount = Number(order.total_amount || 0);

        // 依工作室類別全域設定重新計算
        const { platformCommission, talentNetEarning } = await calculateCommissionByCategory(category, totalAmount);

        await new Promise((resolve) => {
            db.run(
                'UPDATE orders SET platform_commission = ?, talent_earning = ? WHERE id = ?',
                [platformCommission, talentNetEarning, order.id],
                () => resolve()
            );
        });
        updatedCount++;
    }

    // 同步 orders.json 檔案
    syncOrdersJsonFromDb();

    console.log(`✅ 已完成校正 ${updatedCount} 筆訂單的抽傭與收益紀錄！`);
    console.log('🎉 所有員工分潤與歷史紀錄已完全恢復為「依工作室全域預設」！');
    process.exit(0);
}

resetAllCommissions();