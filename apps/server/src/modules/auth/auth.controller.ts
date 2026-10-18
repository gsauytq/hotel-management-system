import type { CookieOptions, Request, Response } from 'express';

import type {
  ApiSuccessEnvelope,
  ChangePasswordRequest,
  CurrentUser,
  LoginRequest,
  OkResult,
  SessionUser,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import type { AuthService } from './auth.service.js';

export interface AuthControllerDependencies {
  authService: AuthService;
  sessionCookie: {
    name: string;
    options: CookieOptions;
    clearOptions: CookieOptions;
  };
}

export interface AuthController {
  login: (req: Request, res: Response) => Promise<void>;
  logout: (req: Request, res: Response) => Promise<void>;
  me: (req: Request, res: Response) => void;
  changePassword: (req: Request, res: Response) => Promise<void>;
}

export function createAuthController(deps: AuthControllerDependencies): AuthController {
  return {
    async login(req, res) {
      // body 已由 validate(loginRequestSchema) 校验并替换
      const input = req.body as LoginRequest;
      const result = await deps.authService.login(input, {
        requestId: req.requestId,
        ip: req.ip,
      });

      res.cookie(deps.sessionCookie.name, result.sessionId, deps.sessionCookie.options);
      const payload: ApiSuccessEnvelope<SessionUser> = { data: result.user };
      res.status(200).json(payload);
    },

    async logout(req, res) {
      const { user, sessionId } = req;
      // requireAuth 已保证，此处为防御性检查
      if (user === undefined || sessionId === undefined) {
        throw ApiError.unauthorized();
      }

      await deps.authService.logout(sessionId, {
        requestId: req.requestId,
        ip: req.ip,
        actorId: user.id,
        username: user.username,
      });
      res.clearCookie(deps.sessionCookie.name, deps.sessionCookie.clearOptions);
      const payload: ApiSuccessEnvelope<OkResult> = { data: { ok: true } };
      res.status(200).json(payload);
    },

    me(req, res) {
      const { user } = req;
      // requireAuth 已保证，此处为防御性检查
      if (user === undefined) {
        throw ApiError.unauthorized();
      }
      const payload: ApiSuccessEnvelope<CurrentUser> = { data: user };
      res.status(200).json(payload);
    },

    async changePassword(req, res) {
      const { user } = req;
      // requireAuth 已保证，此处为防御性检查
      if (user === undefined) {
        throw ApiError.unauthorized();
      }
      await deps.authService.changePassword(req.body as ChangePasswordRequest, {
        requestId: req.requestId,
        ip: req.ip,
        actorId: user.id,
        username: user.username,
      });
      // 全部会话已在事务内删除；清理当前浏览器 Cookie
      res.clearCookie(deps.sessionCookie.name, deps.sessionCookie.clearOptions);
      const payload: ApiSuccessEnvelope<OkResult> = { data: { ok: true } };
      res.status(200).json(payload);
    },
  };
}
