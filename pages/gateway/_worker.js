// No public Worker URL: this binding is the only connection to the application.
export default {
  async fetch(request, env) {
    if (!env.ALLOWED_ORIGIN || new URL(request.url).origin !== env.ALLOWED_ORIGIN) {
      return new Response('請使用網站正式網址。', {status:403, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if (!env.APP) return new Response('服務尚未就緒。', {status:503, headers:{'Cache-Control':'no-store'}});
    return env.APP.fetch(request);
  }
};
