import handler from "vinext/server/fetch-handler";

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    return handler.fetch(request, env, ctx);
  },
};
