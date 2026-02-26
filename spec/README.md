# Indexer Specification Documents

## Files

### id-mismatch-fix.md

**Complete documentation of the ID mismatch fix applied to the indexer.**

Contains:

- Executive summary of the problem and fix
- Detailed before/after code comparison
- Visual diagrams of the issue and solution
- Event processing flow
- Entity ID consistency rules
- Database state examples
- Verification procedures
- Testing steps
- Troubleshooting guide
- Impact summary

**Key Fix:** Modified `src/factory-handlers.ts` (lines 71-103) to ensure `ModuleRegistry` uses BC module address as ID, matching `Market` and `MarketState`.

**Result:** All trade-related entities now share the same ID namespace, enabling proper trade indexing.

---

## Quick Reference

### The Problem

Events were being emitted but not indexed because ModuleRegistry used orchestrator ID while Market used BC module ID.

### The Solution

Use BC module address as the registry ID for fundingManager modules:

```typescript
let registryId = orchestrator.toLowerCase()
if (moduleType === 'fundingManager') {
  registryId = module.toLowerCase() // ← Use BC module address
}
```

### Verification

```bash
# Check entity ID consistency
curl -s http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ ModuleRegistry(limit:1) { id } Market(limit:1) { id } MarketState(limit:1) { id } }"}'

# All three should return the same ID
```

---

## Related Files

- `src/factory-handlers.ts` - Handler implementation with the fix
- `src/market-handlers.ts` - Trade event handlers
- `spec/handler-test-specification.md` - Handler test specification
- `spec/handler-implementation-specification.md` - Implementation specification
