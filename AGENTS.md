# Agent Skills Guide

Key principles and best practices for building Agent Skills, extracted from [Anthropic's official documentation](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).

## What Are Skills?

Skills are organized directories containing instructions, scripts, and resources that enable AI agents to perform specialized tasks. They transform general-purpose agents into domain-specific systems by packaging procedural knowledge into composable, discoverable resources.

## Skill Structure

### Required Format

Every skill must contain a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

[Instructions Claude will follow when this skill is active]
```

**Required fields:**
- `name` - Unique identifier (lowercase, hyphens for spaces)
- `description` - Complete description of skill purpose and use cases

### Directory Organization

```
skill-directory/
├── SKILL.md (required)
├── reference.md (optional, referenced from SKILL.md)
├── forms.md (optional, scenario-specific)
└── scripts/ (optional, for code execution)
```

## Progressive Disclosure

The fundamental design principle uses three levels of information density:

1. **Level 1 - Metadata**: YAML frontmatter (`name` and `description`) is preloaded into the agent's system prompt at startup. Claude knows when each skill applies without consuming context for full details.

2. **Level 2 - Core Instructions**: The body of `SKILL.md` contains main documentation. Claude loads this when the skill is relevant to the current task.

3. **Level 3+ - Modular References**: Additional bundled files (`reference.md`, `forms.md`, etc.) provide specialized context accessed only when needed.

This structure means the amount of context that can be bundled into a skill is effectively unbounded because agents don't need to load everything simultaneously.

## Development Best Practices

### Start with Evaluation

Identify capability gaps by running agents on representative tasks. Build skills incrementally to address specific shortcomings rather than attempting comprehensive coverage upfront.

### Structure for Scale

- When `SKILL.md` becomes unwieldy, split content into separate files
- Keep mutually exclusive contexts in separate paths to reduce token usage
- Use code both as executable tools and documentation
- Make clear whether Claude should run or read scripts

### Think from Claude's Perspective

- Monitor how Claude actually uses your skill in real scenarios
- Watch for unexpected trajectories or overreliance on certain contexts
- The `name` and `description` are critical—Claude uses these when deciding whether to trigger the skill

### Iterate with Claude

- Collaborate with Claude to capture successful approaches and common mistakes
- If it goes off track, ask for self-reflection on what went wrong
- This reveals what context Claude actually needs versus what you anticipated

## Code Execution Integration

Skills can include pre-written scripts for Claude to execute. This is superior to token generation for:

- Deterministic operations (sorting, extraction)
- Complex computations expensive via language tokens
- Operations requiring consistent, repeatable results

## Security Considerations

Skills provide powerful capabilities through instructions and code, creating vulnerability risks:

- Install only from trusted sources
- Thoroughly audit untrusted skills before use
- Review bundled files, dependencies, and resources
- Check for instructions directing Claude to untrusted external sources
- Pay special attention to network connectivity instructions

## Resources

- [GitHub Repository](https://github.com/anthropics/skills)
- [Engineering Blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [API Documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Agent Skills Standard](http://agentskills.io)
