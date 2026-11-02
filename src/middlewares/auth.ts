import type { NextFunction, Request, Response } from "express";
import passport from "passport";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import type { UserRecord } from "../repositories/user.repository.js";
import { authService, type AccessPayload } from "../services/auth.service.js";

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password", session: false },
    (email, password, done) => {
      authService
        .verifyCredentials(email, password)
        .then((user) => done(null, user ?? false))
        .catch((err: unknown) => done(err));
    },
  ),
);

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_ACCESS_SECRET,
    },
    (payload: AccessPayload, done) => {
      authService
        .userForToken(payload.sub)
        .then((user) => done(null, user ?? false))
        .catch((err: unknown) => done(err));
    },
  ),
);

export const passportInitialize = passport.initialize();

/** passport-local: puts the verified user on res.locals.loginUser. */
export function authenticateLocal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  passport.authenticate(
    "local",
    { session: false },
    (err: unknown, user: UserRecord | false) => {
      if (err) return next(err);
      if (!user)
        return next(AppError.unauthenticated("Invalid email or password"));
      res.locals.loginUser = user;
      next();
    },
  )(req, res, next);
}

type RequireAuthOptions = {
  /** Allow users who still must change their password (me, change-password, logout). */
  allowPendingPasswordChange?: boolean;
};

/** Bearer JWT required. Blocks accounts with `mustChangePassword` unless allowed. */
export function requireAuth(opts: RequireAuthOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(
      "jwt",
      { session: false },
      (err: unknown, user: Express.User | false) => {
        if (err) return next(err);
        if (!user) return next(AppError.unauthenticated());
        if (user.mustChangePassword && !opts.allowPendingPasswordChange) {
          return next(
            new AppError(
              403,
              "PASSWORD_CHANGE_REQUIRED",
              "Change your password to continue",
            ),
          );
        }
        req.user = user;
        next();
      },
    )(req, res, next);
  };
}
