import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { SessionUser } from '@hms/shared';

import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from '@/api/auth';

export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * 唯一登录态来源（架构 §2.5）。
 * 不持久化到 localStorage（HttpOnly Cookie 是唯一凭证），刷新后由守卫 fetchMe 重建。
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null);
  const booted = ref(false);

  const isAuthenticated = computed(() => user.value !== null);

  async function login(credentials: LoginCredentials): Promise<void> {
    user.value = await loginRequest(credentials);
    booted.value = true;
  }

  async function logout(): Promise<void> {
    try {
      await logoutRequest();
    } catch {
      // 网络异常 / 会话已失效不阻断本地登出；错误已由请求层统一提示
    } finally {
      clearSession();
    }
  }

  async function fetchMe(): Promise<void> {
    try {
      user.value = await fetchCurrentUser();
    } catch {
      // 401 视为游客态；网络异常也保持游客态，避免启动流程卡死
      user.value = null;
    } finally {
      booted.value = true;
    }
  }

  function clearSession(): void {
    user.value = null;
    booted.value = true;
  }

  return {
    user,
    booted,
    isAuthenticated,
    login,
    logout,
    fetchMe,
    clearSession,
  };
});
