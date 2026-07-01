#!/usr/bin/env python3
"""No-op shell hook placeholder for local Cursor automation."""

import sys


def main() -> int:
    # Cursor invokes this hook before shell commands; an empty success keeps
    # local automation from blocking repository maintenance commands.
    return 0


if __name__ == "__main__":
    sys.exit(main())
