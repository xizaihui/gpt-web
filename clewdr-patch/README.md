ClewdR v0.12.23 Custom Build — Performance + Account Safety

Source: https://github.com/Xerxes-2/clewdr.git
Build: cargo build --release --features portable

## All Changes

### Phase 1: Performance
- **Bootstrap cache** (mod.rs + bootstrap.rs): moka cache, 5min TTL, skip re-bootstrap
- **Conversation pre-creation pool** (chat.rs + mod.rs): async create next conv after each request
- **Async cleanup**: don't block response on DELETE

### Phase 2: Account Safety — Policy Layer
- **Rate limit**: max 5 req/min per cookie (mod.rs)
- **Circuit breaker**: 3 consecutive errors → freeze 30 min (mod.rs)
- **Random delay**: 0.5-2s before each request (chat.rs)

### Phase 2: Account Safety — De-fingerprinting
- **Conversation names**: empty string, let Claude auto-name (chat.rs)
- **Browser headers**: Sec-CH-UA Chrome136, Sec-Fetch-*, Accept-Language (mod.rs)
- **Debug logs**: removed "clewdr" from all filenames

### Phase 2: Account Safety — Behavioral
- **Delayed deletion**: conversations queued 30-120s before delete (mod.rs)
- **Cleanup queue**: processed on next request, not immediate

### Phase 3: Eliminate Attachment Fingerprint
- **Smart attachment decision** (transform.rs):
  - Short messages (<4000 bytes) → prompt field only, NO attachment
  - Long messages (≥4000 bytes) → paste.txt attachment (matches real behavior)
  - This eliminates the biggest detection signal: every message having a text file attachment

## Modified Files
- src/claude_web_state/mod.rs — BOOTSTRAP_CACHE, CONV_POOL, CLEANUP_QUEUE, COOKIE_POLICIES, browser headers
- src/claude_web_state/bootstrap.rs — cache-first bootstrap
- src/claude_web_state/chat.rs — policy integration, pre-creation, delayed cleanup, random delay
- src/claude_web_state/transform.rs — smart attachment threshold (4000B)
- src/types/claude_web/request.rs — Attachment struct

## Build Requirements
rustc 1.94.1, cmake, build-essential, libclang-dev, clang, pkg-config, libssl-dev, gcc-multilib, g++-multilib

## Rollback
cp /opt/clewdr/clewdr.bak /opt/clewdr/clewdr && systemctl restart clewdr
