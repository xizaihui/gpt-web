ClewdR v0.12.23 Custom Build — Account Safety Optimizations

Source: https://github.com/Xerxes-2/clewdr.git
Build: cargo build --release --features portable

## Changes (relative to src/claude_web_state/)

### Phase 1: Performance (already deployed)
- **mod.rs**: BOOTSTRAP_CACHE (moka, 5min TTL) + CONV_POOL
- **bootstrap.rs**: Cache-first bootstrap
- **chat.rs**: Pre-created conversation pool, async cleanup

### Phase 2: Account Safety (this build)
- **Policy Layer** (mod.rs + chat.rs):
  - Rate limit: max 5 req/min per cookie
  - Circuit breaker: 3 consecutive errors → freeze 30 min
  - Random delay: 0.5-2s before each request (human-like pacing)
  
- **De-fingerprinting** (chat.rs + mod.rs):
  - Conversation names: empty string (let Claude auto-name)
  - Debug log files renamed (no "clewdr" in filenames)
  - Browser-like headers added: Sec-CH-UA, Sec-Fetch-*, Accept-Language
  
- **Delayed Deletion** (mod.rs):
  - Conversations queued for deletion with 30-120s random delay
  - Processed on next request (not immediate)
  - More natural than instant-delete pattern

### Also changed
- **request.rs**: Attachment struct (paste.txt kept — it's the standard claude.ai paste filename)
- **transform.rs**: Debug log renamed

## Build Requirements
rustc 1.94.1, cmake, build-essential, libclang-dev, clang, pkg-config, libssl-dev, gcc-multilib, g++-multilib

## Rollback
cp /opt/clewdr/clewdr.bak /opt/clewdr/clewdr && systemctl restart clewdr
