"""psql -Atc for the e2e suites, through support/psql.mjs: no PostgreSQL client needed."""
import os
import subprocess

_HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "psql.mjs")


def psql(db, q):
    """Run q against db like `psql db -Atc q`; returns the CompletedProcess."""
    return subprocess.run(["node", _HELPER, db, "-Atc", q], capture_output=True, text=True)
