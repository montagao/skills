# Data Encoding

## Table of Contents
1. [Format Comparison](#format-comparison)
2. [Schema Evolution](#schema-evolution)
3. [Practical Recommendations](#practical-recommendations)

## Format Comparison

| Format | Size | Schema | Human Readable | Schema Evolution |
|--------|------|--------|----------------|------------------|
| JSON | Large | No | Yes | Implicit |
| Protocol Buffers | Small | Required | No | Excellent |
| Avro | Small | Required | No | Excellent |
| MessagePack | Medium | No | No | Implicit |

### JSON
- Universal, human-readable, self-describing
- Verbose (field names repeated), no native binary/date types
- Good for: APIs, config files, logs, debugging

### Protocol Buffers
- Compact binary, strongly typed
- Requires .proto schema files, code generation
- Good for: Internal services, high-throughput systems, gRPC

### Avro
- Compact binary, schema embedded or referenced
- Dynamic typing, good for data pipelines
- Good for: Hadoop ecosystem, Kafka, data warehousing

### MessagePack
- JSON-compatible but binary
- No schema, smaller than JSON
- Good for: Drop-in JSON replacement when size matters

## Schema Evolution

### Forward Compatibility
New code reads old data. Essential when rolling out new code gradually.

**Rules**:
- New fields must be optional or have defaults
- Don't remove required fields
- Don't change field types incompatibly

### Backward Compatibility
Old code reads new data. Essential for rollbacks.

**Rules**:
- Don't add new required fields
- Old code ignores unknown fields
- Keep field semantics stable

### Both Directions
For systems where producers and consumers upgrade independently.

**Best practice**: Every field optional with sensible defaults. Use field presence to distinguish "not set" from "default value" when needed.

## Practical Recommendations

### API Design
```
External APIs → JSON (universality wins)
Internal high-throughput → Consider Protobuf/gRPC
Data pipelines → Avro (schema registry pattern)
Caching/queues → MessagePack or Protobuf
```

### Database Schema Evolution

**PostgreSQL Migrations**:
- Add columns as nullable or with defaults
- Don't remove columns until all code stops using them
- Rename via: add new, migrate data, remove old (3-phase)

**Document Stores (MongoDB)**:
- Handle missing fields in application code
- Version documents if needed
- Migrate lazily on read or batch migrate

### Versioning Strategies

**URL versioning** (`/api/v1/users`):
- Clear, cacheable
- Use for breaking changes

**Header versioning** (`Accept: application/vnd.api+json; version=1`):
- Same URL, less visible
- Good for minor variations

**Recommendation**: URL versioning for major versions, additive changes within versions. Avoid version proliferation—deprecate aggressively.

### For Startups
1. Use JSON for APIs—the overhead rarely matters at startup scale
2. Add Protobuf/gRPC for internal services if latency becomes measurable issue
3. Design for additive changes from day one
4. Document breaking changes, communicate with consumers
