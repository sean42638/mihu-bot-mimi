/**
 * 折扣與實收金額計算工具
 * @param {number} originalPrice 訂單原價 (合計金額)
 * @param {number} discountInput 輸入的折扣數值
 * @returns {{ finalAmount: number, discountAmount: number, discountText: string }}
 */
function calculateDiscount(originalPrice, discountInput) {
    const price = Math.max(0, Number(originalPrice || 0));
    let discount = Number(discountInput || 0);

    // 1. 防呆：不得為負數
    if (discount < 0) discount = 0;

    let finalAmount = price;
    let discountAmount = 0;
    let discountText = '';

    if (discount >= 1) {
        // 2. 1 以上：直減金額 (減法)
        discountAmount = discount;
        finalAmount = Math.max(0, price - discountAmount);
        discountText = `-$${discountAmount.toLocaleString()} NTD`;
    } else if (discount >= 0.1 && discount < 1) {
        // 3. 0.1 ~ 0.99：折數 (乘法，例如 0.8 代表 8 折)
        finalAmount = Math.round(price * discount);
        discountAmount = price - finalAmount;
        discountText = `${(discount * 10).toFixed(1)}折 (-$${discountAmount.toLocaleString()})`;
    }

    return {
        finalAmount,
        discountAmount,
        discountText
    };
}

module.exports = { calculateDiscount };