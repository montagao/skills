# Replication

## Table of Contents
1. [Replication Strategies](#replication-strategies)
2. [Consistency Models](#consistency-models)
3. [Practical Decisions](#practical-decisions)

## Replication Strategies

### Single-Leader (Primary-Replica)
- All writes go to one node, replicate to followers
- Simple consistency model
- Leader is single point of failure (mitigated by failover)

**Use when**: Default choice. Strong consistency needed, read scaling desired.

**Examples**: PostgreSQL streaming replication, MySQL replication, Redis Sentinel

### Multi-Leader
- Multiple nodes accept writes, sync between leaders
- Complex conflict resolution
- Better write availability and latency across regions

**Use when**: Multi-region deployments where write latency matters, offline-first applications.

**Examples**: CockroachDB, Cassandra, custom sync (CRDTs)

### Leaderless
- Any node accepts reads/writes
- Quorum-based consistency (R + W > N)
- No failover needed, but weaker consistency

**Use when**: High availability critical, eventual consistency acceptable.

**Examples**: Cassandra, DynamoDB, Riak

## Consistency Models

### Strong Consistency
- Reads always see most recent write
- Requires coordination (slower)
- Essential for: payments, inventory, unique constraints

### Eventual Consistency
- Reads may see stale data temporarily
- Higher availability and lower latency
- Acceptable for: feeds, caches, analytics, non-critical reads

### Read-Your-Writes
- Users see their own writes immediately
- Others may see stale data
- Often sufficient for user-facing applications

**Implementation**: Route user reads to leader, or include write timestamp and wait for replica catch-up.

### Monotonic Reads
- User never sees time go backward
- Can still see stale data, but won't see older data after seeing newer

**Implementation**: Stick user sessions to same replica.

## Practical Decisions

### For Most Startups
1. Start with single-leader (PostgreSQL primary + read replica)
2. Read replicas for read scaling
3. Consider multi-region only when latency measurements demand it

### Replication Lag Considerations
```
Lag acceptable?
├── <100ms: Most user-facing reads OK
├── <1s: Background jobs, analytics OK
├── >1s: Consider reading from primary for critical paths
└── Variable/high: Session stickiness or read-your-writes required
```

### Failover
- Automatic failover is complex—test it regularly
- Data loss possible if async replication and leader fails
- Consider: Is brief downtime better than risk of split-brain?

**Recommendation for small teams**: Use managed database services (RDS, Cloud SQL) with automatic failover rather than operating your own.
