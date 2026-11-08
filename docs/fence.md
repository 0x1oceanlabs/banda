# The fence

Every Agent Banda starts runs inside a fence: the Harness, its adapter and every program they start (ADR 0083, decision 1). Your Terminals don't. Settings → General → Fence says whether it holds on this computer.

## What an Agent gets, and never gets

Behind the fence, an Agent in Full access works with your rights, not Banda's.

| An Agent gets | It never gets |
|---|---|
| Your files | Banda's own data and keys |
| Your programs | Acting as you in Banda |
| The network | Your keyring |
| Your ssh-agent: it can `git push` and `ssh` as you | Your screen and clipboard |
| Your GitHub token (from `gh`), in Projects you said you trust | Becoming root (`sudo`) |
| | Desktop notifications (Banda still sends its own) |

Behind the fence, a Project gives its Agents your GitHub token only once you say you trust it: in the question Banda asks as you add a folder that looks foreign, or in the Project's settings, with **Trust…**, or **Say you trust it…** for one already trusted. A Project added from a folder of your own is trusted, but its Agents get the token only once you say so. Where there is no fence, `gh` reaches your token itself, as it does in your Terminals.

## Where it does not hold whole

Then a new Thread starts **Supervised**, which asks before it changes anything, unless you set its Harness's mode for new Threads in Settings → Agents. You may still pick Full access, and the mode menu says what it means there: the Agent is you, in Banda too. A Thread in Full access from where the fence held starts its next turn Supervised, and says so.

| Settings says | Why | What to do |
|---|---|---|
| **On**, and you're in the docker group | Through Docker, an Agent could step past any fence. | Leave the `docker` group, or use rootless Docker. |
| **Partly**, and you're in the docker group | Both of the rows around this one. | Both: leaving the group alone still leaves the gaps. |
| **Partly** | This Linux lacks Landlock, the fence's second layer. | Linux 6.12 or later, with Landlock on. |
| **Off**: Ubuntu doesn't let apps use user namespaces | Ubuntu's AppArmor keeps them from apps it has no profile for. | Settings shows a command to run once, which gives Banda a profile; then quit Banda and open it again. |
| **Off**: this computer doesn't allow user namespaces | The system turned them off. | Turn them on, if it is yours to change. |
| **Off**: the engine is from before the fence | It gets it when it starts again; until then new Threads start as they did. | Quit Banda and open it again. |
| **Off**: no fence for macOS yet | Banda has none for macOS yet. | — |
| **Off**: no fence for Windows | Banda has none for Windows. | — |
| **Off**: Banda couldn't set it up here | Its Details say what the engine found. | Report it with those Details. |
| **Off**: turned off for testing | `BANDA_FENCE=off` is set. | Start Banda without it. |

Each Harness's mode for new Threads is in Settings → Agents.
