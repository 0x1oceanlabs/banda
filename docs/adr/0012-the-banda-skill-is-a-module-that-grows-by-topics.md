---
status: accepted
date: 2026-11-01
---

# The Banda skill is a module that grows by topics

ADR 0005 (decision 14) gave every Agent a Banda skill: "the words, how to change things safely and where things live", with a reference "generated from the manifests, so it does not go stale". It was to come through the MCP module. Neither was built.

By 2026-11-01 the look (ADR 0007) and the sidebar (ADR 0008) were text files that an Agent could change, but an Agent in a Thread did not know they were there. Roma's point is that "the Agent can set the app up for its Person, as with themes". That needs the skill.

Roma decided the skill is a module of its own, and that it must grow: "the skill will take on much more of Banda in the future, not only the settings". The MCP module, through which Agents will also talk to each other, is to be discussed first. So it is not part of this decision.

The research on how tools teach Agents about themselves is in `docs/research/2026-11-01-hackable-modules.md`, section 9. Skills, MCP `instructions` and llms.txt have all settled on progressive disclosure: a short part is always read, and the rest is read when needed. Text generated from the code stays current, while hand-written prose goes stale.

**Decision.**

1. **The skill is its own module, `modules/skill`** (_decided_: "a separate module").
   - It holds the skill's text and nothing else: no engine, no window, no state.
   - Everything that reaches an Agent takes the text from it: the CLI today, an exported folder, and the MCP module later. The text is written once.

2. **A core and topics, as skills are.**
   - **The core** is `modules/skill/SKILL.md`, written by hand and short: Banda's words, how to change Banda safely, and where things live. An Agent reads it first.
   - **A topic** is a page an Agent reads when it needs it, one per area: `look`, `sidebar`. Its front matter has a `name` (the file's name) and a one-line `description` that says when to read it. The core lists every topic with its description.

3. **Each part of Banda writes its own topics; the skill gathers them** (_decided_: "so we can grow it").
   - A topic lives beside the code it describes, in a `skill/` folder of its part, such as `look/skill/sidebar.md` or `modules/agents/skill/threads.md`.
   - The skill finds every such folder when it is built. A new part of Banda adds a page, and nothing in the skill module changes.
   - So whoever changes a feature sees its page next to the code, and a module from elsewhere will later ship its topics the same way, declared in its manifest (ADR 0005, decision 12).

4. **A topic shows what ships, not a copy of it.**
   - A line `<!-- include ../sidebar.toml -->` puts that file into the page when the skill is built.
   - The look and the sidebar ship templates, `look/look.toml` and `look/sidebar.toml`, with every key and its default commented out. Tests check that the commented keys are the defaults, so the page cannot drift from the code.
   - "Edit sidebar.toml" in the window starts a new file from the same template.

5. **It reaches an Agent three ways, from one text.**
   - `bandaso skill` prints the core, and `bandaso skill <topic>` prints a topic. Any Agent with a shell can read it, and so can a Person. It needs no engine.
   - `bandaso skill --export <folder>` writes an Agent Skills folder (agentskills.io): `SKILL.md` and `references/<topic>.md`. Claude Code and Codex both read this format. Banda does not write it into a Harness's own config (ADR 0005, decision 14). The Person puts it where their Harness looks, for example `~/.claude/skills/banda/`.
   - The MCP module will hand the core over as its `instructions`, and each topic through a guide tool, when it is built.

6. **What the skill says about changing Banda.**
   - Banda is changed through its files, as the Person changes it. Edit the file, keep the Person's comments and the keys they did not ask to change, and check it with `bandaso look check`. Then say what changed and how to undo it.
   - Never touch credentials, a Harness's own config, or a Space's `.bandaso/` folder.

**Consequences.**

- The first topics are `look` and `sidebar`. The next ones come with their features: Threads, terminals, keys, workspaces.
- An Agent in a Thread learns of the skill only once the MCP module hands it over, or once the Person exports it to their Harness. Until then, `bandaso skill` is there for an Agent that is told to run it.
- Later:
  - `bandaso describe`, Banda's state now (ADR 0005, decision 14), as a topic of its own or a tool;
  - Raycast-style evals: a few Agent tasks per topic, run against the skill;
  - topics declared in module manifests, for modules from elsewhere.
- The MCP module gets its own ADR: how a Harness reaches it, what an Agent may do through it without asking the Person, and how Agents talk to each other.
