/**
 * 内容风格管理器
 * 可扩展的风格系统，支持添加多种渲染风格
 */

// 风格注册表
const styleRegistry = {}

/**
 * 风格管理器类
 */
class ContentStyleManager {
  constructor() {
    this.currentStyle = 'default'
    this.customRenderers = {}
    this.styleClasses = {}
  }

  /**
   * 注册新风格
   * @param {string} styleId - 风格唯一标识
   * @param {Object} config - 风格配置
   * @param {string} config.name - 风格显示名称
   * @param {string} config.description - 风格描述
   * @param {string} config.cssClass - CSS 类名
   * @param {Function} config.preprocess - 预处理函数（可选）
   * @param {Function} config.postprocess - 后处理函数（可选）
   * @param {Object} config.markedOptions - marked.js 配置（可选）
   * @param {Object} config.highlightOptions - 代码高亮配置（可选）
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
      icon: config.icon || '📝',
      preprocess: config.preprocess || ((content) => content),
      postprocess: config.postprocess || ((html) => html),
      markedOptions: config.markedOptions || {},
      highlightOptions: config.highlightOptions || {}
    }

    console.log(`Style registered: ${styleId} - ${config.name}`)
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
    return styleRegistry[styleId] || styleRegistry['default']
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
    this.currentStyle = 'default'
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
    return styleRegistry[this.currentStyle] || styleRegistry['default']
  }

  /**
   * 处理内容 - 应用风格的预处理和后处理
   * @param {string} content - 原始内容
   * @param {Function} markedRenderer - marked 渲染函数
   * @param {Function} sanitizer - DOMPurify 清理函数
   * @param {string} styleId - 指定风格ID（可选，默认使用当前风格）
   */
  processContent(content, markedRenderer, sanitizer, styleId = null) {
    const targetStyleId = styleId || this.currentStyle
    const styleConfig = this.getStyle(targetStyleId)

    if (!styleConfig) {
      // 默认处理
      return sanitizer(markedRenderer(content))
    }

    try {
      // 预处理
      let processedContent = styleConfig.preprocess(content)

      // Markdown 渲染
      let html = markedRenderer(processedContent, styleConfig.markedOptions)

      // 后处理
      html = styleConfig.postprocess(html)

      // 清理
      return sanitizer(html)
    } catch (error) {
      console.error(`Error processing content with style ${targetStyleId}:`, error)
      // 降级到默认处理
      return sanitizer(markedRenderer(content))
    }
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

  /**
   * 移除风格
   */
  unregisterStyle(styleId) {
    if (styleId === 'default') {
      console.warn('Cannot unregister default style')
      return false
    }
    if (styleRegistry[styleId]) {
      delete styleRegistry[styleId]
      if (this.currentStyle === styleId) {
        this.currentStyle = 'default'
      }
      return true
    }
    return false
  }
}

// 创建单例实例
const styleManager = new ContentStyleManager()

// 注册默认风格
styleManager.registerStyle('default', {
  name: '默认',
  description: '简洁的默认风格',
  cssClass: 'style-default',
  icon: '📝',
  preprocess: (content) => content,
  postprocess: (html) => html
})

// 注册 Notion 风格
styleManager.registerStyle('notion', {
  name: 'Notion',
  description: 'Notion 文档风格',
  cssClass: 'style-notion',
  icon: '📔',
  preprocess: (content) => {
    // Notion 风格预处理
    return content
  },
  postprocess: (html) => {
    // Notion 风格后处理 - 为代码块添加语言标识
    return html.replace(/<pre><code class="language-(\w+)">/g, '<pre class="notion-code-block" data-language="$1"><code class="language-$1">')
  },
  markedOptions: {
    gfm: true,
    breaks: true,
    headerIds: false
  }
})

// 注册 Konayuki 风格
styleManager.registerStyle('konayuki', {
  name: 'Konayuki',
  description: 'Konayuki 温暖风格',
  cssClass: 'style-konayuki',
  icon: '🌸',
  preprocess: (content) => {
    // Konayuki 风格预处理
    return content
  },
  postprocess: (html) => {
    // Konayuki 风格后处理
    return html
  },
  markedOptions: {
    gfm: true,
    breaks: true,
    headerIds: false
  }
})

// 注册 Everforest 风格
styleManager.registerStyle('everforest', {
  name: 'Everforest',
  description: 'Everforest 自然绿意',
  cssClass: 'style-everforest',
  icon: '🌲',
  preprocess: (content) => {
    // Everforest 风格预处理
    return content
  },
  postprocess: (html) => {
    // Everforest 风格后处理
    return html
  },
  markedOptions: {
    gfm: true,
    breaks: true,
    headerIds: false
  }
})

// 注册 HappySimple 风格
styleManager.registerStyle('happysimple', {
  name: 'HappySimple',
  description: 'HappySimple 活泼可爱',
  cssClass: 'style-happysimple',
  icon: '🌈',
  preprocess: (content) => {
    // HappySimple 风格预处理
    return content
  },
  postprocess: (html) => {
    // HappySimple 风格后处理
    return html
  },
  markedOptions: {
    gfm: true,
    breaks: true,
    headerIds: false
  }
})

// 导出单例和管理器类
export default styleManager
export { ContentStyleManager }
