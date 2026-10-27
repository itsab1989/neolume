#!/usr/bin/env python3
"""Start the one-time setup for the TV app.

    python3 installer/plexneo_setup.py          (Mac/Linux; Windows: py installer\\plexneo_setup.py)

Opens a local web page (http://127.0.0.1:32480/) that guides through the setup. Python 3.8+ standard library only.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from neosetup.app import main  # noqa: E402

if __name__ == '__main__':
    sys.exit(main())
