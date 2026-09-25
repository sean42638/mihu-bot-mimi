/**
 * 👑 米胡電競 - 全後台統一身分與職位對照表 (含排序權重)
 */
const ROLE_DEFINITIONS = {
    'admin': { key: 'admin', name: '店長', badgeClass: 'bg-danger', textClass: 'text-danger', weight: 100 },
    'owner': { key: 'owner', name: '負責人', badgeClass: 'bg-danger', textClass: 'text-danger', weight: 100 },
    'cfo': { key: 'cfo', name: '財務長', badgeClass: 'bg-danger', textClass: 'text-danger', weight: 90 },
    'aftersales': { key: 'aftersales', name: '售後管理', badgeClass: 'bg-warning text-dark', textClass: 'text-warning', weight: 80 },
    'after_sales': { key: 'after_sales', name: '售後管理', badgeClass: 'bg-warning text-dark', textClass: 'text-warning', weight: 80 },
    'manager': { key: 'manager', name: '客服主管', badgeClass: 'bg-warning text-dark', textClass: 'text-warning', weight: 70 },
    'cs_director': { key: 'cs_director', name: '客服主管', badgeClass: 'bg-warning text-dark', textClass: 'text-warning', weight: 70 },
    'cs': { key: 'cs', name: '客服', badgeClass: 'bg-info text-dark', textClass: 'text-info', weight: 60 },
    'talent': { key: 'talent', name: '陪陪', badgeClass: 'bg-primary', textClass: 'text-primary', weight: 50 },
    'staff': { key: 'staff', name: '陪陪', badgeClass: 'bg-primary', textClass: 'text-primary', weight: 50 },
    'member': { key: 'member', name: '會員', badgeClass: 'bg-secondary', textClass: 'text-secondary', weight: 10 }
};

/**
 * 取得指定身分 key 的完整資訊
 */
function getRoleInfo(roleKey) {
    const key = String(roleKey || '').toLowerCase();
    return ROLE_DEFINITIONS[key] || { key: 'member', name: '會員', badgeClass: 'bg-secondary', textClass: 'text-secondary', weight: 0 };
}

/**
 * 🚀 依據身分權重對使用者陣列進行高到低排序 (相同身分則按創建時間倒序)
 */
function sortByRoleWeight(userArray) {
    if (!Array.isArray(userArray)) return [];
    return [...userArray].sort((a, b) => {
        const weightA = getRoleInfo(a.role).weight;
        const weightB = getRoleInfo(b.role).weight;
        if (weightB !== weightA) {
            return weightB - weightA; // 權重高者排前面
        }
        return (b.created_at || '').localeCompare(a.created_at || '');
    });
}

module.exports = {
    ROLE_DEFINITIONS,
    getRoleInfo,
    sortByRoleWeight
};