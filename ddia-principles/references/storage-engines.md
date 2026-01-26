# Storage Engines

## Table of Contents
1. [B-tree vs LSM-tree](#b-tree-vs-lsm-tree)
2. [When to Choose What](#when-to-choose-what)
3. [Practical Implications](#practical-implications)

## B-tree vs LSM-tree

### B-tree (PostgreSQL, MySQL InnoDB)
- **Write path**: Update in place, maintain sorted structure
- **Read path**: O(log n) lookups, efficient range scans
- **Trade-off**: Write amplification from page splits, but consistent read performance

**Best for**:
- Read-heavy workloads
- Workloads requiring strong transactions
- Random access patterns
- When predictable latency matters

### LSM-tree (RocksDB, Cassandra, LevelDB)
- **Write path**: Append to memtable, flush to sorted files, compact in background
- **Read path**: Check memtable, then search multiple levels
- **Trade-off**: Fast writes, but read amplification and compaction overhead

**Best for**:
- Write-heavy workloads
- Append-mostly patterns (logs, time-series)
- When write throughput is critical
- SSD-optimized workloads

## When to Choose What

```
Primary workload?
├── Read-heavy (>80% reads)
│   └── B-tree (PostgreSQL, MySQL)
├── Write-heavy (>50% writes)
│   └── LSM-tree (Cassandra, RocksDB-based)
└── Mixed
    ├── Need ACID transactions?
    │   └── B-tree (PostgreSQL)
    └── Eventual consistency OK?
        └── Either works, prefer operational simplicity
```

## Practical Implications

### PostgreSQL (B-tree)
- Vacuum is essential—schedule it, monitor it
- FILLFACTOR tuning for update-heavy tables
- Index bloat is real—monitor and reindex periodically

### LSM-based Systems
- Compaction can cause latency spikes
- Monitor write amplification (bytes written vs bytes received)
- Space amplification during compaction—provision extra disk

### For Startups
Default to PostgreSQL. The operational simplicity and flexibility outweigh theoretical write performance advantages of LSM for most workloads under 10K writes/second.
