/**
 * API 设置页面风格管理器
 * 可扩展的风格系统，支持添加多种 UI 风格
 */

// 风格注册表
const styleRegistry = {}

/**
 * API 风格管理器类
 */
class ApiStyleManager {
  constructor() {
    this.currentStyle = 'simple'
  }

  /**
   * 注册新风格
   * @param {string} styleId - 风格唯一标识
   * @param {Object} config - 风格配置
   * @param {string} config.name - 风格显示名称
   * @param {string} config.description - 风格描述
   * @param {string} config.cssClass - CSS 类名
   * @param {string} config.icon - 风格图标
   */
  registerStyle(styleId, config) {
    if (!config.name || !config.cssClass) {
      console.error(`Invalid style config for ${styleId}: name and cssClass are required`)
      return false
    }

    styleRegistry[styleId] = {
      id: styleId,
      name: config.name,
      description: config.description || '',
      cssClass: config.cssClass,
      icon: config.icon || '🎨'
    }

    console.log(`API Style registered: ${styleId} - ${config.name}`)
    return true
  }

  /**
   * 获取所有已注册的风格
   */
  getAvailableStyles() {
    return Object.values(styleRegistry)
  }

  /**
   * 获取风格配置
   */
  getStyle(styleId) {
    return styleRegistry[styleId] || styleRegistry['simple']
  }

  /**
   * 设置当前风格
   */
  setCurrentStyle(styleId) {
    if (styleRegistry[styleId]) {
      this.currentStyle = styleId
      return true
    }
    console.warn(`Style ${styleId} not found, using default`)
    this.currentStyle = 'simple'
    return false
  }

  /**
   * 获取当前风格
   */
  getCurrentStyle() {
    return this.currentStyle
  }

  /**
   * 获取当前风格配置
   */
  getCurrentStyleConfig() {
    return styleRegistry[this.currentStyle] || styleRegistry['simple']
  }

  /**
   * 获取风格对应的 CSS 类名
   */
  getStyleClass(styleId = null) {
    const targetStyleId = styleId || this.currentStyle
    const styleConfig = this.getStyle(targetStyleId)
    return styleConfig ? styleConfig.cssClass : ''
  }

  /**
   * 检查风格是否存在
   */
  hasStyle(styleId) {
    return !!styleRegistry[styleId]
  }
}

// 创建单例实例
const apiStyleManager = new ApiStyleManager()

// 注册简约风格（默认）
apiStyleManager.registerStyle('simple', {
  name: '简约风格',
  description: '现代化简约设计，注重留白和层次',
  cssClass: 'api-style-simple',
  icon: '✨'
})

// 注册深色科技风格
apiStyleManager.registerStyle('dark', {
  name: '深色科技',
  description: '类似VS Code的深色主题，科技感强',
  cssClass: 'api-style-dark',
  icon: '🌙'
})

// 注册卡片仪表盘风格
apiStyleManager.registerStyle('dashboard', {
  name: '卡片仪表盘',
  description: '卡片式布局，类似Apple设置页面',
  cssClass: 'api-style-dashboard',
  icon: '📊'
})

// 导出单例和管理器类
export default apiStyleManager
export { ApiStyleManager }
