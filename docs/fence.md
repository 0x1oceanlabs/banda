# The fence

Every Agent Banda starts runs inside a fence: the Harness, its adapter and every program they start (ADR 0083, decision 1). Your Terminals don't. Settings → General → Fence says whether it holds on this computer.

## What an Agent gets, and never gets

Behind the fence, an Agent in Full access works with your rights, not Banda's.

| An Agent gets | It never gets |
|---|---|
| Your files | Banda's own data and keys |
| Your programs | Acting as you in Banda |
| The network | Your keyring |
| Your ssh-agent, in Projects you said you trust: it can `git push` and `ssh` as you | Your screen and clipboard |
| Your GitHub token (from `gh`), in Projects you said you trust | Becoming root (`sudo`) |
| | Desktop notifications (Banda still sends its own) |

Behind the fence, a Project gives its Agents your GitHub token and your ssh-agent only once you say you trust it: in the question Banda asks as you add a folder that looks foreign, or in the Project's settings, with **Trust…**, or **Say you trust it…** for one already trusted. A Project added from a folder of your own, or made by its name, is trusted, but its Agents get them only once you say so. Every Project you trusted before Banda had the fence counts as said: Banda said it for you once, as it upgraded. In a Project you have not said you trust, an Agent's programs start without `GH_TOKEN` and `SSH_AUTH_SOCK`, fence or none, and behind the fence without the ssh-agents' sockets Banda knows of: the one `SSH_AUTH_SOCK` names, those your ssh config names as `IdentityAgent`, ssh-agent's in `/tmp`, and 1Password's, Bitwarden's and GnuPG's. What goes with trust is the agent: key files in `~/.ssh` are your files, as the table says. Where there is no fence, `gh` reaches your token itself, as it does in your Terminals, so saying you trust a Project gives its Agents your ssh-agent alone, and its settings offer it there too.

On Linux, Banda reads that token itself, where `gh` keeps it, without running `gh`: in its `hosts.yml`, or in your keyring through the desktop's Secret Service. Where the fence holds, the programs Banda runs by itself outside it are its own or ones only root can change: its pull requests and its Problem reports ask GitHub's API with the token.

Banda's own git, which reads your status and diffs and fetches a Project's upstream to keep ahead and behind current, reads what an Agent may write: a repository's config and attributes. Where the fence holds, it starts behind the fence too, and reads none of your home's git config but what you ignore, how line ends read and the folders you trust. Its fetch of the upstream branch from github.com over https signs in with your token, in a Project you said you trust: into a repository of Banda's own, whose config is Banda's alone, and from there into the Project's, with no token. Over ssh, that fetch signs with your ssh-agent in any Project, as Banda's own fetch always has, and uses no ssh config of yours. A fetch that cannot sign in says why once, in Banda's log.

## Where it does not hold whole

Then a new Thread starts **Supervised**, which asks before it changes anything, unless you set its Harness's mode for new Threads in Settings → Agents. You may still pick Full access, and the mode menu says what it means there: the Agent is you, in Banda too. Full access counts as yours only as you pick it there or in a Thread's mode menu: `full_access` written into `agents.toml` by hand, or by anything else, does not, and a new Thread starts Supervised all the same. A Thread in Full access from where the fence held starts its next turn Supervised, and says so.

| Settings says | Why | What to do |
|---|---|---|
| **On**, and you're in the docker group | Through Docker, an Agent could step past any fence. | Leave the `docker` group, or use rootless Docker. |
| **Partly**, and you're in the docker group | Both of the rows around this one. | Both: leaving the group alone still leaves the gaps. |
| **Partly** | This Linux lacks Landlock, the fence's second layer. | Linux 6.12 or later, with Landlock on. |
| **Partly**: some settings are links | Banda's settings, or `gh`'s, are links, as dotfiles kept with stow are, which an Agent could point elsewhere. Settings names them. | Keep them as plain files and folders. |
| **Off**: Ubuntu doesn't let apps use user namespaces | Ubuntu's AppArmor keeps them from apps it has no profile for. | Settings shows a command to run once, which gives Banda a profile; then quit Banda and open it again. |
| **Off**: this computer doesn't allow user namespaces | The system turned them off. | Turn them on, if it is yours to change. |
| **Off**: the engine is from before the fence | It gets it when it starts again; until then new Threads start as they did. | Quit Banda and open it again. |
| **Off**: no fence for macOS yet | Banda has none for macOS yet. | — |
| **Off**: no fence for Windows | Banda has none for Windows. | — |
| **Off**: Banda couldn't set it up here | Its Details say what the engine found. | Report it with those Details. |
| **Off**: turned off for testing | `BANDA_FENCE=off` is set. | Start Banda without it. |

Each Harness's mode for new Threads is in Settings → Agents.
