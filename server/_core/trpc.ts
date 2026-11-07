import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  /**
   * A scan failure carries a reason code (shared/scanFailure.ts) so the app
   * can pick the right screen without guessing from the message. Without
   * this, only the message text reached the client. Additive: app 2.1 reads
   * the message, which is unchanged.
   */
  errorFormatter({ shape, error }) {
    const reason = (error.cause as { scanReason?: unknown } | undefined)?.scanReason;
    return typeof reason === "string" && /^[a-z_]{1,40}$/.test(reason)
      ? { ...shape, data: { ...shape.data, scanReason: reason } }
      : shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);