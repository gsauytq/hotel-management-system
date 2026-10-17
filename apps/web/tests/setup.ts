/**
 * Vitest（jsdom）环境补齐浏览器 API，供 Element Plus 组件挂载测试使用。
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe(): void {
      // jsdom 无布局引擎，测试中无需实际观察
    }

    unobserve(): void {
      // no-op
    }

    disconnect(): void {
      // no-op
    }
  }

  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
