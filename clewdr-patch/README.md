ClewdR v0.12.23 custom build - bootstrap cache + conv pre-creation pool
Source: https://github.com/Xerxes-2/clewdr.git
Modified files (relative to src/claude_web_state/):
  - mod.rs: Added BOOTSTRAP_CACHE (moka, 5min TTL) + CONV_POOL + cookie_cache_key()
  - bootstrap.rs: Cache-first bootstrap, falls back to full bootstrap on miss
  - chat.rs: Pre-created conv pool, async cleanup, async pre-creation after each request
Built: Sat Apr  4 06:16:26 AM UTC 2026
Compiler: rustc 1.94.1
Target: x86_64 linux, release, portable feature
