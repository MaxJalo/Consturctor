"""Entry point of a server-side agent run: the Orchestrator sidecar under another path.

The Orchestrator app kills SDK runners whose parent command line is its own
agent_sidecar.py. Starting the same sidecar through this file keeps a server run
alive when the app starts or restarts on the same machine.
"""

import os
import runpy
import sys
from pathlib import Path

source = Path(os.environ["CONSTRUCTOR_SIDECAR_SOURCE"]).resolve()
# This folder holds backend modules (runner.py, service.py): they must not shadow the sidecar's imports.
sys.path[0] = str(source.parent)
runpy.run_path(str(source), run_name="__main__")
